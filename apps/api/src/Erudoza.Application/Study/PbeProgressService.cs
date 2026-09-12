using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed class PbeProgressConflictException(string message = "PBE event conflict. Refresh and retry.") : Exception(message);
public sealed record PbePreparedProgress(bool Replayed, long? AcceptedSequence = null);
public sealed record PbeReviewProjection(string Id, Guid TargetId, PbeTargetReview Review, long AcceptedSequence, long? FailedSequence, Guid LastAnsweredQuestionId, string? LastAnsweredQuestionKind, bool Provisional = false, int PendingCount = 0, long? EvidenceGeneration = null, PbeRetentionState? Retention = null);
public sealed record PbeServiceProjection(string Id, Guid SubjectId, int ServedCount, long LastServedAtMs, Guid LastQuestionId, string LastQuestionKind);
public sealed record PbeServiceEvent(Guid ServiceId, Guid QuestionId, IReadOnlyList<Guid> TargetIds, string QuestionKind, long AtMs);
public sealed record PbeRecentTarget(Guid TargetId, long AcceptedSequence);
public sealed record PbeProgressProjection(IReadOnlyList<PbeReviewProjection> Reviews, IReadOnlyList<PbeServiceProjection> Targets, IReadOnlyList<PbeServiceProjection> Questions, IReadOnlyList<PbeRecentTarget> RecentTargets);
/// <summary>Stages records only. Caller owns the serializable transaction, fresh eligibility guards, accepted attempt, SaveChanges and commit. Revision/unique-key exceptions must abort that entire transaction and map to a retry conflict.</summary>
public sealed class PbeProgressService(IErudozaDbContext db)
{
    /// <summary>Wrap the entire caller acceptance operation, including eligibility checks, saved attempt and all prepared projections. Do not nest in another transaction. Dispose the request unit of work after a conflict.</summary>
    public async Task<T> ExecuteAsync<T>(Func<CancellationToken, Task<T>> prepare, CancellationToken ct = default)
    {
        await using var transaction = await db.BeginSerializableTransactionAsync(ct);
        try { var result = await prepare(ct); await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return result; }
        catch (DbUpdateException e) when (e is DbUpdateConcurrencyException || e.InnerException?.Message.Contains("UNIQUE constraint failed", StringComparison.OrdinalIgnoreCase) == true || e.InnerException?.Message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase) == true) { await transaction.RollbackAsync(ct); throw new PbeProgressConflictException(); }
    }
    private sealed record Sequence(string Id, long AcceptedSequence, long LastAtMs, IReadOnlyList<PbeRecentTarget> RecentTargets);
    public sealed record RecallEvent(string Id, string ScopeVersion, long AcceptedSequence, string? QuestionKind, IReadOnlyList<PbeRecallEvidence> Evidence, int? QuestionVersion = null, long? ResponseLockedAtMs = null);
    private sealed record ServiceRecord(string Id, PbeServiceEvent Event);
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    static string Key(Guid student, Guid season, Guid? id = null) => $"{student}:{season}" + (id.HasValue ? $":{id}" : "");
    static void Scope(Guid org, Guid season, Guid student) { if (org == Guid.Empty || season == Guid.Empty || student == Guid.Empty) throw new ArgumentException("Invalid PBE owner/season."); }
    static bool Time(long at) => at >= 0 && at <= 253401091199999;
    static T Read<T>(PbeTrainingRecord row) => JsonSerializer.Deserialize<T>(row.DataJson, Json)!;
    Task<PbeTrainingRecord?> Get(Guid org, Guid season, Guid student, string kind, string id, CancellationToken ct) => db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == student && r.Kind == kind && r.Id == id, ct);
    IQueryable<PbeTrainingRecord> ProjectionRows(Guid org, Guid season, Guid student, string kind, string[] ids) => db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == student && r.Kind == kind && ids.Contains(r.Id));
    Task<List<PbeTrainingRecord>> Rows(Guid org, Guid season, Guid student, string kind, string[] ids, CancellationToken ct) => ProjectionRows(org, season, student, kind, ids).ToListAsync(ct);
    void Write(Guid org, Guid season, Guid student, string kind, string id, object value, PbeTrainingRecord? old)
    {
        if (old is null) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, OwnerId = student, Kind = kind, Id = id, DataJson = JsonSerializer.Serialize(value, Json) });
        else { old.DataJson = JsonSerializer.Serialize(value, Json); old.Revision++; }
    }
    public async Task<PbePreparedProgress> PrepareRecallEvidenceAsync(Guid org, Guid season, Guid student, string scopeVersion, IReadOnlyList<PbeRecallEvidence> evidence, CancellationToken ct = default, string? questionKind = null, int? questionVersion = null, long? responseLockedAtMs = null)
    {
        Scope(org, season, student);
        if (questionVersion is <= 0 || responseLockedAtMs.HasValue && !Time(responseLockedAtMs.Value)) throw new ArgumentException("Invalid frozen evidence provenance.");
        if (questionKind is not null && !new[] { "ShortAnswer", "List", "ExactWords", "TrueFalse" }.Contains(questionKind))
            throw new ArgumentException("Invalid accepted question kind.");
        if (string.IsNullOrEmpty(scopeVersion) || scopeVersion.Length > 1000 || evidence.Count is < 1 or > 8)
            throw new ArgumentException("Invalid PBE evidence.");

        var first = evidence[0];
        if (evidence.Any(e =>
                e.AttemptId == Guid.Empty || e.TargetId == Guid.Empty || e.QuestionId == Guid.Empty ||
                !Time(e.AtMs) || e.AvailablePoints is < 1 or > 8 || e.EarnedPoints < 0 || e.EarnedPoints > e.AvailablePoints ||
                e.AttemptId != first.AttemptId || e.QuestionId != first.QuestionId || e.AtMs != first.AtMs || e.Unaided != first.Unaided) ||
            evidence.Select(e => e.TargetId).Distinct().Count() != evidence.Count || evidence.Sum(e => e.AvailablePoints) > 8)
            throw new ArgumentException("Invalid grouped PBE evidence.");

        evidence = evidence.OrderBy(e => e.TargetId.ToString(), StringComparer.Ordinal).ToList();
        var id = Key(student, season, first.AttemptId);
        var existing = await Get(org, season, student, "pbe-recall-event", id, ct);
        if (existing is not null)
        {
            var saved = Read<RecallEvent>(existing);
            if (saved.QuestionKind != questionKind || !saved.Evidence.SequenceEqual(evidence))
                throw new PbeProgressConflictException();
            return new(true, saved.AcceptedSequence);
        }

        var sid = Key(student, season);
        var oldSequence = await Get(org, season, student, "pbe-recall-sequence", sid, ct);
        var previous = oldSequence is null ? null : Read<Sequence>(oldSequence);
        if (previous is not null && first.AtMs < previous.LastAtMs)
            throw new PbeProgressConflictException("PBE chronological acceptance conflict.");
        var sequence = (previous?.AcceptedSequence ?? 0) + 1;
        if (sequence > 9007199254740991) throw new PbeProgressConflictException();

        var old = await Rows(org, season, student, "pbe-target-review", evidence.Select(e => Key(student, season, e.TargetId)).ToArray(), ct);
        var recent = (previous?.RecentTargets ?? [])
            .Where(t => !evidence.Any(e => e.TargetId == t.TargetId))
            .Concat(evidence.Select(e => new PbeRecentTarget(e.TargetId, sequence)))
            .OrderByDescending(t => t.AcceptedSequence)
            .ThenBy(t => t.TargetId.ToString(), StringComparer.Ordinal)
            .Take(3)
            .ToList();
        Write(org, season, student, "pbe-recall-sequence", sid, new Sequence(sid, sequence, first.AtMs, recent), oldSequence);
        Write(org, season, student, "pbe-recall-event", id, new RecallEvent(id, scopeVersion, sequence, questionKind, evidence, questionVersion, responseLockedAtMs), null);
        foreach (var reference in PbeEvidenceReplayService.References(student, season, new RecallEvent(id, scopeVersion, sequence, questionKind, evidence, questionVersion, responseLockedAtMs))) Write(org, season, student, "pbe-evidence-ref", reference.Id, reference, null);
        if (previous is null) Write(org, season, student, "pbe-evidence-index", sid, new PbeEvidenceIndex(sid, true, "", 0), null);
        foreach (var e in evidence)
        {
            var pid = Key(student, season, e.TargetId);
            var prior = old.SingleOrDefault(r => r.Id == pid);
            var p = prior is null ? null : Read<PbeReviewProjection>(prior);
            var review = PbeReviewRules.Advance(p?.Review ?? PbeReviewRules.Initial(e.TargetId), e);
            long? failed = e.Recall && e.EarnedPoints < e.AvailablePoints
                ? sequence
                : review.Unresolved ? p?.FailedSequence : null;
            // Existing uninitialized or dirty proof cannot become certified through a lone append.
            var retention = p?.Retention ?? PbeChapterRules.InitialRetention() with { DataGap = p is not null };
            retention = PbeChapterRules.AdvanceRetention(retention, new(e.TargetId, e.QuestionId, questionVersion ?? 0, e.AttemptId,
                responseLockedAtMs ?? e.AtMs, sequence, e.EarnedPoints == e.AvailablePoints, e.Unaided, true, e.Recall, "Solo"), questionVersion is null);
            Write(org, season, student, "pbe-target-review", pid, new PbeReviewProjection(pid, e.TargetId, review, sequence, failed, e.QuestionId, questionKind, p?.Provisional ?? false, p?.PendingCount ?? 0, p?.EvidenceGeneration, retention), prior);
        }
        return new(false, sequence);
    }
    public async Task<PbePreparedProgress> PrepareServiceAsync(Guid org, Guid season, Guid student, PbeServiceEvent e, CancellationToken ct = default)
    {
        Scope(org, season, student); if (e.ServiceId == Guid.Empty || e.QuestionId == Guid.Empty || !Time(e.AtMs) || e.TargetIds.Count is < 1 or > 8 || e.TargetIds.Any(t => t == Guid.Empty) || e.TargetIds.Distinct().Count() != e.TargetIds.Count || !new[] { "ShortAnswer", "List", "ExactWords", "TrueFalse" }.Contains(e.QuestionKind)) throw new ArgumentException("Invalid PBE service.");
        e = e with { TargetIds = e.TargetIds.OrderBy(t => t.ToString(), StringComparer.Ordinal).ToList() }; var id = Key(student, season, e.ServiceId); var existing = await Get(org, season, student, "pbe-service-event", id, ct);
        if (existing is not null) { if (JsonSerializer.Serialize(Read<ServiceRecord>(existing).Event, Json) != JsonSerializer.Serialize(e, Json)) throw new PbeProgressConflictException(); return new(true); }
        // Read/validate before tracking any writes, so ordinary validation errors leave the unit of work clean.
        var questionRows = await Rows(org, season, student, "pbe-question-service", [Key(student, season, e.QuestionId)], ct); var targetRows = await Rows(org, season, student, "pbe-target-service", e.TargetIds.Select(t => Key(student, season, t)).ToArray(), ct);
        if (questionRows.Concat(targetRows).Any(r => e.AtMs < Read<PbeServiceProjection>(r).LastServedAtMs)) throw new PbeProgressConflictException("PBE service chronological conflict.");
        Write(org, season, student, "pbe-service-event", id, new ServiceRecord(id, e), null);
        foreach (var (kind, subjects, prior) in new[] { ("pbe-question-service", (IReadOnlyList<Guid>)new[] { e.QuestionId }, questionRows), ("pbe-target-service", e.TargetIds, targetRows) }) foreach (var subject in subjects) { var pid = Key(student, season, subject); var row = prior.SingleOrDefault(r => r.Id == pid); var p = row is null ? null : Read<PbeServiceProjection>(row); Write(org, season, student, kind, pid, new PbeServiceProjection(pid, subject, (p?.ServedCount ?? 0) + 1, e.AtMs, e.QuestionId, e.QuestionKind), row); }
        return new(false);
    }
    /// <summary>Only pass freshly authorized target/question IDs. No session or evidence history scan.</summary>
    public async Task<PbeProgressProjection> LoadAsync(Guid org, Guid season, Guid student, IReadOnlyList<Guid> targetIds, IReadOnlyList<Guid> questionIds, CancellationToken ct = default)
    {
        Scope(org, season, student); if (targetIds.Count > 10000 || questionIds.Count > 10000 || targetIds.Concat(questionIds).Any(t => t == Guid.Empty)) throw new ArgumentException("Invalid projection scope.");
        var reviews = await Rows(org, season, student, "pbe-target-review", targetIds.Select(t => Key(student, season, t)).ToArray(), ct); var targets = await Rows(org, season, student, "pbe-target-service", targetIds.Select(t => Key(student, season, t)).ToArray(), ct); var questions = await Rows(org, season, student, "pbe-question-service", questionIds.Select(t => Key(student, season, t)).ToArray(), ct); var seq = await Get(org, season, student, "pbe-recall-sequence", Key(student, season), ct);
        return new(reviews.Select(Read<PbeReviewProjection>).ToList(), targets.Select(Read<PbeServiceProjection>).ToList(), questions.Select(Read<PbeServiceProjection>).ToList(), seq is null ? [] : Read<Sequence>(seq).RecentTargets);
    }
}
