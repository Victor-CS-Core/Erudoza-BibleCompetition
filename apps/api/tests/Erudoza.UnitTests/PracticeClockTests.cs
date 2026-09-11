using Erudoza.Domain.Practice;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class PracticeClockTests
{
    private readonly Guid a = Guid.NewGuid();
    private readonly Guid b = Guid.NewGuid();

    [Fact]
    public void Both_scribes_must_acknowledge_current_schedule_before_start()
    {
        var time = new ManualTime();
        var clock = new PvpRoundClock(time);
        var schedule = clock.Schedule(a, b, TimeSpan.FromSeconds(2), 25);
        clock.Acknowledge(schedule.Id, a).Should().BeTrue();
        time.Advance(TimeSpan.FromSeconds(3));
        clock.Acknowledge(schedule.Id, b).Should().BeFalse();
        var act = () => clock.Elapsed(clock.CaptureIngress());
        act.Should().Throw<InvalidOperationException>();
        var replacement = clock.Schedule(a, b, TimeSpan.FromSeconds(2), 25);
        clock.Acknowledge(schedule.Id, b).Should().BeFalse();
        clock.Acknowledge(replacement.Id, a).Should().BeTrue();
        clock.Acknowledge(replacement.Id, b).Should().BeTrue();
        time.Advance(TimeSpan.FromSeconds(3));
        clock.Elapsed(clock.CaptureIngress()).Should().Be(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void Ingress_time_excludes_queue_delay_and_ignores_wall_clock_jump()
    {
        var time = new ManualTime();
        var clock = Ready(time);
        time.Advance(TimeSpan.FromSeconds(7));
        var ingress = clock.CaptureIngress();
        time.Advance(TimeSpan.FromSeconds(10));
        time.Utc = time.Utc.AddDays(-5);
        clock.Elapsed(ingress).Should().Be(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void Early_ingress_and_another_clock_instance_are_rejected()
    {
        var time = new ManualTime();
        var clock = Ready(time);
        var early = () => clock.Elapsed(clock.CaptureIngress());
        early.Should().Throw<InvalidOperationException>();
        time.Advance(TimeSpan.FromSeconds(3));
        var foreign = new PvpRoundClock(time).CaptureIngress();
        var restarted = () => clock.Elapsed(foreign);
        restarted.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void Exact_deadline_is_timely_but_one_tick_later_is_late()
    {
        var time = new ManualTime();
        var clock = Ready(time);
        time.Advance(TimeSpan.FromSeconds(27));
        clock.IsLate(clock.CaptureIngress()).Should().BeFalse();
        time.Advance(TimeSpan.FromTicks(1));
        clock.IsLate(clock.CaptureIngress()).Should().BeTrue();
    }

    private PvpRoundClock Ready(ManualTime time)
    {
        var clock = new PvpRoundClock(time);
        var schedule = clock.Schedule(a, b, TimeSpan.FromSeconds(2), 25);
        clock.Acknowledge(schedule.Id, a);
        clock.Acknowledge(schedule.Id, b);
        return clock;
    }

    private sealed class ManualTime : TimeProvider
    {
        private long timestamp;
        public DateTimeOffset Utc { get; set; } = new(2026, 9, 10, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Utc;
        public override long GetTimestamp() => timestamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public void Advance(TimeSpan duration) { timestamp += duration.Ticks; Utc += duration; }
    }
}
