namespace Erudoza.Domain.Study;

public sealed record AcceptedTrainingEvidence(Guid CardId, Guid KnowledgeUnitId, bool IsLegacyDuplicate, bool IsCorrect);
public static class TrainingRules
{
    public static int ExactRecallCount(IEnumerable<Guid> eligible, IEnumerable<MasteryState> states) => SkillCount(eligible, states, x => x.ExactWordingScore >= 80, 5);
    public static int ReferenceReadyCount(IEnumerable<Guid> eligible, IEnumerable<MasteryState> states) => SkillCount(eligible, states, x => x.ReferenceScore >= 70, 10);
    public static bool ChapterStrong(IEnumerable<Guid> eligible, IEnumerable<MasteryState> states)
    {
        var ids = eligible.ToHashSet(); return ids.Count > 0 && ids.IsSubsetOf(states.Where(x => x.AlgorithmVersion == "v2-skill-evidence" && x.Level is MasteryLevel.Strong or MasteryLevel.Mastered).Select(x => x.KnowledgeUnitId));
    }
    public static bool FullCoverage(IEnumerable<Guid> eligible, IEnumerable<Guid> seen) { var ids = eligible.ToHashSet(); return ids.Count > 0 && ids.IsSubsetOf(seen); }
    public static bool SteadyStudy(IEnumerable<string> qualifiedWeeks) => qualifiedWeeks.Distinct().Take(4).Count() == 4;
    private static int SkillCount(IEnumerable<Guid> eligible, IEnumerable<MasteryState> states, Func<MasteryState, bool> criterion, int cap)
    { var ids = eligible.ToHashSet(); return Math.Min(cap, states.Where(x => x.AlgorithmVersion == "v2-skill-evidence" && ids.Contains(x.KnowledgeUnitId) && criterion(x)).Select(x => x.KnowledgeUnitId).Distinct().Count()); }
    public const string Version = "training-v1";
    public static bool FullTargetReached(int target, IEnumerable<AcceptedTrainingEvidence> attempts) => target > 0 && attempts.Where(x => !x.IsLegacyDuplicate).Select(x => x.CardId).Distinct().Count() >= target;
    public static bool ReviewSetComplete(IEnumerable<Guid> required, IEnumerable<AcceptedTrainingEvidence> attempts)
    {
        var ids = required.ToHashSet();
        return ids.Count > 0 && ids.IsSubsetOf(attempts.Where(x => !x.IsLegacyDuplicate).Select(x => x.KnowledgeUnitId));
    }
}
