namespace Erudoza.Domain.Study;

public sealed record PbeSelectionCandidate(Guid QuestionId, IReadOnlyList<Guid> TargetIds, IReadOnlyList<Guid> SourceUnitIds, string SourceKind, string Kind, int ServedCount, long? LastServedAtMs, bool Due, bool RepairEligible, int? TargetServedCount = null, Guid? LastQuestionId = null, bool AlternateForm = false, bool SpacedRepair = false, IReadOnlyList<Guid>? RepairTargetIds = null);
public sealed record PbeSelectionInput(Guid SessionId, int Count, string Mode, IReadOnlyList<PbeSelectionCandidate> Candidates, IReadOnlyList<Guid> UsedQuestionIds, IReadOnlyList<Guid> UsedTargetIds, double TrueFalseMaxRatio, IReadOnlyList<IReadOnlyList<Guid>>? AcceptedTargetGroups = null);
public static class PbeSelectionRules
{
    public static bool RepairEligible(Guid target, IReadOnlyList<IReadOnlyList<Guid>> groups)
    {
        var last = -1;
        for (var i = 0; i < groups.Count; i++)
        {
            if (groups[i].Contains(target)) last = i;
        }
        return last >= 0 && groups.Skip(last + 1).SelectMany(g => g).Where(t => t != target).Distinct().Count() >= 2;
    }

    private static int QuotaCategory(PbeSelectionCandidate c) =>
        (c.SourceKind == "Commentary" ? 1 : 0) + (c.Kind == "TrueFalse" ? 2 : 0);

    private static int[] CategoryCounts(IReadOnlyList<PbeSelectionCandidate> candidates)
    {
        var counts = new int[4];
        foreach (var c in candidates) counts[QuotaCategory(c)]++;
        return counts;
    }

    // Singles consume one allowance; dual-category questions consume both. This is the exact attainable maximum.
    private static int QuotaCapacity(int[] counts, int commentary, int trueFalse, int removedCategory = -1)
    {
        if (commentary < 0 || trueFalse < 0) return -1;
        var ordinary = counts[0] - (removedCategory == 0 ? 1 : 0);
        var commentaryOnly = Math.Min(counts[1] - (removedCategory == 1 ? 1 : 0), commentary);
        var trueFalseOnly = Math.Min(counts[2] - (removedCategory == 2 ? 1 : 0), trueFalse);
        var both = Math.Min(counts[3] - (removedCategory == 3 ? 1 : 0), Math.Min(commentary - commentaryOnly, trueFalse - trueFalseOnly));
        return ordinary + commentaryOnly + trueFalseOnly + both;
    }

    private static List<PbeSelectionCandidate> SimulationChoices(List<PbeSelectionCandidate> remaining, List<PbeSelectionCandidate> selected, int count, int commentaryMax, int trueFalseMax)
    {
        var counts = CategoryCounts(remaining);
        var commentary = commentaryMax - selected.Count(c => c.SourceKind == "Commentary");
        var trueFalse = trueFalseMax - selected.Count(c => c.Kind == "TrueFalse");
        var neededAfterChoice = count - selected.Count - 1;
        // Count once per slot; each candidate then needs only four counters, not another bank scan.
        return remaining.Where(c => QuotaCapacity(counts,
            commentary - (c.SourceKind == "Commentary" ? 1 : 0),
            trueFalse - (c.Kind == "TrueFalse" ? 1 : 0),
            QuotaCategory(c)) >= neededAfterChoice).ToList();
    }

    private static bool SpacingStillPossible(Guid target, IReadOnlyList<IReadOnlyList<Guid>> groups, IReadOnlyList<PbeSelectionCandidate> remaining)
    {
        var last = -1;
        for (var i = 0; i < groups.Count; i++)
        {
            if (groups[i].Contains(target)) last = i;
        }
        var intervening = last < 0 ? new HashSet<Guid>() : groups.Skip(last + 1).SelectMany(g => g).ToHashSet();
        if (intervening.Count >= 2) return true;
        foreach (var c in remaining)
        {
            // A card containing the target resets its encounter anchor; its siblings cannot supply spacing.
            if (c.TargetIds.Contains(target)) continue;
            intervening.UnionWith(c.TargetIds);
            if (intervening.Count >= 2) return true;
        }
        return false;
    }

