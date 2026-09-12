using System.Collections.Concurrent;
using Erudoza.Domain;
using Erudoza.Domain.Practice;

namespace Erudoza.Application.Study;

public sealed class PbeSoloIngress(Guid sessionId, IngressStamp stamp, DateTimeOffset receivedAtUtc, Task predecessor, Action release)
{
    private int completed;
    public Guid SessionId { get; } = sessionId;
    public IngressStamp Stamp { get; } = stamp;
    public DateTimeOffset ReceivedAtUtc { get; } = receivedAtUtc;
    public Task WaitAsync(CancellationToken ct = default) => predecessor.WaitAsync(ct);
    public void Complete() { if (Interlocked.Exchange(ref completed, 1) == 0) release(); }
}
public sealed record PbeTimedDecision(string ClientSubmissionId, IReadOnlyList<string> Answers, IReadOnlyList<string> RetryAnswers, long ElapsedMs, DateTimeOffset LockedAtUtc);
public sealed record PbeTimedDraft(PbeSoloTimingView View, IReadOnlyList<string> Answers, long ElapsedMs, DateTimeOffset LockedAtUtc);
public sealed record PbeSoloTimingView(Guid QuestionId, int Revision, string Delivery, IReadOnlyList<Guid> RequiredScribeIds, IReadOnlyList<Guid> ReadyScribeIds, long? ResponseStartsAtMs, long? ResponseEndsAtMs, string Status, DateTimeOffset ServerNow, bool FeedbackDeferred = true);
public sealed class PbePendingLimitException : Exception { }

public interface IPbeSoloTimingAuthority
{
    PbeSoloIngress? CaptureIfActive(Guid sessionId);
    PbeSoloTimingView? Current(Guid sessionId, Guid student, Guid question);
    PbeSoloTimingView Present(Guid sessionId, Guid student, Guid question, int points, string delivery);
    PbeSoloTimingView Acknowledge(Guid sessionId, Guid student, Guid question, int revision, string delivery, PbeSoloIngress? ingress);
    PbeTimedDraft Draft(Guid sessionId, Guid student, Guid question, int revision, string[] answers, PbeSoloIngress? ingress);
    PbeTimedDecision Lock(Guid sessionId, Guid student, Guid question, int revision, string clientSubmissionId, string[] answers, PbeSoloIngress? ingress);
    PbeTimedDecision? Expire(Guid sessionId, Guid student, Guid question, int revision, PbeSoloIngress? ingress, int answerCount);
}

