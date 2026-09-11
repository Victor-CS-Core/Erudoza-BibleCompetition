using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
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

    public async Task<SeasonScopeDto> GetScopeAsync(Guid organizationId, Guid seasonId, CancellationToken cancellationToken)
    {
        await RequireSeason(organizationId, seasonId, cancellationToken);
        var entries = await db.ScopeEntries.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .OrderBy(item => item.BookKey).ThenBy(item => item.StartChapter).ThenBy(item => item.StartVerse)
            .ThenBy(item => item.EndChapter).ThenBy(item => item.EndVerse)
            .ToListAsync(cancellationToken);
        var packs = entries.GroupBy(item => item.ContentPackId).Select(group => new ScopePackDto(group.Key,
            group.Where(e => e.Kind == ScopeEntryKind.Include).Select(ToRangeDto).ToList(),
            group.Where(e => e.Kind == ScopeEntryKind.Exclude).Select(ToRangeDto).ToList())).ToList();
        return new SeasonScopeDto(packs.Count == 1 ? packs[0].ContentPackId : null,
            packs.Count == 1 ? packs[0].Includes : [], packs.Count == 1 ? packs[0].Excludes! : [], packs);
    }

    private static ScopeRangeDto ToRangeDto(CompetitionScopeEntry item) =>
        new(item.BookKey, item.StartChapter, item.StartVerse, item.EndChapter, item.EndVerse);

    public async Task DefineScopeAsync(Guid organizationId, Guid seasonId, DefineScopeRequest request, CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        if (season.Status is SeasonStatus.Active or SeasonStatus.Completed or SeasonStatus.Archived)
            throw new DomainException("Season passages are locked.");
        var existing = await db.ScopeEntries.Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId).ToListAsync(cancellationToken);
        var historicalPackIds = existing.Select(e => e.ContentPackId).ToHashSet();
        var selections = request.Packs ?? (request.ContentPackId is { } id
            ? [new ScopePackDto(id, request.Includes ?? [], request.Excludes ?? [])] : []);
        if (selections.Count > 66 || selections.Select(p => p.ContentPackId).Distinct().Count() != selections.Count)
            throw new DomainException("Select each book once.");
        var ids = selections.Select(p => p.ContentPackId).ToArray();
        var packs = await db.ContentPacks.AsNoTracking().Where(p => ids.Contains(p.Id) && p.IsActive
            && (p.OrganizationId == organizationId || p.OrganizationId == BuiltInLibrary.OrganizationId && p.IsBuiltIn))
            .ToListAsync(cancellationToken);
        if (packs.Count != ids.Length || request.Packs is not null && packs.Any(p =>
                (!p.IsBuiltIn || p.OrganizationId != BuiltInLibrary.OrganizationId) && !historicalPackIds.Contains(p.Id)))
            throw new DomainException("Choose books from the built-in NKJV library.");
        var units = await db.SourceUnits.AsNoTracking().Where(u => ids.Contains(u.ContentPackId)
            && (u.OrganizationId == organizationId && u.ContentPack!.OrganizationId == organizationId
                || u.OrganizationId == BuiltInLibrary.OrganizationId && u.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && u.ContentPack.IsBuiltIn))
            .ToListAsync(cancellationToken);
        foreach (var selection in selections)
        {
            if (selection.Includes is null || selection.Includes.Count == 0) throw new DomainException("Select at least one passage in each book.");
            var bookUnits = units.Where(u => u.ContentPackId == selection.ContentPackId).ToList();
            foreach (var range in selection.Includes.Concat(selection.Excludes ?? [])) StoredPassageBounds.RequireRange(range, bookUnits);
        }
        db.ScopeEntries.RemoveRange(existing);
        foreach (var selection in selections)
        {
            foreach (var range in selection.Includes) db.ScopeEntries.Add(CreateEntry(organizationId, seasonId, selection.ContentPackId, ScopeEntryKind.Include, range));
            foreach (var range in selection.Excludes ?? []) db.ScopeEntries.Add(CreateEntry(organizationId, seasonId, selection.ContentPackId, ScopeEntryKind.Exclude, range));
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
        EnsureEditable(season);
        var student = await db.OrganizationMembers.SingleOrDefaultAsync(
            item => item.OrganizationId == organizationId
                && item.UserId == request.StudentUserId
                && item.Role == OrganizationRole.Student,
            cancellationToken) ?? throw new DomainException("Student was not found in this organization.");

        if (!await db.Users.AnyAsync(item => item.Id == student.UserId && item.IsActive, cancellationToken)) throw new DomainException("Reactivate the student before assigning passages.");
        if (request.Difficulty is { } difficulty && !Enum.IsDefined(difficulty))
            throw new DomainException("Choose Foundation, Standard, or Advanced difficulty.");
        if (!Enum.IsDefined(request.Type)) throw new DomainException("Assignment type is invalid.");
        var range = request.Range;
        if (string.IsNullOrWhiteSpace(range.BookKey) || range.StartChapter < 1 || range.StartVerse < 1
            || range.EndChapter < range.StartChapter || range.EndVerse < 1
            || (range.StartChapter == range.EndChapter && range.EndVerse < range.StartVerse))
            throw new DomainException("Choose a valid passage range.");
        var pack = await db.ContentPacks.SingleOrDefaultAsync(item => item.Id == request.ContentPackId
            && (item.OrganizationId == organizationId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.IsBuiltIn) && item.IsActive, cancellationToken)
            ?? throw new DomainException("Choose an active content pack from this organization.");
        var allowed = await scopeResolver.ResolveAsync(organizationId, seasonId, cancellationToken);
        var units = await db.SourceUnits.AsNoTracking().Where(item => item.ContentPackId == pack.Id
            && item.OrganizationId == pack.OrganizationId).ToListAsync(cancellationToken);
        var selectedUnits = StoredPassageBounds.RequireRange(range, units);
        if (!selectedUnits.Any(item => allowed.Contains(item.Id)))
            throw new DomainException("This assignment has no available passages inside the season scope. Check exclusions and the passage range.");
        var member = await db.CompetitionMembers.SingleOrDefaultAsync(item => item.OrganizationId == organizationId
            && item.SeasonId == seasonId && item.UserId == student.UserId, cancellationToken);
        if (member is null)
        {
            member = new CompetitionMember
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                SeasonId = seasonId,
                UserId = student.UserId,
                Difficulty = request.Difficulty ?? TrainingDifficulty.Standard
            };
            db.CompetitionMembers.Add(member);
        }
        else if (request.Difficulty is { } selectedDifficulty) member.Difficulty = selectedDifficulty;

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

    public async Task SetDifficultyAsync(Guid organizationId, Guid seasonId, Guid studentId,
        TrainingDifficulty difficulty, CancellationToken cancellationToken)
    {
        EnsureEditable(await RequireSeason(organizationId, seasonId, cancellationToken));
        if (!Enum.IsDefined(difficulty)) throw new DomainException("Choose Foundation, Standard, or Advanced difficulty.");
        if (!await db.Assignments.AnyAsync(item => item.OrganizationId == organizationId
            && item.SeasonId == seasonId && item.StudentUserId == studentId, cancellationToken))
            throw new DomainException("Assign this student to the season before setting difficulty.");
        var member = await db.CompetitionMembers.SingleOrDefaultAsync(item => item.OrganizationId == organizationId
            && item.SeasonId == seasonId && item.UserId == studentId, cancellationToken);
        if (member is null)
        {
            member = new CompetitionMember
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                SeasonId = seasonId,
                UserId = studentId
            };
            db.CompetitionMembers.Add(member);
        }
        member.Difficulty = difficulty;
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.student-difficulty", nameof(CompetitionMember), member.Id,
            new { studentId, seasonId, difficulty }, cancellationToken);
    }

    public async Task<ActivationResultDto> ActivateAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        EnsureEditable(season);
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
            .Where(item => packIds.Contains(item.Id) && item.IsActive
                && (item.OrganizationId == organizationId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.IsBuiltIn))
            .CountAsync(cancellationToken) == packIds.Count;

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

    public async Task RemoveAssignmentAsync(Guid organizationId, Guid seasonId, Guid assignmentId, CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        EnsureEditable(season);
        var assignment = await db.Assignments.Include(item => item.Scopes).SingleOrDefaultAsync(item =>
            item.OrganizationId == organizationId && item.SeasonId == seasonId && item.Id == assignmentId, cancellationToken)
            ?? throw new DomainException("Assignment was not found in this season.");
        db.AssignmentScopes.RemoveRange(assignment.Scopes);
        db.Assignments.Remove(assignment);
        // Attempts, mastery, review schedules and membership are independent historical records.
        if (season.Status == SeasonStatus.AssignmentsReady && !await db.Assignments.AnyAsync(item =>
            item.SeasonId == seasonId && item.OrganizationId == organizationId && item.Id != assignmentId, cancellationToken))
            season.Status = SeasonStatus.ContentReady;
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.assignment.remove", nameof(Assignment), assignmentId,
            new { seasonId, assignment.StudentUserId }, cancellationToken);
    }

    public async Task CorrectAssignmentAsync(Guid organizationId, Guid seasonId, Guid assignmentId,
        ScopeRangeDto range, CancellationToken cancellationToken)
    {
        EnsureEditable(await RequireSeason(organizationId, seasonId, cancellationToken));
        var assignment = await db.Assignments.Include(item => item.Scopes).SingleOrDefaultAsync(item =>
            item.OrganizationId == organizationId && item.SeasonId == seasonId && item.Id == assignmentId, cancellationToken)
            ?? throw new DomainException("Assignment was not found in this season.");
        if (assignment.Scopes.Count != 1) throw new DomainException("Only single-passage assignments can be corrected. Remove and add the intended passages.");
        if (string.IsNullOrWhiteSpace(range.BookKey) || range.StartChapter < 1 || range.StartVerse < 1
            || range.EndChapter < range.StartChapter || range.EndVerse < 1
            || (range.StartChapter == range.EndChapter && range.EndVerse < range.StartVerse))
            throw new DomainException("Choose a valid passage range.");
        var saved = assignment.Scopes.Single();
        var allowed = await scopeResolver.ResolveAsync(organizationId, seasonId, cancellationToken);
        var units = await db.SourceUnits.AsNoTracking().Where(item => item.ContentPackId == saved.ContentPackId
            && (item.OrganizationId == organizationId && item.ContentPack!.OrganizationId == organizationId
                || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn))
            .ToListAsync(cancellationToken);
        var selectedUnits = StoredPassageBounds.RequireRange(range, units);
        if (!selectedUnits.Any(item => allowed.Contains(item.Id)))
            throw new DomainException("This assignment has no available passages inside the season scope.");
        var previous = saved.ToRange();
        saved.BookKey = range.BookKey; saved.StartChapter = range.StartChapter; saved.StartVerse = range.StartVerse;
        saved.EndChapter = range.EndChapter; saved.EndVerse = range.EndVerse;
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season.assignment.correct", nameof(Assignment), assignmentId,
            new { previous, replacement = range }, cancellationToken);
    }

    public async Task TransitionAsync(Guid organizationId, Guid seasonId, SeasonStatus status, CancellationToken cancellationToken)
    {
        var season = await RequireSeason(organizationId, seasonId, cancellationToken);
        if (status != SeasonStatus.Archived && status != SeasonStatus.Completed)
            throw new DomainException("Choose close or archive.");
        if (season.Status == status) return;
        if (season.Status == SeasonStatus.Archived || status == SeasonStatus.Completed && season.Status != SeasonStatus.Active)
            throw new DomainException("Only active seasons can be closed. Archived seasons cannot be reopened.");
        season.Status = status;
        await db.SaveChangesAsync(cancellationToken);
        await audit.RecordAsync("season." + (status == SeasonStatus.Completed ? "close" : "archive"),
            nameof(CompetitionSeason), seasonId, null, cancellationToken);
    }

    private static void EnsureEditable(CompetitionSeason season)
    {
        if (season.Status is SeasonStatus.Completed or SeasonStatus.Archived)
            throw new DomainException("This season is closed. Saved passages and student plans are read-only.");
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
