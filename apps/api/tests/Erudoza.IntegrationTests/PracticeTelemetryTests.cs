using Erudoza.Api.Practice;
using Erudoza.Domain;

namespace Erudoza.IntegrationTests;

public sealed class PracticeTelemetryTests
{
    private sealed class Clock : TimeProvider
    {
        private long timestamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => timestamp;
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch;
        public void Advance(TimeSpan duration) => timestamp += duration.Ticks;
    }

    [Fact]
    public void Measures_monotonic_server_roundtrip_and_jitter_without_client_durations()
    {
        var clock = new Clock(); var telemetry = new PracticeTelemetry(clock);
        var user = Guid.NewGuid(); var room = Guid.NewGuid();
        Assert.Null(telemetry.Current(user, room));
        var nonce = telemetry.Begin(user, room);
        clock.Advance(TimeSpan.FromMilliseconds(40));
        Assert.Equal(new PracticeTimingDiagnostics(40, 0, 1), telemetry.Complete(user, room, nonce));
        nonce = telemetry.Begin(user, room);
        clock.Advance(TimeSpan.FromMilliseconds(100));
        Assert.Equal(new PracticeTimingDiagnostics(100, 60, 2), telemetry.Complete(user, room, nonce));
        Assert.Equal(new PracticeTimingDiagnostics(100, 60, 2), telemetry.Current(user, room));
    }

    [Fact]
    public void Nonces_are_single_use_bound_to_user_and_room_and_replaced_by_new_probe()
    {
        var clock = new Clock(); var telemetry = new PracticeTelemetry(clock);
        var user = Guid.NewGuid(); var room = Guid.NewGuid();
        var old = telemetry.Begin(user, room); var nonce = telemetry.Begin(user, room);
        Assert.NotEqual(old, nonce);
        Assert.Throws<DomainException>(() => telemetry.Complete(user, room, old));
        Assert.Throws<DomainException>(() => telemetry.Complete(Guid.NewGuid(), room, nonce));
        Assert.Throws<DomainException>(() => telemetry.Complete(user, Guid.NewGuid(), nonce));
        telemetry.Complete(user, room, nonce);
        Assert.Throws<DomainException>(() => telemetry.Complete(user, room, nonce));
    }

    [Fact]
    public void Expired_probe_cannot_inject_latency_and_idle_samples_are_removed()
    {
        var clock = new Clock(); var telemetry = new PracticeTelemetry(clock);
        var user = Guid.NewGuid(); var room = Guid.NewGuid();
        var nonce = telemetry.Begin(user, room);
        clock.Advance(TimeSpan.FromSeconds(10) + TimeSpan.FromTicks(1));
        Assert.Throws<DomainException>(() => telemetry.Complete(user, room, nonce));
        Assert.Null(telemetry.Current(user, room));
        nonce = telemetry.Begin(user, room); telemetry.Complete(user, room, nonce);
        clock.Advance(TimeSpan.FromMinutes(31));
        Assert.Null(telemetry.Current(user, room));
    }

    [Fact]
    public void Keeps_only_the_last_twenty_successful_samples()
    {
        var clock = new Clock(); var telemetry = new PracticeTelemetry(clock);
        var user = Guid.NewGuid(); var room = Guid.NewGuid();
        for (var i = 0; i < 22; i++)
        {
            var nonce = telemetry.Begin(user, room);
            clock.Advance(TimeSpan.FromMilliseconds(i < 2 ? 999 : 50));
            telemetry.Complete(user, room, nonce);
        }
        Assert.Equal(new PracticeTimingDiagnostics(50, 0, 20), telemetry.Current(user, room));
    }
}