public sealed class PbeSoloTimingAuthority(TimeProvider time) : IPbeSoloTimingAuthority
{
    private sealed class Entry(Guid student, Guid question, int points, string delivery, TimeProvider time)
    {
        public Guid Student { get; } = student;
        public Guid Question { get; } = question;
        public int Points { get; } = points;
        public string Delivery { get; } = delivery;
        public int Revision { get; set; } = 1;
        public PvpRoundClock Clock { get; } = new(time);
        public RoundSchedule? Schedule { get; set; }
        public (IReadOnlyList<string> Answers, long ElapsedMs, DateTimeOffset LockedAtUtc)? Draft { get; set; }
        public PbeTimedDecision? Frozen { get; set; }
        public Task Tail { get; set; } = Task.CompletedTask;
        public int Pending { get; set; }
        public object Gate { get; } = new();
    }
    private readonly ConcurrentDictionary<Guid, Entry> entries = [];
    public PbeSoloIngress? CaptureIfActive(Guid sessionId)
    {
        if (!entries.TryGetValue(sessionId, out var entry)) return null;
        lock (entry.Gate)
        {
            if (entry.Pending >= 32) throw new PbePendingLimitException();
            entry.Pending++;
            var predecessor = entry.Tail;
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            entry.Tail = Task.WhenAll(predecessor, completion.Task);
            return new(sessionId, entry.Clock.CaptureIngress(), time.GetUtcNow(), predecessor, () => { lock (entry.Gate) entry.Pending--; completion.TrySetResult(); });
        }
    }
    public PbeSoloTimingView? Current(Guid sessionId, Guid student, Guid question) => entries.TryGetValue(sessionId, out var entry) && entry.Student == student && entry.Question == question ? View(entry) : null;
    public PbeSoloTimingView Present(Guid sessionId, Guid student, Guid question, int points, string delivery)
    {
        if (delivery is not ("Audio" or "TextFallback")) throw new DomainException("Choose audio or disclosed text fallback.");
        if (!entries.ContainsKey(sessionId) && entries.Count >= 4096)
        {
            foreach (var settled in entries.Where(pair => pair.Value.Frozen is not null).Take(256)) entries.TryRemove(settled.Key, out _);
            if (entries.Count >= 4096) throw new DomainException("Too many active timed rehearsals. Try again shortly.");
        }
        var entry = entries.AddOrUpdate(sessionId, _ => new(student, question, points, delivery, time), (_, old) => old.Question == question ? old : new(student, question, points, delivery, time));
        if (entry.Student != student) throw new UnauthorizedAccessException();
        return View(entry);
    }
    public PbeSoloTimingView Acknowledge(Guid sessionId, Guid student, Guid question, int revision, string delivery, PbeSoloIngress? ingress)
    {
        var entry = Require(sessionId, student, question, revision);
        if (entry.Schedule is not null) return View(entry);
        if (entry.Delivery != delivery || ingress is null) throw new DomainException("Confirm the saved presentation delivery.");
        entry.Schedule = entry.Clock.Schedule([student], TimeSpan.FromSeconds(3), PbeRules.ResponseSeconds(entry.Points));
        if (!entry.Clock.Acknowledge(entry.Schedule.Id, student)) throw new DomainException("Presentation acknowledgement expired.");
        return View(entry);
    }
    public PbeTimedDraft Draft(Guid sessionId, Guid student, Guid question, int revision, string[] answers, PbeSoloIngress? ingress)
    {
        var entry = Require(sessionId, student, question, revision);
        var elapsed = Elapsed(entry, ingress);
        if (elapsed <= TimeSpan.FromSeconds(entry.Schedule!.DurationSeconds)) entry.Draft = ([.. answers], checked((long)elapsed.TotalMilliseconds), ingress!.ReceivedAtUtc);
        var draft = entry.Draft ?? throw new PbeProgressConflictException("The response window has closed.");
        return new(View(entry), draft.Answers, draft.ElapsedMs, draft.LockedAtUtc);
    }
    public PbeTimedDecision Lock(Guid sessionId, Guid student, Guid question, int revision, string clientSubmissionId, string[] answers, PbeSoloIngress? ingress)
    {
        if (string.IsNullOrWhiteSpace(clientSubmissionId) || clientSubmissionId.Length > 200) throw new DomainException("Submission ID is required.");
        var entry = Require(sessionId, student, question, revision);
        if (entry.Frozen is not null)
        {
            if (entry.Frozen.ClientSubmissionId != clientSubmissionId || !entry.Frozen.RetryAnswers.SequenceEqual(answers)) throw new PbeProgressConflictException("The frozen response has another submission payload.");
            return entry.Frozen;
        }
        var elapsed = Elapsed(entry, ingress);
        if (elapsed > TimeSpan.FromSeconds(entry.Schedule!.DurationSeconds) && entry.Draft is { } draft) return entry.Frozen = new(clientSubmissionId, draft.Answers, [.. answers], draft.ElapsedMs, draft.LockedAtUtc);
        var chosen = elapsed <= TimeSpan.FromSeconds(entry.Schedule.DurationSeconds) ? answers : answers.Select(_ => "").ToArray();
        return entry.Frozen = new(clientSubmissionId, chosen, [.. answers], checked((long)elapsed.TotalMilliseconds), ingress!.ReceivedAtUtc);
    }
    public PbeTimedDecision? Expire(Guid sessionId, Guid student, Guid question, int revision, PbeSoloIngress? ingress, int answerCount)
    {
        var entry = Require(sessionId, student, question, revision);
        if (entry.Frozen is not null) return entry.Frozen;
        var elapsed = Elapsed(entry, ingress);
        if (elapsed <= TimeSpan.FromSeconds(entry.Schedule!.DurationSeconds)) return null;
        if (entry.Draft is { } draft) return entry.Frozen = new(Guid.NewGuid().ToString(), draft.Answers, draft.Answers, draft.ElapsedMs, draft.LockedAtUtc);
        var answers = Enumerable.Range(0, answerCount).Select(_ => "").ToArray();
        var lockedAt = entry.Schedule.StartsAtUtc.AddSeconds(entry.Schedule.DurationSeconds);
        return entry.Frozen = new(Guid.NewGuid().ToString(), answers, answers, checked((long)elapsed.TotalMilliseconds), lockedAt);
    }
    private Entry Require(Guid session, Guid student, Guid question, int revision)
    {
        if (!entries.TryGetValue(session, out var entry) || entry.Student != student || entry.Question != question || entry.Revision != revision) throw new DomainException("This action is for another presentation revision.");
        return entry;
    }
    private static TimeSpan Elapsed(Entry entry, PbeSoloIngress? ingress)
    {
        if (ingress is null || entry.Schedule is null) throw new DomainException("The response window has not opened.");
        try { return entry.Clock.Elapsed(ingress.Stamp); }
        catch (InvalidOperationException) { throw new DomainException("The response window has not opened."); }
    }
    private PbeSoloTimingView View(Entry entry) => new(entry.Question, entry.Revision, entry.Delivery, [entry.Student], entry.Schedule is null ? [] : [entry.Student], entry.Schedule?.StartsAtUtc.ToUnixTimeMilliseconds(), entry.Schedule is null ? null : entry.Schedule.StartsAtUtc.AddSeconds(entry.Schedule.DurationSeconds).ToUnixTimeMilliseconds(), entry.Frozen is null ? entry.Schedule is null ? "Presenting" : "Armed" : "Settled", time.GetUtcNow());
}
