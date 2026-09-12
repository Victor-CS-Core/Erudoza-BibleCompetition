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
    internal static string NormalizeEvidence(string value) => System.Text.RegularExpressions.Regex.Replace(value.Normalize(System.Text.NormalizationForm.FormC), "[ \t\r\n\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+", " ").Trim(' ');
    public static string SourceProof(PbeQuestion question, IReadOnlyDictionary<Guid, SourceUnit> sources) => SourceProof(question, sources.ToDictionary(p => p.Key, p => PbeSourceUnit.FromLegacy(p.Value)));
    public static string SourceProof(PbeQuestion question, IReadOnlyDictionary<Guid, PbeSourceUnit> sources)
    {
        if (question.SourceUnitIds.Any(id => !sources.ContainsKey(id))) throw new DomainException("Question source is outside the approved scope.");
        var units = question.SourceUnitIds.Select(id => sources[id]).ToList();
        if (NormalizeEvidence(question.Reference) != NormalizeEvidence(string.Join("; ", units.Select(s => s.CitationLabel))) || !NormalizeEvidence(string.Join("\n", units.Select(s => s.CanonicalText))).Contains(NormalizeEvidence(question.Evidence), StringComparison.Ordinal)) throw new DomainException("Reference and evidence must match the declared canonical sources.");
        var material = string.Concat(units.SelectMany(s => new[] { s.Id.ToString(), s.CanonicalText, s.CitationLabel }).Select(v => $"{v.Length}:{v}"));
        return Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(material)));
    }
    public Task<PbeSourceScope> ResolveAsync(Guid organizationId, Guid seasonId, Guid? studentId, CancellationToken ct = default) => new PbeSourceResolver(db, user, competition, assignments).ResolveAsync(organizationId, seasonId, studentId, ct);
    public async Task<PbeBank> LoadAsync(PbeBankScope scope, CancellationToken ct = default)
    {
        var initial = await ResolveAsync(scope.OrganizationId, scope.SeasonId, scope.StudentId, ct);
        return await LoadResolvedAsync(scope, initial, false, ct);
    }
    internal async Task<PbeBank> LoadResolvedAsync(PbeBankScope scope, PbeSourceScope initial, bool guardedWrite, CancellationToken ct)
    {
        var result = await LoadAuthorizedSourcesAsync(db, scope, initial, ct);
        if (!guardedWrite && (await ResolveAsync(scope.OrganizationId, scope.SeasonId, scope.StudentId, ct)).Fingerprint != initial.Fingerprint) throw new PbeBankConflictException("The PBE scope changed. Refresh and retry.");
        return result;
    }
    /// <summary>Internal server consumers must supply a freshly authorized source boundary; no HTTP scope switch.</summary>
    public static async Task<PbeBank> LoadAuthorizedSourcesAsync(IErudozaDbContext db, PbeBankScope scope, PbeSourceScope initial, CancellationToken ct)
    {
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
            if (q.SourceUnitIds.Any(id => !allowed.TryGetValue(id, out var source) || source.ContentPackId != q.ContentPackId || source.SourceKind != q.SourceKind)) continue;
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

        return new(latest, targets.Where(t => t.SourceUnitIds.All(allowed.ContainsKey)).ToList(), allowed.Keys.Where(id => !covered.Contains(id)).Order().ToList());
    }
}
