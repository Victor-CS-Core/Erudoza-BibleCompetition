using Erudoza.Domain.Study;
namespace Erudoza.UnitTests;

public sealed class PbeSelectionTests
{
    static Guid Id(int i) => Guid.Parse($"00000000-0000-0000-0000-{i:000000000000}");
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(8)]
    [InlineData(16)]
    [InlineData(21)]
    [InlineData(24)]
    [InlineData(100)]
    public void Finite_uneven_all_due_banks_eventually_cover_every_question(int size)
    {
        var candidates = Enumerable.Range(0, size).SelectMany(i => Enumerable.Range(0, i % 3 + 1).Select(j => new PbeSelectionCandidate(Id(i * 3 + j + 1), [Id(i + 1000), Id(i + 4000)], [Id(i + 2000)], "Scripture", "ShortAnswer", 0, null, true, false))).ToList(); var seen = new HashSet<Guid>();
        for (var n = 0; n < (int)Math.Ceiling(candidates.Count / 3d) + 1; n++)
        {
            var input = new PbeSelectionInput(Id(n + 7000), 8, "Practice", candidates, [], [], .1); var picked = PbeSelectionRules.Select(input); Assert.Equal(picked, PbeSelectionRules.Select(input)); Assert.Equal(Math.Min(8, candidates.Count), picked.Count); Assert.Equal(picked.Count, picked.Distinct().Count());
            for (var i = 0; i < candidates.Count; i++) if (picked.Contains(candidates[i].QuestionId)) { seen.Add(candidates[i].QuestionId); candidates[i] = candidates[i] with { ServedCount = candidates[i].ServedCount + 1, LastServedAtMs = n }; }
        }
        Assert.Equal(candidates.Count, seen.Count);
    }
    [Fact]
    public void Short_simulation_obeys_actual_mix_but_focused_commentary_is_allowed()
    {
        var candidates = Enumerable.Range(1, 10).Select(i => new PbeSelectionCandidate(Id(i), [Id(i + 1000)], [Id(i + 2000)], i < 3 ? "Scripture" : "Commentary", "ShortAnswer", 0, null, false, false)).ToList();
        var input = new PbeSelectionInput(Id(7000), 90, "Simulation", candidates, [], [], .1);
        Assert.Equal(2, PbeSelectionRules.Select(input).Count); Assert.Equal(10, PbeSelectionRules.Select(input with { Mode = "Practice" }).Count); Assert.Empty(PbeSelectionRules.Select(input with { Mode = "Review" }));
    }
    [Fact]
    public void Simulation_balances_targets_and_due_slots_use_distinct_targets()
    {
        var candidates = Enumerable.Range(0, 12).Select(i => new PbeSelectionCandidate(Id(i + 1), [Id(i < 9 ? 1001 : i + 1000)], [Id(i + 2000)], "Scripture", "ShortAnswer", 0, null, true, false, 0)).ToList();
        var input = new PbeSelectionInput(Id(7000), 4, "Simulation", candidates, [], [], .1);
        Assert.Equal(4, PbeSelectionRules.Select(input).Select(q => candidates.Single(c => c.QuestionId == q).TargetIds[0]).Distinct().Count());
        Assert.Equal(3, PbeSelectionRules.Select(input with { Count = 8, Mode = "Practice" }).Take(3).Select(q => candidates.Single(c => c.QuestionId == q).TargetIds[0]).Distinct().Count());
    }
    [Fact]
    public void Signed_seed_literal_and_oldest_coverage_match_native()
    {
        var candidates = Enumerable.Range(1, 12).Select(i => new PbeSelectionCandidate(Id(i), [Id(i + 1000)], [Id(i + 2000)], "Scripture", "ShortAnswer", 0, null, false, false)).ToList();
        using var fixture = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "pbe/replay-fixtures.json")));
        var input = new PbeSelectionInput(fixture.RootElement.GetProperty("selectionSessionId").GetGuid(), 8, "Practice", candidates, [], [], .1);
        Assert.Equal(fixture.RootElement.GetProperty("selectionQuestionNumbers").EnumerateArray().Select(n => Id(n.GetInt32())), PbeSelectionRules.Select(input));
    }
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(8)]
    [InlineData(16)]
    [InlineData(21)]
    [InlineData(24)]
    [InlineData(90)]
    [InlineData(100)]
    public void Simulation_enforces_both_mix_limits_on_actual_count(int count)
    {
        var candidates = Enumerable.Range(0, 120).Select(i => new PbeSelectionCandidate(Id(i + 1), [Id(i + 1000)], [Id(i + 2000)], i % 5 == 0 ? "Commentary" : "Scripture", i % 4 == 0 ? "TrueFalse" : "ShortAnswer", 0, null, false, false)).ToList(); var ids = PbeSelectionRules.Select(new(Id(7000), count, "Simulation", candidates, [], [], .1)); var selected = candidates.Where(c => ids.Contains(c.QuestionId)).ToList(); Assert.True(selected.Count <= count); Assert.True(selected.Count(c => c.SourceKind == "Commentary") <= Math.Max(0, (int)Math.Ceiling(selected.Count * .1) - 1)); Assert.True(selected.Count(c => c.Kind == "TrueFalse") <= (int)Math.Floor(selected.Count * .1));
    }
    [Fact]
    public void Repair_spacing_excludes_simultaneous_parts_and_repeated_siblings()
    {
        Assert.False(PbeSelectionRules.RepairEligible(Id(1), [new[] { Id(1), Id(2), Id(3) }]));
        Assert.False(PbeSelectionRules.RepairEligible(Id(1), [new[] { Id(1), Id(2), Id(3) }, new[] { Id(2) }, new[] { Id(2) }]));
        Assert.True(PbeSelectionRules.RepairEligible(Id(1), [new[] { Id(1), Id(2), Id(3) }, new[] { Id(2), Id(3) }]));
    }
    [Fact]
    public void Pending_repair_cannot_bypass_spacing_through_coverage_fallback()
    {
        var failed = new PbeSelectionCandidate(Id(1), [Id(1001)], [Id(2001)], "Scripture", "ShortAnswer", 0, null, false, true);
        var a = new PbeSelectionCandidate(Id(2), [Id(1002)], [Id(2002)], "Scripture", "ShortAnswer", 10, null, false, false); var b = a with { QuestionId = Id(3), TargetIds = [Id(1003)] };
        var picked = PbeSelectionRules.Select(new(Id(7000), 3, "Practice", [failed, a, b], [], failed.TargetIds, .1)); Assert.Equal(failed.QuestionId, picked[2]);
    }
    [Fact]
    public void Circular_multipart_failures_can_seed_next_session_and_never_block_simulation()
    {
        var targets = new[] { Id(1001), Id(1002), Id(1003) }; var candidates = Enumerable.Range(1, 3).Select(i => new PbeSelectionCandidate(Id(i), targets, [Id(2001)], "Scripture", "ShortAnswer", 0, null, false, true)).ToList(); var input = new PbeSelectionInput(Id(7000), 3, "Practice", candidates, [], [], .1, [targets]); Assert.Equal(3, PbeSelectionRules.Select(input).Count); Assert.Equal(3, PbeSelectionRules.Select(input with { Mode = "Simulation" }).Count);
    }
    [Fact]
    public void Contradictory_repair_target_subsets_are_rejected()
    {
        var c = new PbeSelectionCandidate(Id(1), [Id(1001)], [Id(2001)], "Scripture", "ShortAnswer", 0, null, false, true); var input = new PbeSelectionInput(Id(7000), 1, "Practice", [c], [], [], .1);
        Assert.Throws<ArgumentException>(() => PbeSelectionRules.Select(input with { Candidates = [c with { RepairTargetIds = [Id(9999)] }] }));
        Assert.Throws<ArgumentException>(() => PbeSelectionRules.Select(input with { Candidates = [c with { RepairTargetIds = [Id(1001), Id(1001)] }] }));
    }
}
