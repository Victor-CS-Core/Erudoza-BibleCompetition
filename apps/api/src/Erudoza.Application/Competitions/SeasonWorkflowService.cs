using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Competitions;

public sealed class SeasonWorkflowService(
    IErudozaDbContext db,
    ICompetitionScopeResolver scopeResolver,
    IClock clock,
    IAuditService audit)
{
    public async Task<CompetitionSeason> CreateAsync(
        Guid organizationId,
        CreateSeasonRequest request,
        CancellationToken cancellationToken)
    {
        var profile = await db.RuleProfiles
            .SingleOrDefaultAsync(item => item.Key == request.RuleProfileKey, cancellationToken)
            ?? throw new DomainException($"Rule profile '{request.RuleProfileKey}' was not found.");

        var season = new CompetitionSeason
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            Name = request.Name.Trim(),
            YearLabel = request.YearLabel.Trim(),
            Status = SeasonStatus.Draft,
            DefaultLocale = "en",
            RuleProfileId = profile.Id,
            StartDate = request.StartDate,
            TargetCompetitionDate = request.TargetCompetitionDate,
            CreatedAtUtc = clock.UtcNow
        };

        db.Seasons.Add(season);
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.create", nameof(CompetitionSeason), season.Id, request, cancellationToken);
        return season;
    }

    public async Task DefineScopeAsync(
        Guid organizationId,
        Guid seasonId,
        DefineScopeRequest request,
        CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        var pack = await db.ContentPacks.SingleOrDefaultAsync(
            item => item.Id == request.ContentPackId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Content pack was not found in this organization.");

        var existing = await db.ScopeEntries
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .ToListAsync(cancellationToken);
        db.ScopeEntries.RemoveRange(existing);

        foreach (var include in request.Includes)
        {
            db.ScopeEntries.Add(CreateEntry(organizationId, seasonId, pack.Id, ScopeEntryKind.Include, include));
        }

        foreach (var exclude in request.Excludes ?? [])
        {
            db.ScopeEntries.Add(CreateEntry(organizationId, seasonId, pack.Id, ScopeEntryKind.Exclude, exclude));
        }

        await db.SaveChangesAsync(cancellationToken);
        var resolved = await scopeResolver.ResolveAsync(organizationId, seasonId, cancellationToken);
        season.Status = resolved.Count > 0 ? SeasonStatus.ContentReady : SeasonStatus.Draft;
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.scope", nameof(CompetitionSeason), seasonId, request, cancellationToken);
    }

    public async Task<Assignment> AssignAsync(
        Guid organizationId,
        Guid seasonId,
        CreateAssignmentRequest request,
        CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        var student = await db.OrganizationMembers.SingleOrDefaultAsync(
            item => item.OrganizationId == organizationId
                && item.UserId == request.StudentUserId
                && item.Role == OrganizationRole.Student,
            cancellationToken) ?? throw new DomainException("Student was not found in this organization.");

        var assignment = new Assignment
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            SeasonId = season.Id,
            StudentUserId = student.UserId,
            Type = request.Type,
            CreatedAtUtc = clock.UtcNow
        };
        db.Assignments.Add(assignment);
        db.AssignmentScopes.Add(new AssignmentScope
        {
            Id = Guid.NewGuid(),
            AssignmentId = assignment.Id,
            ContentPackId = request.ContentPackId,
            BookKey = request.Range.BookKey,
            StartChapter = request.Range.StartChapter,
            StartVerse = request.Range.StartVerse,
            EndChapter = request.Range.EndChapter,
            EndVerse = request.Range.EndVerse
        });

        if (season.Status is SeasonStatus.ContentReady or SeasonStatus.Draft)
        {
            season.Status = SeasonStatus.AssignmentsReady;
        }

        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.assign", nameof(Assignment), assignment.Id, request, cancellationToken);
        return assignment;
    }

    public async Task<ActivationResultDto> ActivateAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        var problems = new List<string>();
        var profile = await db.RuleProfiles.SingleOrDefaultAsync(item => item.Id == season.RuleProfileId, cancellationToken);
        if (profile is null)
        {
            problems.Add("A rule profile version is required.");
        }

        var resolved = await scopeResolver.ResolveAsync(organizationId, seasonId, cancellationToken);
        if (resolved.Count == 0)
        {
            problems.Add("Competition scope must resolve to at least one source unit.");
        }

        var packIds = await db.ScopeEntries
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .Select(item => item.ContentPackId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var packsHealthy = await db.ContentPacks
            .Where(item => item.OrganizationId == organizationId && packIds.Contains(item.Id))
            .AllAsync(item => item.IsActive, cancellationToken);

        if (!packsHealthy)
        {
            problems.Add("Selected content packs failed integrity checks.");
        }

        if (problems.Count > 0)
        {
            return new ActivationResultDto(false, problems);
        }

        DomainInvariants.EnsureSeasonCanActivate(profile is not null, resolved.Count, packsHealthy);
        season.Status = SeasonStatus.Active;
        season.ActivatedAtUtc = clock.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.activate", nameof(CompetitionSeason), season.Id, null, cancellationToken);
        return new ActivationResultDto(true, []);
    }

    private async Task<CompetitionSeason> RequireSeason(Guid organizationId, Guid seasonId, CancellationToken cancellationToken)
    {
        var season = await db.Seasons.SingleOrDefaultAsync(
            item => item.Id == seasonId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Season was not found.");
        DomainInvariants.EnsureSeasonBelongsToOrganization(season, organizationId);
        return season;
    }

    private static CompetitionScopeEntry CreateEntry(
        Guid organizationId,
        Guid seasonId,
        Guid contentPackId,
        ScopeEntryKind kind,
        ScopeRangeDto range) =>
        new()
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            SeasonId = seasonId,
            ContentPackId = contentPackId,
            Kind = kind,
            BookKey = range.BookKey,
            StartChapter = range.StartChapter,
            StartVerse = range.StartVerse,
            EndChapter = range.EndChapter,
            EndVerse = range.EndVerse
        };
}
