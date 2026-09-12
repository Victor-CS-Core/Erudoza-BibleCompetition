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
        return new { questionCount = result.Questions.Count, targetCount = result.Targets.Count, sourceUnitCount = resolved.Sources.Count, missingSourceUnitIds = result.MissingSourceUnitIds };
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
            if (q.SourceUnitIds.Any(id => !sources.TryGetValue(id, out var s) || s.ContentPackId != q.ContentPackId || s.ContentPack!.SourceType != (q.SourceKind == PbeSourceKind.Scripture ? SourceType.Scripture : SourceType.Supplemental))) throw new DomainException("Each source must be approved season content of the declared kind.");
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
        if (data.Question.SourceUnitIds.Any(id => !resolved.Sources.Any(s => s.Id == id && s.ContentPackId == data.Question.ContentPackId && s.ContentPack!.SourceType == (data.Question.SourceKind == PbeSourceKind.Scripture ? SourceType.Scripture : SourceType.Supplemental)))) throw new DomainException("Question sources are no longer in the approved season scope.");
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
