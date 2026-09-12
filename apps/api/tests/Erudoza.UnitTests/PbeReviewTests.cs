using Erudoza.Domain.Study;
namespace Erudoza.UnitTests;

public sealed class PbeReviewTests
{
    [Fact]
    public void Recognition_aid_and_early_replay_cannot_postpone_failed_or_due_recall()
    {
        var t = Guid.NewGuid(); var q = Guid.NewGuid(); var s = PbeReviewRules.Initial(t);
        PbeRecallEvidence E(int n, long at, int earned = 1, bool unaided = true, bool recall = true) => new(Guid.Parse($"00000000-0000-0000-0000-{n:000000000000}"), t, q, at, earned, 1, unaided, recall);
        s = PbeReviewRules.Advance(s, E(1, 1000, 0)); Assert.True(s.Unresolved);
        Assert.Equal(s, PbeReviewRules.Advance(s, E(2, 2000, recall: false)));
        s = PbeReviewRules.Advance(s, E(3, 2000, unaided: false)); Assert.True(s.Unresolved); Assert.Equal(1000, s.DueAtMs);
        s = PbeReviewRules.Advance(s, E(4, 2000)); Assert.Equal((0, 86402000L), (s.IntervalIndex, s.DueAtMs));
        s = PbeReviewRules.Advance(s, E(5, 3000)); Assert.Equal((0, 86402000L), (s.IntervalIndex, s.DueAtMs));
        s = PbeReviewRules.Advance(s, E(6, 86402000)); Assert.Equal((1, 345602000L), (s.IntervalIndex, s.DueAtMs));
        s = PbeReviewRules.Advance(s, E(7, 345602000)); Assert.Equal((2, 950402000L), (s.IntervalIndex, s.DueAtMs));
        s = PbeReviewRules.Advance(s, E(8, 950402000)); Assert.Equal((3, 2160002000L), (s.IntervalIndex, s.DueAtMs));
        s = PbeReviewRules.Advance(s, E(9, 950402001, 0, false)); Assert.Equal((-1, 950402001L, true), (s.IntervalIndex, s.DueAtMs, s.Unresolved));
    }
    [Fact]
    public void Multipart_grading_is_grouped_and_skill_mismatch_cannot_supply_exact_recall()
    {
        var target = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001"); var source = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000001");
        var targets = new[] { new Erudoza.Domain.Practice.PbeTarget { Id = target, SourceUnitIds = [source], Skill = Erudoza.Domain.Practice.RecallSkill.FactualRecall, Label = "Labels" } };
        var q = new Erudoza.Domain.Practice.PbeQuestion { SchemaVersion = 2, Id = Guid.NewGuid(), Version = 1, ContentPackId = Guid.NewGuid(), SourceUnitId = source, SourceUnitIds = [source], SourceKind = Erudoza.Domain.Practice.PbeSourceKind.Scripture, Kind = Erudoza.Domain.Practice.PbeQuestionKind.ShortAnswer, Reference = "GEN 1:1", Evidence = "Alpha Beta", Prompt = "Name labels", Ordered = true, Parts = [new() { TargetId = target, AcceptedAnswers = ["A"], Points = 1 }, new() { TargetId = target, AcceptedAnswers = ["B"], Points = 2 }] };
        var e = PbeReviewRules.Group(q, targets, ["A", "wrong"], Guid.NewGuid(), 1000, true).Single(); Assert.Equal((1, 3, true), (e.EarnedPoints, e.AvailablePoints, e.Recall));
        targets[0].Skill = Erudoza.Domain.Practice.RecallSkill.ExactWords; Assert.False(PbeReviewRules.Group(q, targets, ["A", "B"], Guid.NewGuid(), 1000, true).Single().Recall);
        q.Kind = Erudoza.Domain.Practice.PbeQuestionKind.ExactWords; Assert.True(PbeReviewRules.Group(q, targets, ["A", "B"], Guid.NewGuid(), 1000, true).Single().Recall);
    }
}
