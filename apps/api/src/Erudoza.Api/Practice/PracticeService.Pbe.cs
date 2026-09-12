using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Practice;

public sealed record PbeEnabledRequest([property: System.Text.Json.Serialization.JsonRequired] bool Enabled);
public sealed record ImportPbeQuestions([property: System.Text.Json.Serialization.JsonRequired] List<PbeQuestion> Questions, [property: System.Text.Json.Serialization.JsonRequired] List<PbeTarget> Targets);
public sealed partial class PracticeService
{
    public async Task<object> PbeMetadata(Guid org, Guid season, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false);
        Guid? student = actor.Admin ? null : actor.Id;
        var resolved = await bank.ResolveAsync(org, season, student, ct);
        var result = await bank.LoadAsync(new(org, season, student, resolved.Sources.Select(s => s.Id).ToList()), ct);
        if ((await bank.ResolveAsync(org, season, student, ct)).Fingerprint != resolved.Fingerprint) throw new PbeBankConflictException("The PBE scope changed. Refresh and retry.");
        if (student is not null) return new { questionCount = result.Questions.Count, targetCount = result.Targets.Count, sourceUnitCount = resolved.Sources.Count, missingSourceUnitIds = result.MissingSourceUnitIds };
        return new { questionCount = result.Questions.Count, targetCount = result.Targets.Count, sourceUnitCount = resolved.Sources.Count, missingSourceUnitIds = result.MissingSourceUnitIds, uncoveredTargets = result.Targets.Count(t => !result.Questions.Any(q => q.Parts.Any(p => p.TargetId == t.Id))), singleVariantTargets = result.Targets.Count(t => result.Questions.Count(q => q.Parts.Any(p => p.TargetId == t.Id)) == 1) };
    }
    public async Task<object> PbeAuthoring(Guid org, Guid season, string? membersAfter, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false); if (!actor.Admin) throw new PracticeForbiddenException();
        var resolved = await bank.ResolveAsync(org, season, null, ct);
        var after = (membersAfter ?? "").ToLowerInvariant();
        var members = await PbeMemberPage(org, season, after).ToListAsync(ct);
        var books = await db.ScopeEntries.Where(e => e.OrganizationId == org && e.SeasonId == season && e.Kind == ScopeEntryKind.Include).Select(e => e.BookKey).Distinct().ToListAsync(ct);
        return new { sources = resolved.Sources.Select(s => new { s.Id, s.ContentPackId, s.SourceKind, s.BookKey, s.Chapter, s.Verse, s.Ordinal, citation = s.CitationLabel, s.CanonicalText }), selectedBookKeys = books.Order().ToList(), pbeEnabled = await db.Seasons.Where(s => s.OrganizationId == org && s.Id == season).Select(s => s.PbeEnabled).SingleAsync(ct), members = members.Take(100), membersNextCursor = members.Count > 100 ? members[99].Id.ToString() : null };
    }
    private sealed record PbeAuthoringMember(Guid Id, string DisplayName);
    // SQL Server uniqueidentifier ordering differs from text ordering. Normalize both
    // the cursor predicate and sort key, including SQLite's uppercase GUID storage.
    private IQueryable<PbeAuthoringMember> PbeMemberPage(Guid org, Guid season, string after) =>
        db.CompetitionMembers.Where(m => m.OrganizationId == org && m.SeasonId == season)
            .Join(db.Users.Where(u => u.IsActive && u.Kind == UserKind.Student && db.OrganizationMembers.Any(o => o.OrganizationId == org && o.UserId == u.Id && o.Role == OrganizationRole.Student)), m => m.UserId, u => u.Id, (m, u) => new { u.Id, u.DisplayName })
            .Where(u => string.Compare(u.Id.ToString().ToLower(), after) > 0).OrderBy(u => u.Id.ToString().ToLower()).Take(101).Select(u => new PbeAuthoringMember(u.Id, u.DisplayName));

    public async Task<object> PbePage(Guid org, Guid season, string kind, int? limit, string? after, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false); if (!actor.Admin) throw new PracticeForbiddenException();
        await bank.ResolveAsync(org, season, null, ct);
        var size = limit ?? 50; var cursor = after ?? "";
        if (size is < 1 or > 100 || cursor.Length > 100) throw new DomainException("Choose a page size from 1 to 100.");
        var rows = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == kind && string.Compare(r.Id, cursor) > 0).OrderBy(r => r.Id).Take(size + 1).ToListAsync(ct);
        if (kind == "pbe-question")
        {
            var data = rows.Take(size).Select(r => JsonSerializer.Deserialize<PbeBankQuestionData>(r.DataJson, PbeQuestionBank.Json)!).ToList();
            var ids = data.Select(r => r.Question.Id.ToString()).Distinct().ToList();
            var heads = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == "pbe-question-head" && ids.Contains(r.Id)).ToListAsync(ct);
            var versions = heads.ToDictionary(r => r.Id, r => JsonSerializer.Deserialize<PbeBankQuestionData>(r.DataJson, PbeQuestionBank.Json)!.Question.Version);
            return new { items = data.Select(r => new { r.Id, r.SeasonId, r.Published, r.Question, publishedHeadVersion = versions.TryGetValue(r.Question.Id.ToString(), out var version) ? (int?)version : null }), nextCursor = rows.Count > size ? rows[size - 1].Id : null };
        }
        return new { items = rows.Take(size).Select(r => JsonSerializer.Deserialize<JsonElement>(r.DataJson)), nextCursor = rows.Count > size ? rows[size - 1].Id : null };
    }
    public async Task PbeTargets(Guid org, Guid season, List<PbeTarget> targets, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false); if (!actor.Admin) throw new PracticeForbiddenException();
        try { if (targets is null || targets.Count is < 1 or > 500 || targets.Any(t => t is null) || targets.Select(t => t.Id).Distinct().Count() != targets.Count) throw new ArgumentException(); foreach (var t in targets) PbeRubric.ValidateTarget(t); }
        catch (ArgumentException) { throw new DomainException("Declare 1–500 valid targets."); }
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var resolved = await bank.ResolveAsync(org, season, null, ct);
        foreach (var t in targets)
        {
            if (t.SourceUnitIds.Any(id => !resolved.Sources.Any(s => s.Id == id))) throw new DomainException("Choose approved season sources.");
            var id = t.Id.ToString(); var json = JsonSerializer.Serialize(t, PbeQuestionBank.Json);
            var prior = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-target" && r.Id == id, ct);
            if (prior is not null) { if (prior.SeasonId != season || prior.DataJson != json) throw new PbeBankConflictException("Target meaning is immutable; declare a new target ID."); }
            else db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = "pbe-target", Id = id, OwnerId = t.SourceUnitIds[0], DataJson = json });
        }
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
    }
    public async Task PbeEnable(Guid org, Guid season, bool enabled, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false); if (!actor.Admin) throw new PracticeForbiddenException();
        await bank.ResolveAsync(org, season, null, ct);
        var row = await db.Seasons.SingleAsync(s => s.OrganizationId == org && s.Id == season, ct);
        row.PbeEnabled = enabled; await db.SaveChangesAsync(ct);
    }
    public async Task PbeImport(Guid org, Guid season, ImportPbeQuestions input, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false); if (!actor.Admin) throw new PracticeForbiddenException();
        if (input.Questions is null || input.Questions.Count is < 1 or > 100 || input.Targets is null || input.Targets.Count > 500) throw new DomainException("Import 1–100 questions with at most 500 targets.");
        try
        {
            foreach (var q in input.Questions) { if (q is null) throw new ArgumentException(); PbeRubric.Validate(q, input.Targets.Where(t => t is not null && q.Parts is not null && q.Parts.Any(p => p is not null && p.TargetId == t.Id)).ToList()); }
            if (input.Targets.Any(t => t is null || !input.Questions.Any(q => q.Parts.Any(p => p.TargetId == t.Id)))) throw new ArgumentException();
        }
        catch (ArgumentException) { throw new DomainException("Malformed PBE question or target."); }
        if (input.Targets.Select(t => t.Id).Distinct().Count() != input.Targets.Count || input.Questions.Select(q => (q.Id, q.Version)).Distinct().Count() != input.Questions.Count) throw new DomainException("Duplicate question or target identities.");
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var resolved = await bank.ResolveAsync(org, season, null, ct);
        var sources = resolved.Sources.ToDictionary(s => s.Id);
        foreach (var q in input.Questions)
            if (q.SourceUnitIds.Any(id => !sources.TryGetValue(id, out var s) || s.ContentPackId != q.ContentPackId || s.SourceKind != q.SourceKind)) throw new DomainException("Each source must be approved season content of the declared kind.");
        foreach (var target in input.Targets)
        {
            var id = target.Id.ToString(); var json = JsonSerializer.Serialize(target, PbeQuestionBank.Json);
            var existing = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-target" && r.Id == id, ct);
            if (existing is not null) { if (existing.SeasonId != season || existing.DataJson != json) throw new PbeBankConflictException("Target meaning is immutable; declare a new target ID."); }
            else db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = "pbe-target", OwnerId = target.SourceUnitIds[0], Id = id, DataJson = json });
        }
        foreach (var q in input.Questions)
        {
            var prefix = $"{q.Id}:";
            if (await db.PbeTrainingRecords.AnyAsync(r => r.OrganizationId == org && r.Kind == "pbe-question" && r.Id.StartsWith(prefix) && r.SeasonId != season, ct)) throw new PbeBankConflictException("Declare a new question ID for this season.");
            var id = $"{q.Id}:{q.Version}";
            if (await db.PbeTrainingRecords.AnyAsync(r => r.OrganizationId == org && r.Kind == "pbe-question" && r.Id == id, ct)) throw new PbeBankConflictException("This question version already exists.");
            db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = "pbe-question", Id = id, DataJson = JsonSerializer.Serialize(new PbeBankQuestionData(id, season, false, q, PbeQuestionBank.SourceProof(q, sources)), PbeQuestionBank.Json) });
        }
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
    }
    public async Task PbePublish(Guid org, Guid season, Guid id, int version, PracticeActor actor, IPbeQuestionBank bank, CancellationToken ct)
    {
        await Check(actor, org, ct, false); if (!actor.Admin) throw new PracticeForbiddenException();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var resolved = await bank.ResolveAsync(org, season, null, ct);
        var key = $"{id}:{version}";
        var row = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == "pbe-question" && r.Id == key, ct) ?? throw new DomainException("Question was not found in this season.");
        var data = JsonSerializer.Deserialize<PbeBankQuestionData>(row.DataJson, PbeQuestionBank.Json)!;
        var ids = data.Question.Parts.Select(p => p.TargetId.ToString()).Distinct().ToArray();
        var targets = await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == "pbe-target" && ids.Contains(r.Id)).ToListAsync(ct);
        try { PbeRubric.Validate(data.Question, targets.Select(t => JsonSerializer.Deserialize<PbeTarget>(t.DataJson, PbeQuestionBank.Json)!).ToList()); }
        catch (ArgumentException) { throw new DomainException("Malformed PBE question or target."); }
        if (data.Question.SourceUnitIds.Any(id => !resolved.Sources.Any(s => s.Id == id && s.ContentPackId == data.Question.ContentPackId && s.SourceKind == data.Question.SourceKind))) throw new DomainException("Question sources are no longer in the approved season scope.");
        if (PbeQuestionBank.SourceProof(data.Question, resolved.Sources.ToDictionary(s => s.Id)) != data.SourceFingerprint) throw new PbeBankConflictException("Question sources changed; import a new version.");
        row.DataJson = JsonSerializer.Serialize(data with { Published = true }, PbeQuestionBank.Json); row.Revision++;
        var headId = id.ToString();
        var head = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-question-head" && r.Id == headId, ct);
        if (head is not null && head.SeasonId != season) throw new PbeBankConflictException("Declare a new question ID for this season.");
        if (head is null) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = "pbe-question-head", Id = headId, OwnerId = data.Question.SourceUnitId, DataJson = row.DataJson });
        else if (JsonSerializer.Deserialize<PbeBankQuestionData>(head.DataJson, PbeQuestionBank.Json)!.Question.Version < version) { head.DataJson = row.DataJson; head.OwnerId = data.Question.SourceUnitId; head.Revision++; }
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
    }
}
