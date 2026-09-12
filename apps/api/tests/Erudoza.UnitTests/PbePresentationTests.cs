using Erudoza.Domain.Practice;
using Erudoza.Application.Study;

namespace Erudoza.UnitTests;

public sealed class PbePresentationTests
{
    [Theory]
    [InlineData(1, 5000, 1, 1)]
    [InlineData(1, 25000, 1, 1)]
    [InlineData(1, 25001, 1, 0)]
    public void Rehearsal_points_use_an_inclusive_authoritative_deadline(int earned, double elapsedMs, int points, int expected)
        => Assert.Equal(expected, PbePresentationRules.RehearsalPoints(earned, elapsedMs, points));

    [Fact]
    public void Solo_clock_requires_its_one_scribe_and_uses_monotonic_ingress()
    {
        var time = new ManualTime();
        var clock = new PvpRoundClock(time);
        var scribe = Guid.NewGuid();
        var schedule = clock.Schedule([scribe], TimeSpan.FromSeconds(3), 25);
        Assert.False(clock.Acknowledge(schedule.Id, Guid.NewGuid()));
        Assert.True(clock.Acknowledge(schedule.Id, scribe));
        time.Advance(TimeSpan.FromSeconds(28));
        Assert.Equal(TimeSpan.FromSeconds(25), clock.Elapsed(clock.CaptureIngress()));
    }

    [Fact]
    public void Shared_clock_accepts_one_or_two_scribes_only()
    {
        var clock = new PvpRoundClock(new ManualTime());
        Assert.Throws<ArgumentException>(() => clock.Schedule([], TimeSpan.FromSeconds(3), 25));
        Assert.Throws<ArgumentException>(() => clock.Schedule([Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()], TimeSpan.FromSeconds(3), 25));
        Assert.NotNull(clock.Schedule([Guid.NewGuid(), Guid.NewGuid()], TimeSpan.FromSeconds(3), 25));
    }

    [Fact]
    public void Solo_authority_does_not_allocate_unknown_ids_and_freezes_a_timely_draft()
    {
        var time = new ManualTime();
        var authority = new PbeSoloTimingAuthority(time);
        var session = Guid.NewGuid(); var student = Guid.NewGuid(); var question = Guid.NewGuid();
        Assert.Null(authority.CaptureIfActive(session));
        var shown = authority.Present(session, student, question, 1, "TextFallback");
        var ackIngress = authority.CaptureIfActive(session);
        authority.Acknowledge(session, student, question, shown.Revision, shown.Delivery, ackIngress);
        time.Advance(TimeSpan.FromSeconds(4));
        authority.Draft(session, student, question, shown.Revision, ["timely"], authority.CaptureIfActive(session));
        time.Advance(TimeSpan.FromSeconds(30));
        var decision = authority.Lock(session, student, question, shown.Revision, "submission", ["late"], authority.CaptureIfActive(session));
        Assert.Equal(["timely"], decision.Answers);
        Assert.Equal(1000, decision.ElapsedMs);
        Assert.Throws<PbeProgressConflictException>(() => authority.Lock(session, student, question, shown.Revision, "another-submission", ["late"], authority.CaptureIfActive(session)));
        Assert.Throws<PbeProgressConflictException>(() => authority.Lock(session, student, question, shown.Revision, "submission", ["changed"], authority.CaptureIfActive(session)));
    }

    private sealed class ManualTime : TimeProvider
    {
        private long timestamp;
        public override long TimestampFrequency => 1000;
        public override long GetTimestamp() => timestamp;
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddMilliseconds(timestamp);
        public void Advance(TimeSpan elapsed) => timestamp += (long)elapsed.TotalMilliseconds;
    }
}
