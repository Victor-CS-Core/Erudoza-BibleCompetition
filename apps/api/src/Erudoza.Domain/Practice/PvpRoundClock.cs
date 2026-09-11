namespace Erudoza.Domain.Practice;

public sealed record RoundSchedule(Guid Id, DateTimeOffset StartsAtUtc, int DurationSeconds);

/// <summary>Server-only ingress evidence. Never deserialize this type from a client.</summary>
public sealed record IngressStamp(Guid ClockId, Guid? ScheduleId, long Timestamp);

/// <summary>
/// A process-local clock for one round. UTC is audit/display data only. CaptureIngress
/// must run before waiting for room serialization or performing database/grading work.
/// Persisted schedules must be replaced after process restart, never reconstructed.
/// </summary>
public sealed class PvpRoundClock(TimeProvider timeProvider)
{
    private readonly object gate = new();
    private readonly Guid clockId = Guid.NewGuid();
    private RoundSchedule? schedule;
    private long scheduledTimestamp;
    private TimeSpan startDelay;
    private readonly HashSet<Guid> scribes = [];
    private readonly HashSet<Guid> acknowledgements = [];

    public RoundSchedule Schedule(Guid scribeA, Guid scribeB, TimeSpan delay, int durationSeconds)
    {
        if (scribeA == Guid.Empty || scribeB == Guid.Empty || scribeA == scribeB)
            throw new ArgumentException("Two distinct scribes are required.");
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(delay, TimeSpan.Zero);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(durationSeconds);
        lock (gate)
        {
            scheduledTimestamp = timeProvider.GetTimestamp();
            startDelay = delay;
            schedule = new(Guid.NewGuid(), timeProvider.GetUtcNow() + delay, durationSeconds);
            scribes.Clear();
            scribes.UnionWith([scribeA, scribeB]);
            acknowledgements.Clear();
            return schedule;
        }
    }

    public bool Acknowledge(Guid scheduleId, Guid scribeId)
    {
        lock (gate)
        {
            if (schedule?.Id != scheduleId || !scribes.Contains(scribeId) ||
                timeProvider.GetElapsedTime(scheduledTimestamp, timeProvider.GetTimestamp()) >= startDelay) return false;
            acknowledgements.Add(scribeId);
            return true;
        }
    }

    public IngressStamp CaptureIngress()
    {
        // Obtain the timestamp before even taking the clock-state lock.
        var timestamp = timeProvider.GetTimestamp();
        lock (gate) return new(clockId, schedule?.Id, timestamp);
    }

    public TimeSpan Elapsed(IngressStamp ingress)
    {
        ArgumentNullException.ThrowIfNull(ingress);
        lock (gate)
        {
            if (ingress.ClockId != clockId || schedule is null || ingress.ScheduleId != schedule.Id)
                throw new InvalidOperationException("Ingress belongs to another clock or schedule.");
            if (acknowledgements.Count != 2)
                throw new InvalidOperationException("Both scribes must acknowledge before the scheduled start.");
            var elapsed = timeProvider.GetElapsedTime(scheduledTimestamp, ingress.Timestamp) - startDelay;
            if (elapsed < TimeSpan.Zero) throw new InvalidOperationException("Response window has not opened.");
            return elapsed;
        }
    }

    public bool IsLate(IngressStamp ingress)
    {
        lock (gate) return Elapsed(ingress) > TimeSpan.FromSeconds(schedule!.DurationSeconds);
    }
}
