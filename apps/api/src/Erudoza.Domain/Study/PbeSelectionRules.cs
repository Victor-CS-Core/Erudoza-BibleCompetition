namespace Erudoza.Domain.Study;

public sealed record PbeSelectionCandidate(Guid QuestionId, IReadOnlyList<Guid> TargetIds, IReadOnlyList<Guid> SourceUnitIds, string SourceKind, string Kind, int ServedCount, long? LastServedAtMs, bool Due, bool RepairEligible, int? TargetServedCount = null, Guid? LastQuestionId = null, bool AlternateForm = false, bool SpacedRepair = false, IReadOnlyList<Guid>? RepairTargetIds = null);
public sealed record PbeSelectionInput(Guid SessionId, int Count, string Mode, IReadOnlyList<PbeSelectionCandidate> Candidates, IReadOnlyList<Guid> UsedQuestionIds, IReadOnlyList<Guid> UsedTargetIds, double TrueFalseMaxRatio, IReadOnlyList<IReadOnlyList<Guid>>? AcceptedTargetGroups = null);
public static class PbeSelectionRules
{
    public static bool RepairEligible(Guid target, IReadOnlyList<IReadOnlyList<Guid>> groups) { var last = -1; for (var i = 0; i < groups.Count; i++) if (groups[i].Contains(target)) last = i; return last >= 0 && groups.Skip(last + 1).SelectMany(g => g).Where(t => t != target).Distinct().Count() >= 2; }
    public static IReadOnlyList<Guid> Select(PbeSelectionInput input)
    {
        foreach (var c in input.Candidates) if (c.RepairTargetIds is not null && (c.RepairTargetIds.Count == 0 || c.RepairTargetIds.Distinct().Count() != c.RepairTargetIds.Count || c.RepairTargetIds.Any(t => !c.TargetIds.Contains(t)))) throw new ArgumentException("Invalid repair target subset.");
        if (input.Count < 0 || input.Count > 100 || !double.IsFinite(input.TrueFalseMaxRatio) || input.TrueFalseMaxRatio < 0 || input.TrueFalseMaxRatio > 1) throw new ArgumentException("Invalid selection limits.");
        if (input.Candidates.Select(c => c.QuestionId).Distinct().Count() != input.Candidates.Count) throw new ArgumentException("Duplicate question identity.");
        var candidates = input.Candidates.Where(c => !input.UsedQuestionIds.Contains(c.QuestionId) && (input.Mode != "Review" || c.Due)).ToList();
        for (var count = Math.Min(input.Count, candidates.Count); count >= 0; count--)
        {
            var selected = new List<PbeSelectionCandidate>(); var groups = (input.AcceptedTargetGroups ?? input.UsedTargetIds.Select(t => (IReadOnlyList<Guid>)new[] { t }).ToList()).ToList();
            var commentaryMax = Math.Max(0, (int)Math.Ceiling(count * .1) - 1); var tfMax = (int)Math.Floor(count * input.TrueFalseMaxRatio);
            for (var slot = 0; slot < count; slot++)
            {
                var available = candidates.Where(c => !selected.Contains(c) && (input.Mode != "Simulation" || (c.SourceKind != "Commentary" || selected.Count(q => q.SourceKind == "Commentary") < commentaryMax) && (c.Kind != "TrueFalse" || selected.Count(q => q.Kind == "TrueFalse") < tfMax))).ToList();
                bool Spaced(PbeSelectionCandidate c) => c.SpacedRepair || (c.RepairTargetIds ?? c.TargetIds).All(t => RepairEligible(t, groups));
                if (input.Mode != "Simulation") { var qualified = available.Where(c => !c.RepairEligible || Spaced(c)).ToList(); if (qualified.Count > 0) available = qualified; }
                var category = input.Mode != "Practice" ? "coverage" : slot < 3 ? "due" : slot < 6 ? "coverage" : slot == 6 ? "repair" : slot == 7 ? "transfer" : "coverage";
                var pool = available.Where(c => category switch { "due" => c.Due, "repair" => c.RepairEligible && Spaced(c), "transfer" => c.AlternateForm, _ => true }).ToList();
                if (category == "due") { var distinct = pool.Where(c => !selected.Any(q => q.TargetIds.Any(t => c.TargetIds.Contains(t)))).ToList(); if (distinct.Count > 0) pool = distinct; }
                int TargetCount(PbeSelectionCandidate c) => (c.TargetServedCount ?? c.ServedCount) + selected.Count(q => q.TargetIds.Any(t => c.TargetIds.Contains(t)));
                var coverage = category == "coverage" || pool.Count == 0;
                var ordered = (pool.Count > 0 ? pool : available).OrderBy(c => input.Mode == "Simulation" ? TargetCount(c) : coverage ? c.ServedCount : c.QuestionId == c.LastQuestionId ? 1 : 0)
                .ThenBy(c => coverage ? 0 : c.TargetServedCount ?? c.ServedCount).ThenBy(c => c.ServedCount).ThenBy(c => c.LastServedAtMs ?? -1)
                .ThenBy(c => MissingWordsGenerator.StableSeed(c.QuestionId, input.SessionId, slot)).ThenBy(c => c.QuestionId.ToString(), StringComparer.Ordinal).ToList();
                if (ordered.Count == 0) break; selected.Add(ordered[0]); groups.Add(ordered[0].TargetIds);
            }
            if (selected.Count == count) return selected.Select(c => c.QuestionId).ToList();
        }
        return [];
    }
}
