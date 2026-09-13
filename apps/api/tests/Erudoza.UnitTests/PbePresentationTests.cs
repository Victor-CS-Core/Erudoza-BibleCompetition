using Erudoza.Application.Study;
using Erudoza.Domain.Practice;

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
    public void Automatic_expiry_stays_pending_during_the_pre_start_schedule()
    {
        var time = new ManualTime(); var authority = new PbeSoloTimingAuthority(time);
        var session = Guid.NewGuid(); var student = Guid.NewGuid(); var question = Guid.NewGuid();
        var shown = authority.Present(session, student, question, 1, "TextFallback");
        var ack = authority.CaptureIfActive(session)!; authority.Acknowledge(session, student, question, shown.Revision, "TextFallback", ack); ack.Complete();
        var status = authority.CaptureIfActive(session)!; Assert.Null(authority.Expire(session, student, question, shown.Revision, status, 1)); status.Complete();
    }

    [Fact]
    public void Solo_authority_does_not_allocate_unknown_ids_and_freezes_a_timely_draft()
    {
        var time = new ManualTime();
        var authority = new PbeSoloTimingAuthority(time);
        var session = Guid.NewGuid(); var student = Guid.NewGuid(); var question = Guid.NewGuid();
        Assert.Null(authority.CaptureIfActive(session));
        var shown = authority.Present(session, student, question, 1, "TextFallback");
        var ackIngress = authority.CaptureIfActive(session)!;
        authority.Acknowledge(session, student, question, shown.Revision, shown.Delivery, ackIngress);
        ackIngress.Complete();
        time.Advance(TimeSpan.FromSeconds(4));
        var draftIngress = authority.CaptureIfActive(session)!;
        authority.Draft(session, student, question, shown.Revision, ["timely"], draftIngress);
        draftIngress.Complete();
        time.Advance(TimeSpan.FromSeconds(30));
        var finalIngress = authority.CaptureIfActive(session)!;
        var decision = authority.Lock(session, student, question, shown.Revision, "submission", ["late"], finalIngress);
        finalIngress.Complete();
        Assert.Equal(["timely"], decision.Answers);
        Assert.Equal(1000, decision.ElapsedMs);
        Assert.Throws<PbeProgressConflictException>(() => authority.Lock(session, student, question, shown.Revision, "another-submission", ["late"], authority.CaptureIfActive(session)));
        Assert.Throws<PbeProgressConflictException>(() => authority.Lock(session, student, question, shown.Revision, "submission", ["changed"], authority.CaptureIfActive(session)));
    }

    [Fact]
    public async Task Expiry_uses_monotonic_time_preserves_inclusive_pending_drafts_and_ignores_utc_jumps()
    {
        var time = new ManualTime(); var authority = new PbeSoloTimingAuthority(time); var session = Guid.NewGuid(); var student = Guid.NewGuid(); var question = Guid.NewGuid();
        var shown = authority.Present(session, student, question, 1, "TextFallback"); var ack = authority.CaptureIfActive(session)!; authority.Acknowledge(session, student, question, shown.Revision, shown.Delivery, ack); ack.Complete();
        time.AdvanceMonotonic(TimeSpan.FromSeconds(3)); time.AdvanceUtc(TimeSpan.FromHours(2));
        var early = authority.CaptureIfActive(session)!; await early.WaitAsync(); Assert.Null(authority.Expire(session, student, question, shown.Revision, early, 1)); early.Complete();
        time.AdvanceMonotonic(TimeSpan.FromSeconds(25)); var draft = authority.CaptureIfActive(session)!; time.AdvanceMonotonic(TimeSpan.FromMilliseconds(1)); var expiry = authority.CaptureIfActive(session)!;
        Assert.False(expiry.WaitAsync().IsCompleted); await draft.WaitAsync(); authority.Draft(session, student, question, shown.Revision, ["boundary"], draft); draft.Complete();
        await expiry.WaitAsync(); time.AdvanceUtc(TimeSpan.FromHours(-4)); var decision = authority.Expire(session, student, question, shown.Revision, expiry, 1); expiry.Complete();
        Assert.Equal(["boundary"], decision!.Answers); Assert.Equal(25000, decision.ElapsedMs);
    }

    [Fact]
    public async Task Captured_commands_preserve_arrival_order_and_bound_pending_work()
    {
        var time = new ManualTime(); var authority = new PbeSoloTimingAuthority(time); var session = Guid.NewGuid(); var student = Guid.NewGuid(); var question = Guid.NewGuid();
        var shown = authority.Present(session, student, question, 1, "TextFallback"); var ack = authority.CaptureIfActive(session)!; await ack.WaitAsync(); authority.Acknowledge(session, student, question, shown.Revision, shown.Delivery, ack); ack.Complete();
        time.Advance(TimeSpan.FromSeconds(4)); var draftIngress = authority.CaptureIfActive(session)!; time.Advance(TimeSpan.FromSeconds(30)); var finalIngress = authority.CaptureIfActive(session)!;
        var finalReady = finalIngress.WaitAsync(); Assert.False(finalReady.IsCompleted);
        await draftIngress.WaitAsync(); authority.Draft(session, student, question, shown.Revision, ["timely"], draftIngress); draftIngress.Complete();
        await finalReady; var decision = authority.Lock(session, student, question, shown.Revision, "submission", ["late"], finalIngress); finalIngress.Complete(); Assert.Equal(["timely"], decision.Answers);
        var pending = Enumerable.Range(0, 32).Select(_ => authority.CaptureIfActive(session)!).ToList(); Assert.Throws<PbePendingLimitException>(() => authority.CaptureIfActive(session)); foreach (var ingress in pending) ingress.Complete();
    }

    [Fact]
    public async Task Cancelled_fifo_wait_releases_its_lease_without_bypassing_its_predecessor()
    {
        var authority = new PbeSoloTimingAuthority(new ManualTime()); var session = Guid.NewGuid(); authority.Present(session, Guid.NewGuid(), Guid.NewGuid(), 1, "TextFallback");
        var first = authority.CaptureIfActive(session)!; var cancelled = authority.CaptureIfActive(session)!; using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled.WaitAsync(cancellation.Token)); cancelled.Complete();
        var following = authority.CaptureIfActive(session)!; Assert.False(following.WaitAsync().IsCompleted); first.Complete(); await following.WaitAsync(); following.Complete();
    }

    private sealed class ManualTime : TimeProvider
    {
        private long timestamp, utcMilliseconds;
        public override long TimestampFrequency => 1000;
        public override long GetTimestamp() => timestamp;
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddMilliseconds(utcMilliseconds);
        public void Advance(TimeSpan elapsed) { AdvanceMonotonic(elapsed); AdvanceUtc(elapsed); }
        public void AdvanceMonotonic(TimeSpan elapsed) => timestamp += (long)elapsed.TotalMilliseconds;
        public void AdvanceUtc(TimeSpan elapsed) => utcMilliseconds += (long)elapsed.TotalMilliseconds;
    }
}