    public static IReadOnlyList<Guid> Select(PbeSelectionInput input)
    {
        foreach (var c in input.Candidates)
        {
            if (c.RepairTargetIds is not null && (c.RepairTargetIds.Count == 0 || c.RepairTargetIds.Distinct().Count() != c.RepairTargetIds.Count || c.RepairTargetIds.Any(t => !c.TargetIds.Contains(t))))
                throw new ArgumentException("Invalid repair target subset.");
        }
        if (input.Count < 0 || input.Count > 100 || !double.IsFinite(input.TrueFalseMaxRatio) || input.TrueFalseMaxRatio < 0 || input.TrueFalseMaxRatio > 1)
            throw new ArgumentException("Invalid selection limits.");
        if (input.Candidates.Select(c => c.QuestionId).Distinct().Count() != input.Candidates.Count)
            throw new ArgumentException("Duplicate question identity.");

        var candidates = input.Candidates.Where(c => !input.UsedQuestionIds.Contains(c.QuestionId) && (input.Mode != "Review" || c.Due)).ToList();
        var bankCategories = CategoryCounts(candidates);
        for (var count = Math.Min(input.Count, candidates.Count); count >= 0; count--)
        {
            var selected = new List<PbeSelectionCandidate>();
            var groups = (input.AcceptedTargetGroups ?? input.UsedTargetIds.Select(t => (IReadOnlyList<Guid>)new[] { t }).ToList()).ToList();
            var commentaryMax = Math.Max(0, (int)Math.Ceiling(count * .1) - 1);
            var tfMax = (int)Math.Floor(count * input.TrueFalseMaxRatio);
            if (input.Mode == "Simulation" && QuotaCapacity(bankCategories, commentaryMax, tfMax) < count) continue;

            for (var slot = 0; slot < count; slot++)
            {
                var available = candidates.Where(c => !selected.Contains(c)).ToList();
                if (input.Mode == "Simulation") available = SimulationChoices(available, selected, count, commentaryMax, tfMax);
                bool Spaced(PbeSelectionCandidate c) => c.SpacedRepair || (c.RepairTargetIds ?? c.TargetIds).All(t => RepairEligible(t, groups));
                if (input.Mode != "Simulation")
                {
                    var possible = new Dictionary<Guid, bool>();
                    bool CanSpace(Guid target)
                    {
                        if (!possible.TryGetValue(target, out var result))
                        {
                            result = SpacingStillPossible(target, groups, available);
                            possible[target] = result;
                        }
                        return result;
                    }
                    var qualified = available.Where(c => !c.RepairEligible || Spaced(c) ||
                        (c.RepairTargetIds ?? c.TargetIds).All(t => RepairEligible(t, groups) || !CanSpace(t))).ToList();
                    // Infeasible spacing permits a next-session retry, without labeling it a spaced repair.
                    if (qualified.Count > 0) available = qualified;
                }

                var category = input.Mode != "Practice" ? "coverage" : slot < 3 ? "due" : slot < 6 ? "coverage" : slot == 6 ? "repair" : slot == 7 ? "transfer" : "coverage";
                var pool = available.Where(c => category switch
                {
                    "due" => c.Due,
                    "repair" => c.RepairEligible && Spaced(c),
                    "transfer" => c.AlternateForm,
                    _ => true
                }).ToList();
                if (category == "due")
                {
                    var distinct = pool.Where(c => !selected.Any(q => q.TargetIds.Any(t => c.TargetIds.Contains(t)))).ToList();
                    if (distinct.Count > 0) pool = distinct;
                }
                int TargetCount(PbeSelectionCandidate c) => (c.TargetServedCount ?? c.ServedCount) + selected.Count(q => q.TargetIds.Any(t => c.TargetIds.Contains(t)));
                var coverage = category == "coverage" || pool.Count == 0;
                var ordered = (pool.Count > 0 ? pool : available)
                    .OrderBy(c => input.Mode == "Simulation" ? TargetCount(c) : coverage ? c.ServedCount : c.QuestionId == c.LastQuestionId ? 1 : 0)
                    .ThenBy(c => coverage ? 0 : c.TargetServedCount ?? c.ServedCount)
                    .ThenBy(c => c.ServedCount)
                    .ThenBy(c => c.LastServedAtMs ?? -1)
                    .ThenBy(c => MissingWordsGenerator.StableSeed(c.QuestionId, input.SessionId, slot))
                    .ThenBy(c => c.QuestionId.ToString(), StringComparer.Ordinal)
                    .ToList();
                if (ordered.Count == 0) break;
                selected.Add(ordered[0]);
                groups.Add(ordered[0].TargetIds);
            }
            if (selected.Count == count) return selected.Select(c => c.QuestionId).ToList();
        }
        return [];
    }
}
