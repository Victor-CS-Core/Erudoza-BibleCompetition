using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed record PbeEvidenceRef(string Id, string EventId, string AttemptRecordId, long AcceptedSequence, string? QuestionKind, PbeRecallEvidence Evidence);
public sealed record PbeEvidenceIndex(string Id, bool Ready, string After, long CoveredLegacyEvents);
public sealed record PbeEvidenceDirty(string Id, Guid TargetId, long Generation, long CompletedGeneration);
public sealed record PbeAttemptReview(string Id, Guid QuestionId, string Status, Dictionary<Guid, int> PointsByTarget);
public sealed record PbeReplayJob(string Id, long Generation, string After, PbeReviewProjection Projection, int PendingCount);
/// <summary>Immutable acceptance chronology plus a separate final-grade overlay. Never calls the acceptance append adapter.</summary>
public sealed class PbeEvidenceReplayService(IErudozaDbContext db, PbeProgressService progress)
{
    static string Owner(Guid owner, Guid season) => $"{owner}:{season}";
    static string Target(PbeDispute d, Guid target) => $"{Owner(d.ParticipantIds[0], d.SeasonId)}:{target}";
    static T Read<T>(PbeTrainingRecord row) => JsonSerializer.Deserialize<T>(row.DataJson, PbeQuestionBank.Json)!;
    IQueryable<PbeTrainingRecord> Rows(Guid org, string kind) => db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.Kind == kind);
    Task<PbeTrainingRecord?> Get(Guid org, string kind, string id, CancellationToken ct) => Rows(org, kind).SingleOrDefaultAsync(r => r.Id == id, ct);
    void Write(PbeDispute d, string kind, string id, object value, PbeTrainingRecord? row)
    {
        if (row is null) db.PbeTrainingRecords.Add(new() { OrganizationId = d.OrganizationId, SeasonId = d.SeasonId, OwnerId = d.ParticipantIds[0], Kind = kind, Id = id, DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json) });
        else { row.DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json); row.Revision++; }
    }
    public static IEnumerable<PbeEvidenceRef> References(Guid owner, Guid season, PbeProgressService.RecallEvent e) => e.Evidence.Select(part => new PbeEvidenceRef($"{Owner(owner, season)}:{part.TargetId}:{e.AcceptedSequence:D16}:{part.AttemptId}", e.Id, part.AttemptId.ToString(), e.AcceptedSequence, e.QuestionKind, part));
    public async Task StageDispute(PbeDispute d, CancellationToken ct)
    {
        if (d.Activity != "Solo") return; var targets = d.Question.Parts.Select(p => p.TargetId).Distinct().ToArray(); var ids = targets.Select(t => Target(d, t)).ToArray();
        var dirty = await Rows(d.OrganizationId, "pbe-evidence-dirty").Where(r => ids.Contains(r.Id)).ToListAsync(ct); var proofs = await Rows(d.OrganizationId, "pbe-target-review").Where(r => ids.Contains(r.Id)).ToListAsync(ct);
        foreach (var t in targets) { var id = Target(d, t); var row = dirty.SingleOrDefault(r => r.Id == id); var old = row is null ? null : Read<PbeEvidenceDirty>(row); var proof = proofs.SingleOrDefault(r => r.Id == id) ?? throw new PbeProgressConflictException("Saved target evidence is unavailable."); Write(d, "pbe-evidence-dirty", id, new PbeEvidenceDirty(id, t, (old?.Generation ?? 0) + 1, old?.CompletedGeneration ?? 0), row); Write(d, "pbe-target-review", id, Read<PbeReviewProjection>(proof) with { Provisional = true }, proof); }
        var attemptId = $"{Owner(d.ParticipantIds[0], d.SeasonId)}:{d.AttemptId}"; var points = new Dictionary<Guid, int>(); if (d.Resolution is not null) for (var i = 0; i < d.Question.Parts.Count; i++) { var target = d.Question.Parts[i].TargetId; points[target] = points.GetValueOrDefault(target) + d.Resolution.PointsByPart[i]; }
        Write(d, "pbe-attempt-review", attemptId, new PbeAttemptReview(attemptId, d.QuestionId, d.Status, points), await Get(d.OrganizationId, "pbe-attempt-review", attemptId, ct));
    }
    async Task<bool> IndexPage(PbeDispute d, CancellationToken ct)
    {
        var owner = d.ParticipantIds[0]; var id = Owner(owner, d.SeasonId); var row = await Get(d.OrganizationId, "pbe-evidence-index", id, ct); var index = row is null ? null : Read<PbeEvidenceIndex>(row); if (index?.Ready == true) return true;
        var after = index?.After ?? ""; var events = await Rows(d.OrganizationId, "pbe-recall-event").Where(r => r.SeasonId == d.SeasonId && r.OwnerId == owner && string.Compare(r.Id, after) > 0).OrderBy(r => r.Id).Take(26).ToListAsync(ct); var page = events.Take(25).ToList();
        var refs = page.SelectMany(r => References(owner, d.SeasonId, Read<PbeProgressService.RecallEvent>(r))).ToList(); var ids = refs.Select(r => r.Id).ToArray(); var existing = await Rows(d.OrganizationId, "pbe-evidence-ref").Where(r => ids.Contains(r.Id)).Select(r => r.Id).ToListAsync(ct);
        foreach (var reference in refs.Where(r => !existing.Contains(r.Id))) Write(d, "pbe-evidence-ref", reference.Id, reference, null);
        Write(d, "pbe-evidence-index", id, new PbeEvidenceIndex(id, events.Count <= 25, page.LastOrDefault()?.Id ?? after, (index?.CoveredLegacyEvents ?? 0) + page.Count), row); return false;
    }
    public Task<object> Continue(PbeDispute d, CancellationToken ct) => progress.ExecuteAsync<object>(async token =>
    {
        if (d.Activity != "Solo") return new { status = "Ready", indexReady = true, proofs = Array.Empty<object>() };
        if (!await IndexPage(d, token)) return new { status = "Provisional", stage = "Indexing", indexReady = false, d.Revision };
        var owner = d.ParticipantIds[0]; var ids = d.Question.Parts.Select(p => Target(d, p.TargetId)).Distinct().ToArray(); var dirtyRows = await Rows(d.OrganizationId, "pbe-evidence-dirty").Where(r => ids.Contains(r.Id)).ToListAsync(token); var next = dirtyRows.FirstOrDefault(r => { var v = Read<PbeEvidenceDirty>(r); return v.CompletedGeneration != v.Generation; });
        if (next is null) { var proofs = await Rows(d.OrganizationId, "pbe-target-review").Where(r => ids.Contains(r.Id)).ToListAsync(token); return new { status = "Ready", indexReady = true, d.Revision, proofs = proofs.Select(r => new { revision = r.Revision, proof = Read<PbeReviewProjection>(r) }) }; }
        var dirty = Read<PbeEvidenceDirty>(next); var id = dirty.Id; var oldJob = await Get(d.OrganizationId, "pbe-evidence-replay", id, token); var priorJob = oldJob is null ? null : Read<PbeReplayJob>(oldJob); var job = priorJob?.Generation == dirty.Generation ? priorJob : new PbeReplayJob(id, dirty.Generation, id + ":", new(id, dirty.TargetId, PbeReviewRules.Initial(dirty.TargetId), 0, null, Guid.Empty, null, true), 0);
        // Serializable range read includes concurrent new references; acceptance and this projection use the same transaction isolation.
        var upper = id + ";"; var records = await Rows(d.OrganizationId, "pbe-evidence-ref").Where(r => r.SeasonId == d.SeasonId && r.OwnerId == owner && string.Compare(r.Id, job.After) > 0 && string.Compare(r.Id, upper) < 0).OrderBy(r => r.Id).Take(33).ToListAsync(token); var page = records.Take(32).Select(Read<PbeEvidenceRef>).ToList();
        if (page.Count == 0 && job.Projection.AcceptedSequence == 0)
        {
            var indexId = Owner(owner, d.SeasonId); var index = await Get(d.OrganizationId, "pbe-evidence-index", indexId, token);
            Write(d, "pbe-evidence-index", indexId, new PbeEvidenceIndex(indexId, false, "", 0), index);
            return new { status = "Provisional", stage = "Indexing", indexReady = false, d.Revision };
        }
        var reviewIds = page.Select(r => $"{Owner(owner, d.SeasonId)}:{r.AttemptRecordId}").ToArray(); var reviews = (await Rows(d.OrganizationId, "pbe-attempt-review").Where(r => reviewIds.Contains(r.Id)).ToListAsync(token)).Select(Read<PbeAttemptReview>).ToDictionary(r => r.Id);
        foreach (var reference in page)
        {
            var e = reference.Evidence; var pendingCount = job.PendingCount;
            if (reviews.TryGetValue($"{Owner(owner, d.SeasonId)}:{e.AttemptId}", out var review)) { if (review.QuestionId != e.QuestionId) throw new PbeProgressConflictException("Saved evidence membership changed."); if (review.Status == "Pending") { pendingCount++; e = e with { EarnedPoints = 0 }; } else e = e with { EarnedPoints = review.PointsByTarget.GetValueOrDefault(e.TargetId, e.EarnedPoints) }; }
            var result = PbeReviewRules.Advance(job.Projection.Review, e); var proof = job.Projection with { Review = result, AcceptedSequence = reference.AcceptedSequence, LastAnsweredQuestionId = e.QuestionId, LastAnsweredQuestionKind = reference.QuestionKind, FailedSequence = e.Recall && e.EarnedPoints < e.AvailablePoints ? reference.AcceptedSequence : result.Unresolved ? job.Projection.FailedSequence : null }; job = job with { After = reference.Id, Projection = proof, PendingCount = pendingCount };
        }
        Write(d, "pbe-evidence-replay", id, job, oldJob); var complete = records.Count <= 32;
        if (complete) { Write(d, "pbe-target-review", id, job.Projection with { Provisional = job.PendingCount > 0, PendingCount = job.PendingCount, EvidenceGeneration = job.Generation }, await Get(d.OrganizationId, "pbe-target-review", id, token)); Write(d, "pbe-evidence-dirty", id, dirty with { CompletedGeneration = job.Generation }, next); }
        return new { status = "Provisional", stage = "Replaying", indexReady = true, d.Revision, dirty.TargetId, processed = page.Count, targetComplete = complete };
    }, ct);
    public async Task<object> Page(PbeDispute d, Guid targetId, string? after, CancellationToken ct)
    {
        if (d.Activity != "Solo" || !d.Question.Parts.Any(p => p.TargetId == targetId)) throw new UnauthorizedAccessException();
        var id = Target(d, targetId); if (!string.IsNullOrEmpty(after) && !after.StartsWith(id + ":", StringComparison.Ordinal)) throw new DomainException("Invalid evidence cursor.");
        var owner = d.ParticipantIds[0]; var indexRow = await Get(d.OrganizationId, "pbe-evidence-index", Owner(owner, d.SeasonId), ct); var dirtyRow = await Get(d.OrganizationId, "pbe-evidence-dirty", id, ct); var proofRow = await Get(d.OrganizationId, "pbe-target-review", id, ct); var index = indexRow is null ? null : Read<PbeEvidenceIndex>(indexRow); var dirty = dirtyRow is null ? null : Read<PbeEvidenceDirty>(dirtyRow); var proof = proofRow is null ? null : Read<PbeReviewProjection>(proofRow);
        var lower = string.IsNullOrEmpty(after) ? id + ":" : after; var upper = id + ";"; var rows = await Rows(d.OrganizationId, "pbe-evidence-ref").Where(r => r.SeasonId == d.SeasonId && r.OwnerId == owner && string.Compare(r.Id, lower) > 0 && string.Compare(r.Id, upper) < 0).OrderBy(r => r.Id).Take(33).ToListAsync(ct); var refs = rows.Take(32).Select(Read<PbeEvidenceRef>).ToList(); var aids = refs.Select(r => r.AttemptRecordId).ToArray(); var attempts = await Rows(d.OrganizationId, "pbe-attempt").Where(r => aids.Contains(r.Id)).ToListAsync(ct); var byId = attempts.ToDictionary(r => r.Id, r => JsonDocument.Parse(r.DataJson));
        var gradeIds = refs.Select(r => $"{Owner(owner, d.SeasonId)}:{r.AttemptRecordId}").ToArray(); var grades = (await Rows(d.OrganizationId, "pbe-attempt-review").Where(r => gradeIds.Contains(r.Id)).ToListAsync(ct)).Select(Read<PbeAttemptReview>).ToDictionary(r => r.Id);
        var ready = index?.Ready == true && dirty is not null && dirty.CompletedGeneration == dirty.Generation;
        var items = refs.Select(r => { var saved = byId.GetValueOrDefault(r.AttemptRecordId)?.RootElement; var grade = grades.GetValueOrDefault($"{Owner(owner, d.SeasonId)}:{r.AttemptRecordId}"); return new { gradeStatus = grade?.Status ?? "Final", finalEvidence = grade?.Status == "Pending" ? null : r.Evidence with { EarnedPoints = grade?.PointsByTarget.GetValueOrDefault(r.Evidence.TargetId, r.Evidence.EarnedPoints) ?? r.Evidence.EarnedPoints }, r.Id, r.EventId, r.AttemptRecordId, r.AcceptedSequence, r.QuestionKind, r.Evidence, responseLockedAtUtc = saved.HasValue && saved.Value.TryGetProperty("responseLockedAtUtc", out var locked) && locked.ValueKind == JsonValueKind.String ? locked.GetString() : null, originalAcceptedAtMs = saved.HasValue && saved.Value.TryGetProperty("atMs", out var at) ? (long?)at.GetInt64() : null }; }).ToList(); foreach (var doc in byId.Values) doc.Dispose();
        return new { indexReady = index?.Ready ?? false, status = ready ? "Ready" : "Provisional", provisional = !ready || proof?.Provisional != false, revision = proofRow?.Revision, evidenceGeneration = dirty?.Generation, proof, items, nextCursor = rows.Count > 32 ? refs[31].Id : null };
    }
}
