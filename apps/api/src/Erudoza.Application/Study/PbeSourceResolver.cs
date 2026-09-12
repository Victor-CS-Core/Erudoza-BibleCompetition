using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed class PbeSourceResolver(IErudozaDbContext db, ICurrentUser user, ICompetitionScopeResolver competition, IStudentStudyScopeService assignments)
{
    public static bool Licensed(string status) => status is "approved" or "public-domain" or "creative-commons";
    public Task<List<PbeTrainingRecord>> IntroductionRows(Guid org, Guid season, CancellationToken ct) => db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == null && r.Kind == "pbe-introduction").OrderBy(r => r.Id).ToListAsync(ct);
    public async Task<PbeSourceScope> ResolveAsync(Guid organizationId, Guid seasonId, Guid? studentId, CancellationToken ct = default)
    {
        if (!user.IsAuthenticated || user.OrganizationId != organizationId || organizationId == Guid.Empty || seasonId == Guid.Empty)
            throw new UnauthorizedAccessException("Organization access denied.");
        var actor = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == user.UserId && u.IsActive, ct);
        var membership = await db.OrganizationMembers.AsNoTracking().SingleOrDefaultAsync(m => m.UserId == user.UserId && m.OrganizationId == organizationId, ct);
        if (actor is null || membership is null || (actor.Kind == UserKind.Student ? membership.Role != OrganizationRole.Student || studentId != actor.Id : membership.Role is not (OrganizationRole.Owner or OrganizationRole.Admin)))
            throw new UnauthorizedAccessException("Active membership required.");
        var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(s => s.Id == seasonId && s.OrganizationId == organizationId, ct)
            ?? throw new DomainException("Season was not found.");
        if (season.Status != SeasonStatus.Active) throw new DomainException("Choose an active season.");
        if (studentId.HasValue)
        {
            if (!season.PbeEnabled || !await db.Users.AnyAsync(u => u.Id == studentId && u.IsActive && u.Kind == UserKind.Student && db.OrganizationMembers.Any(m => m.UserId == u.Id && m.OrganizationId == organizationId && m.Role == OrganizationRole.Student), ct))
                throw new UnauthorizedAccessException("Active student and enabled PBE season required.");
        }
        var ids = studentId.HasValue ? (await assignments.GetAsync(studentId.Value, seasonId, ct)).EligibleSourceUnitIds : await competition.ResolveAsync(organizationId, seasonId, ct);
        var sourceIds = ids.ToArray();
        var sources = await db.SourceUnits.AsNoTracking().Include(s => s.ContentPack).Where(s => sourceIds.Contains(s.Id) && s.IsActive && !s.IsRetired && s.ContentPack!.IsActive).OrderBy(s => s.Id).ToListAsync(ct);
        sources = sources.Where(s => new[] { "development-sample", "public-domain", "approved", "creative-commons" }.Contains(s.ContentPack!.LicensingStatus.ToLowerInvariant())).ToList();
        var scopes = await db.ScopeEntries.AsNoTracking().Where(s => s.OrganizationId == organizationId && s.SeasonId == seasonId).OrderBy(s => s.Id).Select(s => new { s.Id, s.ContentPackId, s.Kind, s.BookKey, s.StartChapter, s.StartVerse, s.EndChapter, s.EndVerse }).ToListAsync(ct);
        var assigned = await db.AssignmentScopes.AsNoTracking().Where(s => s.Assignment!.OrganizationId == organizationId && s.Assignment.SeasonId == seasonId && s.Assignment.StudentUserId == studentId).OrderBy(s => s.Id).Select(s => new { s.Id, s.AssignmentId, s.ContentPackId, s.BookKey, s.StartChapter, s.StartVerse, s.EndChapter, s.EndVerse }).ToListAsync(ct);
        var introductions = await IntroductionRows(organizationId, seasonId, ct);
        var introductionAssignments = studentId.HasValue ? await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == organizationId && r.SeasonId == seasonId && r.OwnerId == studentId && r.Kind == "pbe-introduction-assignment").OrderBy(r => r.Id).ToListAsync(ct) : [];
        var member = studentId.HasValue ? await db.CompetitionMembers.AsNoTracking().SingleOrDefaultAsync(m => m.OrganizationId == organizationId && m.SeasonId == seasonId && m.UserId == studentId, ct) : null;
        var books = scopes.Where(s => s.Kind == ScopeEntryKind.Include).Select(s => s.BookKey.ToUpperInvariant()).ToHashSet();
        var assignedPacks = introductionAssignments.Select(r => JsonSerializer.Deserialize<PbeIntroductionAssignment>(r.DataJson, PbeQuestionBank.Json)!.ContentPackId).ToHashSet();
        var combined = sources.Select(PbeSourceUnit.FromLegacy).ToList();
        foreach (var row in introductions)
        {
            var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
            if (intro.OrganizationId == organizationId && intro.SeasonId == seasonId && intro.Reviewed && Licensed(intro.LicensingStatus) && books.Contains(intro.BookKey) && (!studentId.HasValue || member is not null && assignedPacks.Contains(intro.Id)))
                combined.AddRange(intro.Units.Select((unit, i) => new PbeSourceUnit(unit.Id, intro.Id, Erudoza.Domain.Practice.PbeSourceKind.Commentary, intro.BookKey, null, null, i + 1, unit.Citation, unit.CanonicalText)));
        }
        var fingerprint = JsonSerializer.Serialize(new
        {
            season.Status,
            season.PbeEnabled,
            actor.IsActive,
            actor.Kind,
            membership.Role,
            scopes,
            assigned,
            introductions = introductions.Select(r => new { r.Id, r.Revision, r.DataJson }),
            introductionAssignments = introductionAssignments.Select(r => new { r.Id, r.Revision, r.DataJson }),
            member = member is null ? null : new { member.Id, member.OrganizationId, member.SeasonId, member.UserId },
            sources = sources.Select(s => new
            {
                s.Id,
                s.OrganizationId,
                s.ContentPackId,
                s.CanonicalText,
                s.CitationLabel,
                s.SourceType,
                s.BookKey,
                s.Chapter,
                s.Verse,
                s.IsActive,
                s.IsRetired,
                pack = new { s.ContentPack!.Id, s.ContentPack.OrganizationId, s.ContentPack.IsBuiltIn, s.ContentPack.SourceType, s.ContentPack.IsActive, s.ContentPack.LicensingStatus }
            })
        }, PbeQuestionBank.Json);
        return new(combined, fingerprint);
    }
}
