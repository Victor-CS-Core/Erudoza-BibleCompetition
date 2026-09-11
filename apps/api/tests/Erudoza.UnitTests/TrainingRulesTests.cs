using Erudoza.Application.Contracts;
using Erudoza.Application.Study;
using Erudoza.Domain.Study;
namespace Erudoza.UnitTests;

public class TrainingRulesTests
{
    [Fact]
    public void Honors_require_distinct_current_eligible_evidence_and_nonempty_scopes()
    {
        var states = Enumerable.Range(0, 10).Select(_ => new Erudoza.Domain.MasteryState { KnowledgeUnitId = Guid.NewGuid(), ExactWordingScore = 80, ReferenceScore = 70, AlgorithmVersion = "v2-skill-evidence", Level = Erudoza.Domain.MasteryLevel.Strong }).ToList();
        var ids = states.Select(x => x.KnowledgeUnitId).ToArray();
        Assert.Equal(4, TrainingRules.ExactRecallCount(ids, states.Take(4))); Assert.Equal(5, TrainingRules.ExactRecallCount(ids, states.Take(5)));
        Assert.Equal(9, TrainingRules.ReferenceReadyCount(ids, states.Take(9))); Assert.Equal(10, TrainingRules.ReferenceReadyCount(ids, states));
        states[0].AlgorithmVersion = "v1-scaffold"; Assert.Equal(9, TrainingRules.ReferenceReadyCount(ids, states)); Assert.False(TrainingRules.ChapterStrong(ids, states));
        Assert.False(TrainingRules.ChapterStrong([], states)); Assert.False(TrainingRules.FullCoverage([], ids)); Assert.False(TrainingRules.FullCoverage(ids, ids.Take(9)));
        Assert.Equal(0, TrainingRules.ExactRecallCount([], states)); Assert.True(TrainingRules.SteadyStudy(["2026-01-05", "2026-01-19", "2026-02-02", "2026-03-02"])); Assert.False(TrainingRules.SteadyStudy(Enumerable.Repeat("2026-01-05", 4)));
    }
    [Fact]
    public void ReplayAndEarlyFinishDoNotReachTarget()
    {
        var evidence = new AcceptedTrainingEvidence(Guid.NewGuid(), Guid.NewGuid(), false, false);
        Assert.False(TrainingRules.FullTargetReached(8, Enumerable.Repeat(evidence, 8)));
        Assert.False(TrainingRules.FullTargetReached(0, [evidence]));
        Assert.True(TrainingRules.FullTargetReached(8, Enumerable.Range(0, 8).Select(_ => evidence with { CardId = Guid.NewGuid() })));
        Assert.False(TrainingRules.FullTargetReached(1, [evidence with { IsLegacyDuplicate = true }]));
    }
    [Fact]
    public void ReviewEffortIsNonemptyDistinctAndIgnoresCorrectness()
    {
        var evidence = new AcceptedTrainingEvidence(Guid.NewGuid(), Guid.NewGuid(), false, false);
        Assert.False(TrainingRules.ReviewSetComplete([], [evidence]));
        Assert.True(TrainingRules.ReviewSetComplete([evidence.KnowledgeUnitId], [evidence]));
        Assert.False(TrainingRules.ReviewSetComplete([evidence.KnowledgeUnitId, Guid.NewGuid()], [evidence]));
    }
}
public class TrainingCalendarTests
{
    [Theory]
    [InlineData("2026-09-14T03:59:59Z", "2026-09-13", "2026-09-07")]
    [InlineData("2026-09-14T04:00:00Z", "2026-09-14", "2026-09-14")]
    [InlineData("2026-03-08T07:00:00Z", "2026-03-08", "2026-03-02")]
    [InlineData("2026-11-01T06:00:00Z", "2026-11-01", "2026-10-26")]
    public void UsesLocalMondayAndDst(string instant, string day, string week)
    {
        var result = TrainingCalendar.Resolve(DateTimeOffset.Parse(instant), new("America/New_York", 5, null));
        Assert.Equal(day, result.LocalDate); Assert.Equal(week, result.WeekStartLocalDate);
    }
    [Fact]
    public void RejectsInvalidZoneAndTarget()
    {
        Assert.Throws<Erudoza.Domain.DomainException>(() => TrainingCalendar.Validate("Mars/Olympus", 5));
        Assert.Throws<Erudoza.Domain.DomainException>(() => TrainingCalendar.Validate("UTC", 2));
    }
}
