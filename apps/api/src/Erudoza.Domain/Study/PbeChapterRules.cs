using Erudoza.Domain.Practice;

namespace Erudoza.Domain.Study;

/// <summary>
/// AtMs is the trusted original response lock time, or original acceptance time for untimed legacy evidence.
/// Recall is skill applicability from the frozen original rubric, never from current question heads.
/// </summary>
public sealed record PbeTargetProof(
    Guid TargetId, Guid QuestionId, int QuestionVersion, Guid AttemptId, long AtMs,
    long AcceptedSequence, bool FullCredit, bool Unaided, bool Final, bool Recall, string Activity);

/// <summary>Assigned sources belong to this group; eligible assignment sources include every personally assigned group.</summary>
public sealed record PbeChapterScope(string ChapterKey, string ScopeVersion,
    IReadOnlyList<Guid> AssignedSourceUnitIds, IReadOnlyList<Guid> EligibleAssignmentSourceUnitIds);
public sealed record PbeChapterContext(double AsOfMs);
public sealed record PbeChapterProgress(string ChapterKey, string ScopeVersion,
    int AssignedPassages, int QuestionCoveredPassages, int TotalTargets, int PracticedTargets,
    int RecalledTargets, int RetainedTargets, int DueTargets, int MissingVariantTargets, DateTimeOffset? StampEarnedAtUtc);

public static class PbeChapterRules
{
    private const long RetentionDelayMs = 48 * 60 * 60 * 1000L;

    public const string RetentionRuleVersion = "pbe-retention-v1";
    public static PbeRetentionState InitialRetention() => new(RetentionRuleVersion, false, false, 0, 0, null, [], [], null, false);

    private static IOrderedEnumerable<PbeRetentionCandidate> Ordered(IEnumerable<PbeRetentionCandidate> values, bool latest = false)
        => (latest ? values.OrderByDescending(v => v.AtMs) : values.OrderBy(v => v.AtMs))
            .ThenBy(v => v.AcceptedSequence).ThenBy(v => v.QuestionId.ToString(), StringComparer.Ordinal)
            .ThenBy(v => v.AttemptId.ToString(), StringComparer.Ordinal);

    /// <summary>One accepted-order event. Pending and missing provenance survive resets until a fresh replay.</summary>
    public static PbeRetentionState AdvanceRetention(PbeRetentionState previous, PbeTargetProof proof, bool dataGap = false)
    {
        if (proof.Activity != "Solo") return previous;
        if (proof.AcceptedSequence <= previous.LastAcceptedSequence) throw new ArgumentException("Retention evidence must advance accepted sequence.");
        var state = previous with { Practiced = true, LastAcceptedSequence = proof.AcceptedSequence, DataGap = previous.DataGap || dataGap };
        if (!proof.Recall) return state;
        if (!proof.Final) return state with { PendingCount = state.PendingCount + 1 };
        if (!proof.FullCredit) return state with { Recalled = false, LastFailureSequence = proof.AcceptedSequence, Earliest = [], Latest = [], Witness = null };
        if (!proof.Unaided) return state;
        var candidate = new PbeRetentionCandidate(proof.TargetId, proof.QuestionId, proof.QuestionVersion, proof.AttemptId, proof.AtMs, proof.AcceptedSequence);
        var candidates = Ordered(state.Earliest.Concat(state.Latest).Distinct()).ToArray();
        var partner = candidates.FirstOrDefault(c => c.QuestionId != candidate.QuestionId && Math.Abs((decimal)c.AtMs - candidate.AtMs) >= RetentionDelayMs);
        var all = candidates.Append(candidate).ToArray();
        return state with
        {
            Recalled = true,
            Witness = state.Witness ?? (partner is null ? null : new[] { partner, candidate }),
            Earliest = Ordered(all).DistinctBy(c => c.QuestionId).Take(2).ToArray(),
            Latest = Ordered(all, true).DistinctBy(c => c.QuestionId).Take(2).ToArray()
        };
    }
    public static bool IsRetained(PbeRetentionState state) => state.RuleVersion == RetentionRuleVersion && state.Witness is { Count: 2 } && state.PendingCount == 0 && !state.DataGap;
    public static IReadOnlyDictionary<Guid, PbeRetentionState> ReplayTargets(IReadOnlyList<PbeTargetProof> proofs, IReadOnlyList<Guid> eligibleTargetIds)
    {
        var states = eligibleTargetIds.Distinct().ToDictionary(id => id, _ => InitialRetention());
        foreach (var proof in proofs.Where(p => p.Activity == "Solo" && states.ContainsKey(p.TargetId)).OrderBy(p => p.AcceptedSequence))
            states[proof.TargetId] = AdvanceRetention(states[proof.TargetId], proof);
        return states;
    }
    public static IReadOnlyList<Guid> RetainedTargets(IReadOnlyList<PbeTargetProof> proofs, IReadOnlyList<Guid> eligibleTargetIds)
        => ReplayTargets(proofs, eligibleTargetIds).Where(p => IsRetained(p.Value))
            .Select(p => p.Key).OrderBy(id => id.ToString(), StringComparer.Ordinal).ToArray();

