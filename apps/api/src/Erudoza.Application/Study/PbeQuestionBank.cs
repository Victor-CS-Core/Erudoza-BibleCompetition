using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

/// <summary>Private bank. HTTP consumers expose metadata only; source IDs never authorize access.</summary>
public sealed class PbeQuestionBank(IErudozaDbContext db, ICurrentUser user, ICompetitionScopeResolver competition, IStudentStudyScopeService assignments) : IPbeQuestionBank
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict, PropertyNameCaseInsensitive = false };
    private static string NormalizeEvidence(string value) => System.Text.RegularExpressions.Regex.Replace(value.Normalize(System.Text.NormalizationForm.FormC), "[ \t\r\n\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+", " ").Trim(' ');
    public static string SourceProof(PbeQuestion question, IReadOnlyDictionary<Guid, SourceUnit> sources)
    {
        if (question.SourceUnitIds.Any(id => !sources.ContainsKey(id))) throw new DomainException("Question source is outside the approved scope.");
        var units = question.SourceUnitIds.Select(id => sources[id]).ToList();
        if (NormalizeEvidence(question.Reference) != NormalizeEvidence(string.Join("; ", units.Select(s => s.CitationLabel))) || !NormalizeEvidence(string.Join("\n", units.Select(s => s.CanonicalText))).Contains(NormalizeEvidence(question.Evidence), StringComparison.Ordinal)) throw new DomainException("Reference and evidence must match the declared canonical sources.");
        var material = string.Concat(units.SelectMany(s => new[] { s.Id.ToString(), s.CanonicalText, s.CitationLabel }).Select(v => $"{v.Length}:{v}"));
        return Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(material)));
    }
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
        var fingerprint = JsonSerializer.Serialize(new
        {
            season.Status,
            season.PbeEnabled,
            actor.IsActive,
            actor.Kind,
            membership.Role,
            scopes,
            assigned,
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
        }, Json);
        return new(sources, fingerprint);
    }
    public async Task<PbeBank> LoadAsync(PbeBankScope scope, CancellationToken ct = default)
    {
        var initial = await ResolveAsync(scope.OrganizationId, scope.SeasonId, scope.StudentId, ct);
        var allowed = initial.Sources.Where(s => scope.SourceUnitIds.Contains(s.Id)).ToDictionary(s => s.Id);
        var allowedIds = allowed.Keys.ToArray();
        var targets = new List<PbeTarget>(); var records = new List<PbeBankQuestionData>();
        foreach (var kind in new[] { "pbe-target", "pbe-question-head" })
        {
            string? after = null;
            while (true)
            {
                var query = db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == scope.OrganizationId && r.SeasonId == scope.SeasonId && r.Kind == kind && r.OwnerId.HasValue && allowedIds.Contains(r.OwnerId.Value));
                if (after is not null) query = query.Where(r => string.Compare(r.Id, after) > 0);
                var page = await query.OrderBy(r => r.Id).Take(1000).ToListAsync(ct);
                foreach (var row in page)
                {
                    if (kind == "pbe-target") targets.Add(JsonSerializer.Deserialize<PbeTarget>(row.DataJson, Json)!);
                    else { var data = JsonSerializer.Deserialize<PbeBankQuestionData>(row.DataJson, Json)!; if (data.Published && data.SeasonId == scope.SeasonId && data.Question.SchemaVersion == 2) records.Add(data); }
                }
                if (page.Count < 1000) break;
                after = page[^1].Id;
            }
        }
        var byTarget = targets.ToDictionary(t => t.Id);
        var latest = new List<PbeQuestion>();
        foreach (var row in records.GroupBy(r => r.Question.Id).Select(g => g.MaxBy(r => r.Question.Version)!))
        {
            var q = row.Question;
            if (q.SourceUnitIds.Any(id => !allowed.TryGetValue(id, out var source) || source.ContentPackId != q.ContentPackId || source.ContentPack!.SourceType != (q.SourceKind == PbeSourceKind.Scripture ? SourceType.Scripture : SourceType.Supplemental))) continue;
            try
            {
                PbeRubric.Validate(q, q.Parts.Select(p => p.TargetId).Distinct().Where(byTarget.ContainsKey).Select(id => byTarget[id]).ToList());
                if (SourceProof(q, allowed) == row.SourceFingerprint) latest.Add(q);
            }
            catch (ArgumentException) { }
            catch (DomainException) { }
        }
        latest = latest.OrderBy(q => q.Id).ToList();
        var covered = latest.SelectMany(q => q.SourceUnitIds).ToHashSet();
        if ((await ResolveAsync(scope.OrganizationId, scope.SeasonId, scope.StudentId, ct)).Fingerprint != initial.Fingerprint) throw new PbeBankConflictException("The PBE scope changed. Refresh and retry.");
        return new(latest, targets.Where(t => t.SourceUnitIds.All(allowed.ContainsKey)).ToList(), allowed.Keys.Where(id => !covered.Contains(id)).Order().ToList());
    }
}
