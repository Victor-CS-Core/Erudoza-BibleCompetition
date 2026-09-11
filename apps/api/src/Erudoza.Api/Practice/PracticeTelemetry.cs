using System.Security.Cryptography;
using Erudoza.Domain;

namespace Erudoza.Api.Practice;

public sealed record PracticeTimingDiagnostics(double RttMs, double JitterMs, int Samples);

// Diagnostics only. These measurements must never adjust submission timestamps or scores.
public sealed class PracticeTelemetry(TimeProvider time)
{
    private const int MaximumPairs = 10_000;
    private readonly object gate = new();
    private readonly Dictionary<(Guid User, Guid Room), ProbeState> states = [];
    private long lastCleanup = time.GetTimestamp();

    private sealed class ProbeState(long now)
    {
        public long LastActivity = now;
        public long SentAt;
        public string? Nonce;
        public Queue<double> Samples = new();
    }

    public string Begin(Guid userId, Guid roomId)
    {
        lock (gate)
        {
            var now = time.GetTimestamp();
            Cleanup(now);
            var key = (userId, roomId);
            if (!states.TryGetValue(key, out var state))
            {
                if (states.Count >= MaximumPairs)
                    states.Remove(states.MinBy(pair => pair.Value.LastActivity).Key);
                states[key] = state = new ProbeState(now);
            }
            state.Nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
            state.SentAt = now;
            state.LastActivity = now;
            return state.Nonce;
        }
    }

    public PracticeTimingDiagnostics Complete(Guid userId, Guid roomId, string nonce)
    {
        lock (gate)
        {
            var now = time.GetTimestamp();
            Cleanup(now);
            if (!states.TryGetValue((userId, roomId), out var state) || state.Nonce is null ||
                !string.Equals(state.Nonce, nonce, StringComparison.Ordinal))
                throw new DomainException("This timing probe is no longer outstanding.");
            state.Nonce = null; // Consume before expiry validation: even expired probes are single-use.
            var elapsed = time.GetElapsedTime(state.SentAt, now);
            if (elapsed < TimeSpan.Zero || elapsed > TimeSpan.FromSeconds(10))
                throw new DomainException("This timing probe has expired.");
            state.LastActivity = now;
            state.Samples.Enqueue(elapsed.TotalMilliseconds);
            if (state.Samples.Count > 20) state.Samples.Dequeue();
            return Summarize(state);
        }
    }

    public PracticeTimingDiagnostics? Current(Guid userId, Guid roomId)
    {
        lock (gate)
        {
            var now = time.GetTimestamp();
            Cleanup(now);
            if (!states.TryGetValue((userId, roomId), out var state)) return null;
            if (time.GetElapsedTime(state.LastActivity, now) > TimeSpan.FromMinutes(30))
            {
                states.Remove((userId, roomId));
                return null;
            }
            return state.Samples.Count == 0 ? null : Summarize(state);
        }
    }

    private void Cleanup(long now)
    {
        if (time.GetElapsedTime(lastCleanup, now) < TimeSpan.FromMinutes(1)) return;
        foreach (var key in states.Where(pair => time.GetElapsedTime(pair.Value.LastActivity, now) > TimeSpan.FromMinutes(30)).Select(pair => pair.Key).ToArray())
            states.Remove(key);
        lastCleanup = now;
    }

    private static PracticeTimingDiagnostics Summarize(ProbeState state)
    {
        var samples = state.Samples.ToArray();
        // RTT is the most recent server-observed round trip; jitter is the mean
        // absolute difference between successive samples in the rolling window.
        var jitter = samples.Length < 2 ? 0 : samples.Zip(samples.Skip(1), (left, right) => Math.Abs(right - left)).Average();
        return new(samples[^1], jitter, samples.Length);
    }
}