    /// <summary>
    /// Current counters for the validated published bank and accepted evidence supplied by the caller.
    /// A whole-chapter retained claim additionally needs nonzero targets, complete assigned-passage coverage,
    /// every declared target retained, and no relevant pending correction. Counts never create an earned stamp.
    /// </summary>
    public static PbeChapterProgress ProjectChapter(PbeChapterScope scope, IReadOnlyList<PbeTarget> targets,
        IReadOnlyList<PbeTargetReview> reviews, IReadOnlyList<PbeTargetProof> proofs,
        IReadOnlyList<PbeQuestion> questions, PbeChapterContext context)
    {
        if (!double.IsFinite(context.AsOfMs)) throw new ArgumentException("Provide a finite chapter projection time.", nameof(context));
        var assigned = scope.AssignedSourceUnitIds.ToHashSet();
        var eligibleAssignment = scope.EligibleAssignmentSourceUnitIds.ToHashSet();
        if (!assigned.IsSubsetOf(eligibleAssignment)) throw new ArgumentException("Chapter sources must be within the eligible assignment.", nameof(scope));
        bool InGroup(IReadOnlyList<Guid> sources) => sources.All(eligibleAssignment.Contains) && sources.Any(assigned.Contains);
        var groupedTargets = new Dictionary<Guid, PbeTarget>();
        foreach (var target in targets.Where(t => InGroup(t.SourceUnitIds))) groupedTargets[target.Id] = target;
        var covered = new HashSet<Guid>();
        var variants = groupedTargets.Keys.ToDictionary(id => id, _ => new HashSet<Guid>());
        foreach (var question in questions.Where(q => InGroup(q.SourceUnitIds)))
        {
            covered.UnionWith(question.SourceUnitIds.Where(assigned.Contains));
            if (question.Kind == PbeQuestionKind.TrueFalse) continue;
            foreach (var part in question.Parts)
            {
                // ExactWords grading always enforces order, regardless of the general Ordered flag.
                if (groupedTargets.TryGetValue(part.TargetId, out var target) &&
                    (target.Skill != RecallSkill.ExactWords || question.Kind == PbeQuestionKind.ExactWords))
                    variants[target.Id].Add(question.Id);
            }
        }
        var states = ReplayTargets(proofs, groupedTargets.Keys.ToArray());
        var due = reviews.Where(r => groupedTargets.ContainsKey(r.TargetId) &&
            (r.Unresolved || r.IntervalIndex >= 0 && r.DueAtMs <= context.AsOfMs)).Select(r => r.TargetId).Distinct().Count();
        return new(scope.ChapterKey, scope.ScopeVersion, assigned.Count, covered.Count, groupedTargets.Count,
            states.Values.Count(s => s.Practiced), states.Values.Count(s => s.Recalled && s.PendingCount == 0 && !s.DataGap),
            states.Count(p => IsRetained(p.Value) && variants[p.Key].Count >= 2),
            due, variants.Values.Count(ids => ids.Count < 2),
            // Only the transactional adapter may overlay a persisted immutable first-earned stamp.
            null);
    }
}

public sealed record PbeRetentionCandidate(Guid TargetId, Guid QuestionId, int QuestionVersion, Guid AttemptId, long AtMs, long AcceptedSequence);
public sealed record PbeRetentionState(string RuleVersion, bool Practiced, bool Recalled, int PendingCount,
    long LastAcceptedSequence, long? LastFailureSequence, IReadOnlyList<PbeRetentionCandidate> Earliest,
    IReadOnlyList<PbeRetentionCandidate> Latest, IReadOnlyList<PbeRetentionCandidate>? Witness, bool DataGap);
