using System.Collections.Concurrent;

namespace Erudoza.Api.Practice;

// Exactly one API instance owns the live clock. Durable state never reuses clocks after restart.
public sealed class PracticeRuntime(TimeProvider time)
{
    public TimeProvider Time { get; } = time;
    public PracticeTelemetry Telemetry { get; } = new(time);
    public string ProcessId { get; } = Guid.NewGuid().ToString("N");
    private int pruneCounter;
    public bool ShouldPrune() => Interlocked.Increment(ref pruneCounter) % 240 == 1;
    private readonly SemaphoreSlim[] gates = Enumerable.Range(0, 256).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    private readonly SemaphoreSlim sqliteWriter = new(1, 1);
    private readonly SemaphoreSlim[] awardGates = Enumerable.Range(0, 128).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    public async Task<IDisposable> EnterAwards(Guid season, CancellationToken ct)
    {
        var gate = awardGates[(int)((uint)season.GetHashCode() % (uint)awardGates.Length)];
        await gate.WaitAsync(ct);
        return new Lease(gate);
    }
    public async Task<IDisposable> EnterSqlite(CancellationToken ct)
    {
        await sqliteWriter.WaitAsync(ct);
        return new Lease(sqliteWriter);
    }
    private readonly object admissionGate = new();
    private readonly Dictionary<Guid, int> pending = [];
    private readonly HashSet<Guid> active = [];
    public void Activate(Guid room) { lock (admissionGate) active.Add(room); }
    public void Deactivate(Guid room) { lock (admissionGate) active.Remove(room); }
    public IDisposable Admit(Guid room)
    {
        lock (admissionGate)
        {
            if (!active.Contains(room)) return new Admission(() => { });
            if (pending.GetValueOrDefault(room) >= 16) throw new Erudoza.Domain.DomainException("Too many pending submissions. Please retry shortly.");
            pending[room] = pending.GetValueOrDefault(room) + 1;
        }
        return new Admission(() => { lock (admissionGate) { if (pending[room] <= 1) pending.Remove(room); else pending[room]--; } });
    }
    public bool HasPending(Guid room) { lock (admissionGate) return pending.GetValueOrDefault(room) > 0; }
    private sealed class Admission(Action dispose) : IDisposable { public void Dispose() => dispose(); }
    public async Task<IDisposable> Enter(Guid roomId, CancellationToken ct)
    {
        var gate = gates[(int)((uint)roomId.GetHashCode() % (uint)gates.Length)];
        await gate.WaitAsync(ct);
        return new Lease(gate);
    }
    private sealed class Lease(SemaphoreSlim gate) : IDisposable { public void Dispose() => gate.Release(); }
    public long Stamp() => Time.GetTimestamp();
    public DateTimeOffset Now => Time.GetUtcNow();
    public TimeSpan Elapsed(long from, long to) => Time.GetElapsedTime(from, to);
    public long After(long stamp, TimeSpan delay) => checked(stamp + (long)(delay.TotalSeconds * Time.TimestampFrequency));
}
