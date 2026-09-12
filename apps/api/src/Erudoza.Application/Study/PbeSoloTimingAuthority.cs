using System.Collections.Concurrent;
using Erudoza.Domain;
using Erudoza.Domain.Practice;

namespace Erudoza.Application.Study;

public sealed record PbeSoloIngress(Guid SessionId, IngressStamp Stamp, DateTimeOffset ReceivedAtUtc);
public sealed record PbeTimedDecision(string ClientSubmissionId, IReadOnlyList<string> Answers, long ElapsedMs, DateTimeOffset LockedAtUtc);
public sealed record PbeSoloTimingView(Guid QuestionId, int Revision, string Delivery, IReadOnlyList<Guid> RequiredScribeIds, IReadOnlyList<Guid> ReadyScribeIds, long? ResponseStartsAtMs, long? ResponseEndsAtMs, string Status, DateTimeOffset ServerNow, bool FeedbackDeferred = true);

public interface IPbeSoloTimingAuthority
{
    PbeSoloIngress? CaptureIfActive(Guid sessionId);
    PbeSoloTimingView Present(Guid sessionId, Guid student, Guid question, int points, string delivery);
    PbeSoloTimingView Acknowledge(Guid sessionId, Guid student, Guid question, int revision, string delivery, PbeSoloIngress? ingress);
    PbeSoloTimingView Draft(Guid sessionId, Guid student, Guid question, int revision, string[] answers, PbeSoloIngress? ingress);
    PbeTimedDecision Lock(Guid sessionId, Guid student, Guid question, int revision, string clientSubmissionId, string[] answers, PbeSoloIngress? ingress);
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
        public IReadOnlyList<string>? RetryAnswers { get; set; }
    }
    private readonly ConcurrentDictionary<Guid, Entry> entries = [];
    public PbeSoloIngress? CaptureIfActive(Guid sessionId) => entries.TryGetValue(sessionId, out var e) ? new(sessionId, e.Clock.CaptureIngress(), time.GetUtcNow()) : null;
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
        var e = Require(sessionId, student, question, revision); if (e.Delivery != delivery || ingress is null) throw new DomainException("Confirm the saved presentation delivery.");
        e.Schedule ??= e.Clock.Schedule([student], TimeSpan.FromSeconds(3), PbeRules.ResponseSeconds(e.Points));
        if (!e.Clock.Acknowledge(e.Schedule.Id, student)) throw new DomainException("Presentation acknowledgement expired.");
        return View(e);
    }
    public PbeSoloTimingView Draft(Guid sessionId, Guid student, Guid question, int revision, string[] answers, PbeSoloIngress? ingress)
    {
        var e = Require(sessionId, student, question, revision); var elapsed = Elapsed(e, ingress); if (elapsed <= TimeSpan.FromSeconds(e.Schedule!.DurationSeconds)) e.Draft = ([.. answers], checked((long)elapsed.TotalMilliseconds), ingress!.ReceivedAtUtc); return View(e);
    }
    public PbeTimedDecision Lock(Guid sessionId, Guid student, Guid question, int revision, string clientSubmissionId, string[] answers, PbeSoloIngress? ingress)
    {
        if (string.IsNullOrWhiteSpace(clientSubmissionId) || clientSubmissionId.Length > 200) throw new DomainException("Submission ID is required.");
        var e = Require(sessionId, student, question, revision); if (e.Frozen is not null) { if (e.Frozen.ClientSubmissionId != clientSubmissionId || e.RetryAnswers is null || !e.RetryAnswers.SequenceEqual(answers)) throw new PbeProgressConflictException("The frozen response has another submission payload."); return e.Frozen; }
        e.RetryAnswers = [.. answers];
        var elapsed = Elapsed(e, ingress); if (elapsed > TimeSpan.FromSeconds(e.Schedule!.DurationSeconds) && e.Draft is { } draft) return e.Frozen = new(clientSubmissionId, draft.Answers, draft.ElapsedMs, draft.LockedAtUtc); var chosen = elapsed <= TimeSpan.FromSeconds(e.Schedule.DurationSeconds) ? answers : answers.Select(_ => "").ToArray(); return e.Frozen = new(clientSubmissionId, chosen, checked((long)elapsed.TotalMilliseconds), ingress!.ReceivedAtUtc);
    }
    private Entry Require(Guid session, Guid student, Guid question, int revision) { if (!entries.TryGetValue(session, out var e) || e.Student != student || e.Question != question || e.Revision != revision) throw new DomainException("This action is for another presentation revision."); return e; }
    private static TimeSpan Elapsed(Entry e, PbeSoloIngress? ingress) { if (ingress is null || e.Schedule is null) throw new DomainException("The response window has not opened."); try { return e.Clock.Elapsed(ingress.Stamp); } catch (InvalidOperationException) { throw new DomainException("The response window has not opened."); } }
    private PbeSoloTimingView View(Entry e) => new(e.Question, e.Revision, e.Delivery, [e.Student], e.Schedule is null ? [] : [e.Student], e.Schedule?.StartsAtUtc.ToUnixTimeMilliseconds(), e.Schedule is null ? null : e.Schedule.StartsAtUtc.AddSeconds(e.Schedule.DurationSeconds).ToUnixTimeMilliseconds(), e.Frozen is null ? e.Schedule is null ? "Presenting" : "Armed" : "Settled", time.GetUtcNow());
}
