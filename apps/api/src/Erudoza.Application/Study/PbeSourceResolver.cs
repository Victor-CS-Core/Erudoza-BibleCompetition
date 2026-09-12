using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed class PbeSourceResolver(IErudozaDbContext db, ICurrentUser user, ICompetitionScopeResolver competition, IStudentStudyScopeService assignments, IPbeChapterJsonReader? chapterJson = null)
{
    public static bool Licensed(string status) => status is "approved" or "public-domain" or "creative-commons";
    public Task<List<PbeTrainingRecord>> IntroductionRows(Guid org, Guid season, CancellationToken ct) => db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == null && r.Kind == "pbe-introduction").OrderBy(r => r.Id).ToListAsync(ct);
    public async Task<PbeSourceScope> ResolveChaptersAsync(Guid org, Guid season, Guid student, CancellationToken ct = default)
    {
        if (await ChapterAdmission(org, season, student, ct) is not null) throw new UnauthorizedAccessException("Active PBE season required.");
        return await ReadChapterSources(org, season, student, ct);
    }
    internal async Task<PbeSourceScope> ReadChapterSources(Guid org, Guid season, Guid student, CancellationToken ct)
    {
        if (chapterJson is null) throw new NotSupportedException("Chapter metadata provider is required.");
        // Only the final guarded publication/current GET calls this full relevant-source reader.
        var scripture = await ChapterScripturePage(org, season, student, "", 10001, ct);
        if (scripture.Count(s => s.SourceKind == Erudoza.Domain.Practice.PbeSourceKind.Scripture) > 5000) throw new PbeChapterLimitException("ScopeTooLarge");
        var introductions = await chapterJson.IntroductionPage(org, season, student, "", 10001, ct);
        if (scripture.Count + introductions.Count > 10000) throw new PbeChapterLimitException("ScopeTooLarge");
        return new(scripture.Concat(introductions).ToArray(), "");
    }
    public Task<PbeSourceScope> ResolveAsync(Guid organizationId, Guid seasonId, Guid? studentId, CancellationToken ct = default) => ResolveCoreAsync(organizationId, seasonId, studentId, false, ct);
    public async Task<PbeSourceScope> ResolveSessionAsync(Guid organizationId, Guid sessionId, CancellationToken ct = default)
    {
        var row = await db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.OrganizationId == organizationId && r.OwnerId == user.UserId && r.Kind == "pbe-session" && r.Id == sessionId.ToString(), ct) ?? throw new KeyNotFoundException("Study session was not found.");
        var saved = JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!;
        if (saved.Format != "Pbe" || saved.StudentUserId != user.UserId) throw new KeyNotFoundException("Study session was not found.");
        return await ResolveCoreAsync(organizationId, saved.SeasonId, user.UserId, true, ct);
    }
    public static string Eligibility(Guid season, Guid student, PbeSourceScope scope)
    {
        var material = JsonSerializer.Serialize(new object[] { season.ToString(), student.ToString(), scope.Sources.OrderBy(s => s.Id.ToString(), StringComparer.Ordinal).Select(s => new object?[] { s.Id.ToString(), s.ContentPackId.ToString(), s.SourceKind.ToString(), s.BookKey, s.Chapter, s.Verse, s.Ordinal, s.CitationLabel, s.CanonicalText }).ToArray() }, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        return Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(material)));
    }
    internal async Task<(ApplicationUser Actor, OrganizationMember Membership)> AuthorizeActor(Guid organizationId, Guid seasonId, Guid? studentId, CancellationToken ct)
    {
        if (!user.IsAuthenticated || user.OrganizationId != organizationId || organizationId == Guid.Empty || seasonId == Guid.Empty)
            throw new UnauthorizedAccessException("Organization access denied.");
        var actor = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == user.UserId && u.IsActive, ct);
        var membership = await db.OrganizationMembers.AsNoTracking().SingleOrDefaultAsync(m => m.UserId == user.UserId && m.OrganizationId == organizationId, ct);
        if (actor is null || membership is null || (actor.Kind == UserKind.Student ? membership.Role != OrganizationRole.Student || studentId != actor.Id : membership.Role is not (OrganizationRole.Owner or OrganizationRole.Admin)))
            throw new UnauthorizedAccessException("Active membership required.");
        return (actor, membership);
    }
    internal async Task<string?> ChapterAdmission(Guid organizationId, Guid seasonId, Guid studentId, CancellationToken ct)
    {
        var (actor, _) = await AuthorizeActor(organizationId, seasonId, studentId, ct);
        if (actor.Id != studentId || actor.Kind != UserKind.Student) throw new UnauthorizedAccessException("Student access required.");
        var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(s => s.OrganizationId == organizationId && s.Id == seasonId, ct) ?? throw new DomainException("Season was not found.");
        return season.Status != SeasonStatus.Active ? "SeasonClosed" : season.PbeEnabled ? null : "PbeDisabled";
    }
    private async Task<PbeSourceScope> ResolveCoreAsync(Guid organizationId, Guid seasonId, Guid? studentId, bool continuation, CancellationToken ct)
    {
        var (actor, membership) = await AuthorizeActor(organizationId, seasonId, studentId, ct);
        var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(s => s.Id == seasonId && s.OrganizationId == organizationId, ct)
            ?? throw new DomainException("Season was not found.");
        if (season.Status != SeasonStatus.Active) throw new DomainException("Choose an active season.");
        if (studentId.HasValue)
        {
            if (!continuation && !season.PbeEnabled || !await db.Users.AnyAsync(u => u.Id == studentId && u.IsActive && u.Kind == UserKind.Student && db.OrganizationMembers.Any(m => m.UserId == u.Id && m.OrganizationId == organizationId && m.Role == OrganizationRole.Student), ct))
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
    internal IQueryable<SourceUnit> ChapterScriptureQuery(Guid org, Guid season, Guid student)
    {
        return db.SourceUnits.AsNoTracking().Where(s =>
            (s.OrganizationId == org && s.ContentPack!.OrganizationId == org || s.OrganizationId == BuiltInLibrary.OrganizationId && s.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && s.ContentPack.IsBuiltIn) &&
            s.IsActive && !s.IsRetired && s.ContentPack!.IsActive &&
            (s.ContentPack.LicensingStatus.ToLower() == "development-sample" || s.ContentPack.LicensingStatus.ToLower() == "approved" || s.ContentPack.LicensingStatus.ToLower() == "public-domain" || s.ContentPack.LicensingStatus.ToLower() == "creative-commons") &&
            db.AssignmentScopes.Any(a => a.Assignment!.OrganizationId == org && a.Assignment.SeasonId == season && a.Assignment.StudentUserId == student &&
                (a.Assignment.Type == AssignmentType.PrimarySpecialist || a.Assignment.Type == AssignmentType.RequiredCoverage || a.Assignment.Type == AssignmentType.OptionalReview) &&
                a.ContentPackId == s.ContentPackId && a.BookKey.ToUpper() == s.BookKey.ToUpper() &&
                s.Chapter >= a.StartChapter && s.Chapter <= a.EndChapter && (s.Chapter != a.StartChapter || s.Verse >= a.StartVerse) && (s.Chapter != a.EndChapter || s.Verse <= a.EndVerse)) &&
            db.ScopeEntries.Any(e => e.OrganizationId == org && e.SeasonId == season && e.Kind == ScopeEntryKind.Include && e.ContentPackId == s.ContentPackId && e.BookKey.ToUpper() == s.BookKey.ToUpper() &&
                s.Chapter >= e.StartChapter && s.Chapter <= e.EndChapter && (s.Chapter != e.StartChapter || s.Verse >= e.StartVerse) && (s.Chapter != e.EndChapter || s.Verse <= e.EndVerse)) &&
            !db.ScopeEntries.Any(e => e.OrganizationId == org && e.SeasonId == season && e.Kind == ScopeEntryKind.Exclude && e.ContentPackId == s.ContentPackId && e.BookKey.ToUpper() == s.BookKey.ToUpper() &&
                s.Chapter >= e.StartChapter && s.Chapter <= e.EndChapter && (s.Chapter != e.StartChapter || s.Verse >= e.StartVerse) && (s.Chapter != e.EndChapter || s.Verse <= e.EndVerse)));
    }
    internal async Task<IReadOnlyList<PbeSourceUnit>> ChapterScripturePage(Guid org, Guid season, Guid student, string after, int limit, CancellationToken ct)
    {
        var query = ChapterScriptureQuery(org, season, student).Where(s => string.Compare(s.Id.ToString().ToLower(), after) > 0);
        return await query.OrderBy(s => s.Id.ToString().ToLower()).Take(limit).Select(s => new PbeSourceUnit(s.Id, s.ContentPackId,
            s.ContentPack!.SourceType == SourceType.Supplemental ? Erudoza.Domain.Practice.PbeSourceKind.Commentary : Erudoza.Domain.Practice.PbeSourceKind.Scripture, s.BookKey, s.Chapter, s.Verse, s.Ordinal, s.CitationLabel, s.CanonicalText)).ToListAsync(ct);
    }
}
