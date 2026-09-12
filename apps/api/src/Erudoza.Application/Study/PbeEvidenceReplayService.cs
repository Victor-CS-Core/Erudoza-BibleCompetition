using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed record PbeEvidenceRef(string Id, string EventId, string AttemptRecordId, long AcceptedSequence, string? QuestionKind, PbeRecallEvidence Evidence, int? QuestionVersion = null, long? ResponseLockedAtMs = null);
public sealed record PbeEvidenceIndex(string Id, bool Ready, string After, long CoveredLegacyEvents);
public sealed record PbeEvidenceDirty(string Id, Guid TargetId, long Generation, long CompletedGeneration);
public sealed record PbeAttemptReview(string Id, Guid QuestionId, string Status, Dictionary<Guid, int> PointsByTarget);
public sealed record PbeEvidenceOwner(Guid OrganizationId, Guid SeasonId, Guid StudentId);
public sealed record PbeReplayJob(string Id, long Generation, string After, PbeReviewProjection Projection, int PendingCount, bool MissingReferenceRepairAttempted = false);
/// <summary>Immutable acceptance chronology plus a separate final-grade overlay. Never calls the acceptance append adapter.</summary>
public sealed class PbeEvidenceReplayService(IErudozaDbContext db, PbeProgressService progress, IPbeChapterJsonReader? metadata = null)
{
    static PbeEvidenceOwner Scope(PbeDispute d) => new(d.OrganizationId, d.SeasonId, d.ParticipantIds[0]);
    static string Owner(Guid owner, Guid season) => $"{owner}:{season}";
    static string Target(PbeDispute d, Guid target) => $"{Owner(d.ParticipantIds[0], d.SeasonId)}:{target}";
    static T Read<T>(PbeTrainingRecord row) => JsonSerializer.Deserialize<T>(row.DataJson, PbeQuestionBank.Json)!;
    IQueryable<PbeTrainingRecord> Rows(Guid org, string kind) => db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.Kind == kind);
    Task<PbeTrainingRecord?> Get(Guid org, string kind, string id, CancellationToken ct) => Rows(org, kind).SingleOrDefaultAsync(r => r.Id == id, ct);
    void Write(PbeEvidenceOwner d, string kind, string id, object value, PbeTrainingRecord? row)
    {
        if (row is null) db.PbeTrainingRecords.Add(new() { OrganizationId = d.OrganizationId, SeasonId = d.SeasonId, OwnerId = d.StudentId, Kind = kind, Id = id, DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json) });
        else { row.DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json); row.Revision++; }
    }
    public static IEnumerable<PbeEvidenceRef> References(Guid owner, Guid season, PbeProgressService.RecallEvent e) => e.Evidence.Select(part => new PbeEvidenceRef($"{Owner(owner, season)}:{part.TargetId}:{e.AcceptedSequence:D16}:{part.AttemptId}", e.Id, part.AttemptId.ToString(), e.AcceptedSequence, e.QuestionKind, part, e.QuestionVersion, e.ResponseLockedAtMs));
    public async Task StageDispute(PbeDispute d, CancellationToken ct)
    {
        if (d.Activity != "Solo") return; var targets = d.Question.Parts.Select(p => p.TargetId).Distinct().ToArray(); var ids = targets.Select(t => Target(d, t)).ToArray();
        var dirty = await Rows(d.OrganizationId, "pbe-evidence-dirty").Where(r => ids.Contains(r.Id)).ToListAsync(ct); var proofs = await Rows(d.OrganizationId, "pbe-target-review").Where(r => ids.Contains(r.Id)).ToListAsync(ct);
        foreach (var t in targets) { var id = Target(d, t); var row = dirty.SingleOrDefault(r => r.Id == id); var old = row is null ? null : Read<PbeEvidenceDirty>(row); var proof = proofs.SingleOrDefault(r => r.Id == id) ?? throw new PbeProgressConflictException("Saved target evidence is unavailable."); Write(Scope(d), "pbe-evidence-dirty", id, new PbeEvidenceDirty(id, t, (old?.Generation ?? 0) + 1, old?.CompletedGeneration ?? 0), row); Write(Scope(d), "pbe-target-review", id, Read<PbeReviewProjection>(proof) with { Provisional = true }, proof); }
        var attemptId = $"{Owner(d.ParticipantIds[0], d.SeasonId)}:{d.AttemptId}"; var points = new Dictionary<Guid, int>(); if (d.Resolution is not null) for (var i = 0; i < d.Question.Parts.Count; i++) { var target = d.Question.Parts[i].TargetId; points[target] = points.GetValueOrDefault(target) + d.Resolution.PointsByPart[i]; }
        Write(Scope(d), "pbe-attempt-review", attemptId, new PbeAttemptReview(attemptId, d.QuestionId, d.Status, points), await Get(d.OrganizationId, "pbe-attempt-review", attemptId, ct));
    }
    internal async Task<bool> IndexPage(PbeEvidenceOwner d, CancellationToken ct)
    {
        var owner = d.StudentId; var id = Owner(owner, d.SeasonId); var row = await Get(d.OrganizationId, "pbe-evidence-index", id, ct); var index = row is null ? null : Read<PbeEvidenceIndex>(row); if (index?.Ready == true) return true;
        var after = index?.After ?? "";
        var events = metadata is null
            ? await Rows(d.OrganizationId, "pbe-recall-event").Where(r => r.SeasonId == d.SeasonId && r.OwnerId == owner && string.Compare(r.Id, after) > 0).OrderBy(r => r.Id).Take(25).ToListAsync(ct)
            : await metadata.LegacyEventPage(d.OrganizationId, d.SeasonId, owner, after, ct);
        if (events.Any(e => System.Text.Encoding.UTF8.GetByteCount(e.DataJson) > 64000)) throw new PbeChapterLimitException("InputTooLarge");
        var page = new List<PbeTrainingRecord>(); var refs = new List<PbeEvidenceRef>();
        foreach (var item in events)
        {
            var next = refs.Concat(References(owner, d.SeasonId, Read<PbeProgressService.RecallEvent>(item))).ToArray();
            if (next.Length > 32 || System.Text.Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(next, PbeQuestionBank.Json)) > 64000) break;
            refs = next.ToList(); page.Add(item);
        }
        if (events.Count > 0 && page.Count == 0) throw new PbeChapterLimitException("InputTooLarge");
        var ids = refs.Select(r => r.Id).ToArray(); var existing = await Rows(d.OrganizationId, "pbe-evidence-ref").Where(r => ids.Contains(r.Id)).Select(r => r.Id).ToListAsync(ct);
        foreach (var reference in refs.Where(r => !existing.Contains(r.Id))) Write(d, "pbe-evidence-ref", reference.Id, reference, null);
        // A following empty page proves completion when either row or byte budget shortened the prefix.
        Write(d, "pbe-evidence-index", id, new PbeEvidenceIndex(id, events.Count == 0, page.LastOrDefault()?.Id ?? after, (index?.CoveredLegacyEvents ?? 0) + page.Count), row); return false;
    }
    public Task<object> Continue(PbeDispute d, CancellationToken ct) => progress.ExecuteAsync<object>(async token =>
    {
        if (d.Activity != "Solo") return new { status = "Ready", indexReady = true, proofs = Array.Empty<object>() };
        var scope = Scope(d);
        var result = await ContinueTargets(scope, d.Question.Parts.Select(p => p.TargetId).Distinct().ToArray(), token);
        if (result.Status == "Ready")
        {
            var correction = await Get(d.OrganizationId, "pbe-dispute-correction", d.Id, token);
            if (correction is not null) db.PbeTrainingRecords.Remove(correction);
        }
        return result;
    }, ct);

    public sealed record ReplayStep(string Status, string? Stage, bool IndexReady, Guid? TargetId = null, int Processed = 0, bool TargetComplete = false);

    /// <summary>Caller holds the shared serializable transaction. One index/evidence page feeds both folds.</summary>
    internal async Task<ReplayStep> ContinueTargets(PbeEvidenceOwner d, IReadOnlyList<Guid> targets, CancellationToken token)
    {
        if (targets.Count > 128) throw new ArgumentException("Bound the target replay page.");
        if (!await IndexPage(d, token)) return new("Provisional", "Indexing", false);
        if (metadata is not null)
        {
            var states = await metadata.ReplayStates(d.OrganizationId, d.SeasonId, d.StudentId, targets, token);
            var untouched = states.Where(s => s.NeedsReplay && !s.HasProjection && !s.HasEvidence).Take(32).ToArray();
            if (untouched.Length > 0)
            {
                foreach (var target in untouched)
                {
                    var key = $"{Owner(d.StudentId, d.SeasonId)}:{target.TargetId}";
                    Write(d, "pbe-target-review", key, new PbeReviewProjection(key, target.TargetId, PbeReviewRules.Initial(target.TargetId), 0, null, Guid.Empty, null, Retention: PbeChapterRules.InitialRetention()), null);
                }
                return new("Provisional", "Replaying", true);
            }
            var candidate = states.FirstOrDefault(s => s.NeedsReplay);
            if (candidate is null) return new("Ready", null, true);
            var targetKey = $"{Owner(d.StudentId, d.SeasonId)}:{candidate.TargetId}";
            var dirtyRow = await Get(d.OrganizationId, "pbe-evidence-dirty", targetKey, token);
            var proofRow = await Get(d.OrganizationId, "pbe-target-review", targetKey, token);
            return await ReplayTarget(d, candidate.TargetId, dirtyRow, dirtyRow is null ? null : Read<PbeEvidenceDirty>(dirtyRow), proofRow, proofRow is null ? null : Read<PbeReviewProjection>(proofRow), token);
        }
        var ids = targets.Select(t => $"{Owner(d.StudentId, d.SeasonId)}:{t}").ToArray();
        var dirtyRows = await Rows(d.OrganizationId, "pbe-evidence-dirty").Where(r => ids.Contains(r.Id)).ToListAsync(token);
        var proofs = await Rows(d.OrganizationId, "pbe-target-review").Where(r => ids.Contains(r.Id)).ToListAsync(token);
        foreach (var target in targets)
        {
            var id = $"{Owner(d.StudentId, d.SeasonId)}:{target}";
            var dirtyRow = dirtyRows.SingleOrDefault(r => r.Id == id);
            var dirty = dirtyRow is null ? null : Read<PbeEvidenceDirty>(dirtyRow);
            var proofRow = proofs.SingleOrDefault(r => r.Id == id);
            var proof = proofRow is null ? null : Read<PbeReviewProjection>(proofRow);
            if (dirty is null && proof?.Retention?.DataGap == true || dirty is not null && dirty.Generation != dirty.CompletedGeneration || proof?.Retention?.RuleVersion != PbeChapterRules.RetentionRuleVersion)
                return await ReplayTarget(d, target, dirtyRow, dirty, proofRow, proof, token);
        }
        return new("Ready", null, true);
    }

    async Task<ReplayStep> ReplayTarget(PbeEvidenceOwner d, Guid target, PbeTrainingRecord? dirtyRow, PbeEvidenceDirty? savedDirty,
        PbeTrainingRecord? proofRow, PbeReviewProjection? savedProof, CancellationToken token)
    {
        var id = $"{Owner(d.StudentId, d.SeasonId)}:{target}";
        var dirty = savedDirty ?? new PbeEvidenceDirty(id, target, 1, 0);
        var oldJob = await Get(d.OrganizationId, "pbe-evidence-replay", id, token);
        var priorJob = oldJob is null ? null : Read<PbeReplayJob>(oldJob);
        var job = priorJob?.Generation == dirty.Generation ? priorJob : new PbeReplayJob(id, dirty.Generation, id + ":",
            new(id, target, PbeReviewRules.Initial(target), 0, null, Guid.Empty, null, true, Retention: PbeChapterRules.InitialRetention()), 0);
        var upper = id + ";";
        var records = await Rows(d.OrganizationId, "pbe-evidence-ref").Where(r => r.SeasonId == d.SeasonId && r.OwnerId == d.StudentId && string.Compare(r.Id, job.After) > 0 && string.Compare(r.Id, upper) < 0).OrderBy(r => r.Id).Take(33).ToListAsync(token);
        var page = records.Take(32).Select(Read<PbeEvidenceRef>).ToArray();
        var reviewIds = page.Select(r => $"{Owner(d.StudentId, d.SeasonId)}:{r.AttemptRecordId}").ToArray();
        var reviews = (await Rows(d.OrganizationId, "pbe-attempt-review").Where(r => reviewIds.Contains(r.Id)).ToListAsync(token)).Select(Read<PbeAttemptReview>).ToDictionary(r => r.Id);
        var normalized = await Normalize(d, page, token);
        foreach (var (reference, frozen) in normalized)
        {
            var e = reference.Evidence;
            var pending = false;
            if (reviews.TryGetValue($"{Owner(d.StudentId, d.SeasonId)}:{e.AttemptId}", out var review))
            {
                if (review.QuestionId != e.QuestionId) throw new PbeProgressConflictException("Saved evidence membership changed.");
                pending = review.Status == "Pending";
                e = e with { EarnedPoints = pending ? 0 : review.PointsByTarget.GetValueOrDefault(e.TargetId, e.EarnedPoints) };
            }
            var result = PbeReviewRules.Advance(job.Projection.Review, e);
            var retention = PbeChapterRules.AdvanceRetention(job.Projection.Retention ?? PbeChapterRules.InitialRetention(),
                new(e.TargetId, e.QuestionId, frozen.Version ?? 0, e.AttemptId, frozen.LockAtMs ?? e.AtMs, reference.AcceptedSequence,
                    e.EarnedPoints == e.AvailablePoints, e.Unaided, !pending, e.Recall, "Solo"), frozen.Version is null);
            var projection = job.Projection with
            {
                Review = result,
                Retention = retention,
                AcceptedSequence = reference.AcceptedSequence,
                LastAnsweredQuestionId = e.QuestionId,
                LastAnsweredQuestionKind = reference.QuestionKind,
                FailedSequence = e.Recall && e.EarnedPoints < e.AvailablePoints ? reference.AcceptedSequence : result.Unresolved ? job.Projection.FailedSequence : null
            };
            job = job with { After = reference.Id, Projection = projection, PendingCount = job.PendingCount + (pending ? 1 : 0) };
        }
        if (page.Length == 0 && job.Projection.AcceptedSequence == 0 && savedProof?.AcceptedSequence > 0)
        {
            // Repair missing references once from their immutable event index, then remain fail-closed for a true data gap.
            var indexId = Owner(d.StudentId, d.SeasonId);
            var indexRow = await Get(d.OrganizationId, "pbe-evidence-index", indexId, token);
            var index = indexRow is null ? null : Read<PbeEvidenceIndex>(indexRow);
            if (!job.MissingReferenceRepairAttempted)
            {
                Write(d, "pbe-evidence-index", indexId, new PbeEvidenceIndex(indexId, false, "", 0), indexRow);
                Write(d, "pbe-evidence-replay", id, job with { MissingReferenceRepairAttempted = true }, oldJob);
                return new("Provisional", "Indexing", false);
            }
            job = job with { Projection = savedProof with { Retention = PbeChapterRules.InitialRetention() with { DataGap = true } } };
        }
        var complete = records.Count <= 32;
        Write(d, "pbe-evidence-replay", id, job, oldJob);
        Write(d, "pbe-evidence-dirty", id, dirty with { CompletedGeneration = complete ? job.Generation : dirty.CompletedGeneration }, dirtyRow);
        if (complete) Write(d, "pbe-target-review", id, job.Projection with { Provisional = job.PendingCount > 0, PendingCount = job.PendingCount, EvidenceGeneration = job.Generation }, proofRow);
        return new("Provisional", "Replaying", true, target, page.Length, complete);
    }

    sealed record FrozenProvenance(int? Version, long? LockAtMs);
    async Task<IReadOnlyList<(PbeEvidenceRef Reference, FrozenProvenance Frozen)>> Normalize(PbeEvidenceOwner scope, IReadOnlyList<PbeEvidenceRef> page, CancellationToken ct)
    {
        var missing = page.Where(r => r.QuestionVersion is null).Select(r => r.AttemptRecordId).Distinct().ToArray();
        if (metadata is not null)
        {
            var frozen = (await metadata.FrozenMetadata(scope.OrganizationId, scope.SeasonId, scope.StudentId, missing, ct)).ToDictionary(r => r.AttemptId);
            return page.Select(reference =>
            {
                if (reference.QuestionVersion.HasValue) return (reference, new FrozenProvenance(reference.QuestionVersion, reference.ResponseLockedAtMs));
                var saved = frozen.GetValueOrDefault(reference.AttemptRecordId);
                return (reference, saved is not null && saved.QuestionId == reference.Evidence.QuestionId && saved.TargetIds.Contains(reference.Evidence.TargetId)
                    ? new FrozenProvenance(saved.QuestionVersion, saved.ResponseLockedAtMs) : new FrozenProvenance(null, null));
            }).ToArray();
        }
        // Pure adapter fixtures can omit the provider reader; actual request DI always supplies it.

        var attempts = (await Rows(scope.OrganizationId, "pbe-attempt").AsNoTracking().Where(r => r.SeasonId == scope.SeasonId && r.OwnerId == scope.StudentId && missing.Contains(r.Id)).ToListAsync(ct))
            .ToDictionary(r => r.Id, r => JsonSerializer.Deserialize<JsonElement>(r.DataJson));
        var sessionIds = attempts.Values.Where(a => a.TryGetProperty("sessionId", out _)).Select(a => a.GetProperty("sessionId").GetString()).Distinct().ToArray();
        var sessions = (await Rows(scope.OrganizationId, "pbe-session").AsNoTracking().Where(r => r.SeasonId == scope.SeasonId && r.OwnerId == scope.StudentId && sessionIds.Contains(r.Id)).ToListAsync(ct))
            .Select(Read<PbeSessionSnapshot>).ToDictionary(s => s.Id.ToString());
        return page.Select(reference =>
        {
            if (reference.QuestionVersion.HasValue) return (reference, new FrozenProvenance(reference.QuestionVersion, reference.ResponseLockedAtMs));
            int? version = null; long? locked = null;
            if (attempts.TryGetValue(reference.AttemptRecordId, out var a) && a.TryGetProperty("sessionId", out var sessionId) && sessions.TryGetValue(sessionId.GetString()!, out var session)
                && a.TryGetProperty("cardId", out var cardId))
            {
                var card = session.Cards.SingleOrDefault(c => c.Id == cardId.GetGuid() && c.Question.Id == reference.Evidence.QuestionId && c.Targets.Any(t => t.Id == reference.Evidence.TargetId));
                if (card is not null) version = card.Question.Version;
                if (a.TryGetProperty("responseLockedAtUtc", out var at) && at.ValueKind == JsonValueKind.String) locked = at.GetDateTimeOffset().ToUnixTimeMilliseconds();
            }
            return (reference, new FrozenProvenance(version, locked));
        }).ToArray();
    }
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
