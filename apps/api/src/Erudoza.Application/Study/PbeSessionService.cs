using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed class PbeSessionSnapshot
{
    public Guid Id { get; set; }
    public string Format { get; set; } = "Pbe";
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public string Mode { get; set; } = "Practice";
    public string Status { get; set; } = "Created";
    public string ScopeVersion { get; set; } = "";
    public string RuleVersion { get; set; } = PbeRules.RuleVersion;
    public string ScoringVersion { get; set; } = PbeRules.ScoringVersion;
    public string SelectionVersion { get; set; } = "pbe-selection-v1";
    public List<Guid> QuestionIds { get; set; } = [];
    public List<PbeSessionCard> Cards { get; set; } = [];
    public List<PbeSessionAttempt> Attempts { get; set; } = [];
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string? ClientStartId { get; set; }
    public string StartPayload { get; set; } = "";
    public string? MissionLocalDate { get; set; }
    public string? CreditedLocalDate { get; set; }
    public bool NewlyCreditedDay { get; set; }
}
public sealed class PbeSessionCard
{
    public Guid Id { get; set; }
    public PbeQuestion Question { get; set; } = new();
    public List<PbeTarget> Targets { get; set; } = [];
    public long? ServedAtMs { get; set; }
    public long? AssistedAtMs { get; set; }
}
public sealed record PbeSessionResult(Guid AttemptId, int EarnedPoints, int AvailablePoints, IReadOnlyList<string> ExpectedParts, string SourceEvidence, string Citation, bool Unaided, DateTimeOffset AcceptedAtUtc, long AcceptedSequence, bool AlreadyProcessed);
public sealed record PbeSessionAttempt(Guid Id, Guid CardId, string ClientSubmissionId, IReadOnlyList<string> Answers, bool HintsUsed, long AtMs, PbeSessionResult Result);
public sealed record PbeAnswerRequest(string ClientSubmissionId, Guid ChallengeCardId, IReadOnlyList<string> Answers, bool HintsUsed);
public sealed class PbeSessionUnavailableException(string code, string message) : Exception(message) { public string Code { get; } = code; }
public sealed class PbeSessionService(IErudozaDbContext db, ICurrentUser user, IClock clock, PbeSourceResolver resolver, IPbeQuestionBank bank, PbeProgressService progress, PbeEffortService effort)
{
    public Task<bool> ExistsAsync(Guid sessionId, CancellationToken ct) => db.PbeTrainingRecords.AnyAsync(r => r.OrganizationId == user.OrganizationId && r.OwnerId == user.UserId && r.Kind == "pbe-session" && r.Id == sessionId.ToString(), ct);
    internal static void Write(IErudozaDbContext db, Guid org, PbeSessionSnapshot s, string kind, string id, object value, PbeTrainingRecord? row = null)
    {
        if (row is null) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = s.SeasonId, OwnerId = s.StudentUserId, Kind = kind, Id = id, DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json) });
        else
        {
            row.DataJson = JsonSerializer.Serialize(value, PbeQuestionBank.Json);
            row.Revision++;
        }
    }
    static object SessionDto(PbeSessionSnapshot s) => new { s.Id, s.Format, s.SeasonId, s.Mode, s.Status, targetCardCount = s.Cards.Count, s.RuleVersion, s.ScoringVersion, s.SelectionVersion };
    static PbeQuestionView QuestionView(PbeQuestion q) => new(q.Id, q.Version, q.Prompt, q.Reference, q.Kind.ToString(), q.Parts.Select(p => p.Points).ToList(), q.Parts.Sum(p => p.Points), PbeRules.ResponseSeconds(q.Parts.Sum(p => p.Points)));
    static object CardDto(PbeSessionSnapshot s, PbeSessionCard c) => new { c.Id, sessionId = s.Id, format = "Pbe", sequence = s.Cards.IndexOf(c) + 1, total = s.Cards.Count, question = QuestionView(c.Question), assisted = c.AssistedAtMs.HasValue };
    public static IReadOnlyList<TrainingStepDto> Steps(PbeSessionSnapshot s) => [new(s.Mode, s.Cards.Count, s.Attempts.Count, s.Cards.Count == s.Attempts.Count ? "Complete" : "Active", s.Id)];
    internal static object Summary(PbeSessionSnapshot s)
    {
        var correct = s.Attempts.Count(a => a.Result.EarnedPoints == a.Result.AvailablePoints);
        return new { sessionId = s.Id, s.Format, s.Mode, attempted = s.Attempts.Count, correct, targetCardCount = s.Cards.Count, s.Status, earnedPoints = s.Attempts.Sum(a => a.Result.EarnedPoints), availablePoints = s.Attempts.Sum(a => a.Result.AvailablePoints), recap = new SessionRecapDto("pbe-daily-v2", s.Id, s.SeasonId, s.Mode, s.CompletedAtUtc, s.Attempts.Count, correct, s.Cards.Count, s.Attempts.Count == s.Cards.Count, s.NewlyCreditedDay, s.MissionLocalDate, s.CreditedLocalDate, Steps(s), [], []) };
    }
    async Task<PbeSourceScope> Eligible(PbeSessionSnapshot s, CancellationToken ct)
    {
        var scope = await resolver.ResolveSessionAsync(user.OrganizationId, s.Id, ct);
        if (!await db.CompetitionMembers.AnyAsync(m => m.OrganizationId == user.OrganizationId && m.SeasonId == s.SeasonId && m.UserId == user.UserId, ct) || !scope.Sources.Any() || PbeSourceResolver.Eligibility(s.SeasonId, s.StudentUserId, scope) != s.ScopeVersion) throw new PbeProgressConflictException("The assignment changed. Start a new PBE session.");
        return scope;
    }
    public Task<object> StartAsync(StartSessionRequest input, CancellationToken ct) => progress.ExecuteAsync<object>(async token =>
    {
        var mode = input.Mode.ToString();
        if (mode == "Simulation") throw new DomainException("Timed rehearsal is not enabled. Choose PBE practice.");
        if (mode is not ("Practice" or "Review") || input.SeasonId == Guid.Empty) throw new DomainException("Choose Practice or Review and an active season.");
        if (input.Training is { } training && (string.IsNullOrWhiteSpace(training.ClientStartId) || training.ClientStartId.Length > 200 || training.Step is not null && training.Step != mode)) throw new DomainException("Choose a matching training step and start ID.");
        if (input.Training is { } context && (context.MissionRevision is not null && context.MissionId is null || context.MissionId is not null && (context.MissionRevision != 1 || context.Step != mode))) throw new DomainException("Choose a matching mission revision and step.");
        var payload = JsonSerializer.Serialize(input, PbeQuestionBank.Json);
        var startKey = input.Training is null ? null : $"{user.UserId}:{input.SeasonId}:{Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(input.Training.ClientStartId)))}";
        if (input.Training is not null)
        {
            var startId = startKey;
            var startRow = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == user.OrganizationId && r.Kind == "pbe-session-start" && r.Id == startId, token);
            if (startRow is not null)
            {
                var sid = JsonDocument.Parse(startRow.DataJson).RootElement.GetProperty("sessionId").GetGuid();
                var existing = await db.PbeTrainingRecords.SingleAsync(r => r.OrganizationId == user.OrganizationId && r.OwnerId == user.UserId && r.Kind == "pbe-session" && r.Id == sid.ToString(), token);
                var saved = JsonSerializer.Deserialize<PbeSessionSnapshot>(existing.DataJson, PbeQuestionBank.Json)!;
                if (saved.StartPayload != payload) throw new PbeProgressConflictException("This start ID was already used with a different payload.");
                await Eligible(saved, token);
                return SessionDto(saved);
            }
        }
        var scope = await resolver.ResolveAsync(user.OrganizationId, input.SeasonId, user.UserId, token);
        if (!await db.CompetitionMembers.AnyAsync(m => m.OrganizationId == user.OrganizationId && m.SeasonId == input.SeasonId && m.UserId == user.UserId, token)) throw new UnauthorizedAccessException("Current season membership required.");
        if (input.Training?.MissionId is not null) throw new PbeProgressConflictException("Resume the saved session for this mission, or reload Training HQ.");
        var sources = scope.Sources;
        if (input.Chapter is { } chapter)
        {
            if (chapter.Chapter < 1 || chapter.ContentPackId == Guid.Empty) throw new DomainException("Choose a valid chapter.");
            sources = sources.Where(s => s.ContentPackId == chapter.ContentPackId && s.Chapter == chapter.Chapter).ToList();
        }
        var loaded = await ((PbeQuestionBank)bank).LoadResolvedAsync(new(user.OrganizationId, input.SeasonId, user.UserId, sources.Select(s => s.Id).ToList()), scope, true, token);
        var questions = loaded.Questions.ToList();
        if (input.TargetIds is { } targetIds)
        {
            if (!targetIds.Any() || targetIds.Any(id => !loaded.Targets.Any(t => t.Id == id))) throw new UnauthorizedAccessException("Choose assigned targets.");
            questions = questions.Where(q => q.Parts.Any(p => targetIds.Contains(p.TargetId))).ToList();
        }
        var now = DateTimeOffset.FromUnixTimeMilliseconds(clock.UtcNow.ToUnixTimeMilliseconds());
        var s = new PbeSessionSnapshot { Id = Guid.NewGuid(), StudentUserId = user.UserId, SeasonId = input.SeasonId, Mode = mode, ScopeVersion = PbeSourceResolver.Eligibility(input.SeasonId, user.UserId, scope), CreatedAtUtc = now, ClientStartId = input.Training?.ClientStartId, StartPayload = payload };
        var p = await progress.LoadAsync(user.OrganizationId, s.SeasonId, user.UserId, loaded.Targets.Select(t => t.Id).ToList(), questions.Select(q => q.Id).ToList(), token);
        var reviews = p.Reviews.ToDictionary(r => r.TargetId);
        var services = p.Questions.ToDictionary(q => q.SubjectId);
        var targets = p.Targets.ToDictionary(t => t.SubjectId);
        var groups = p.RecentTargets.Concat(p.Reviews.Where(r => r.Review.Unresolved && r.FailedSequence.HasValue).Select(r => new PbeRecentTarget(r.TargetId, r.FailedSequence!.Value))).GroupBy(r => r.AcceptedSequence).OrderBy(g => g.Key).Select(g => (IReadOnlyList<Guid>)g.Select(r => r.TargetId).Distinct().ToList()).ToList();
        var candidates = questions.Select(q =>
        {
            var ids = q.Parts.Select(p => p.TargetId).Distinct().ToList();
            var rs = ids.Where(reviews.ContainsKey).Select(id => reviews[id]).ToList();
            var failed = rs.Where(r => r.Review.Unresolved).ToList();
            var served = services.GetValueOrDefault(q.Id);
            return new PbeSelectionCandidate(q.Id, ids, q.SourceUnitIds, q.SourceKind.ToString(), q.Kind.ToString(), served?.ServedCount ?? 0, served?.LastServedAtMs, rs.Any(r => r.Review.Unresolved || r.Review.IntervalIndex >= 0 && r.Review.DueAtMs <= now.ToUnixTimeMilliseconds()), failed.Count > 0, ids.Min(id => targets.GetValueOrDefault(id)?.ServedCount ?? 0), rs.Any(r => r.LastAnsweredQuestionId == q.Id) ? q.Id : null, rs.Any(r => r.LastAnsweredQuestionKind is not null && r.LastAnsweredQuestionKind != q.Kind.ToString()), failed.Count > 0 && failed.All(r => p.RecentTargets.Count(t => t.TargetId != r.TargetId && t.AcceptedSequence > (r.FailedSequence ?? long.MaxValue)) >= 2), failed.Count > 0 ? failed.Select(r => r.TargetId).ToList() : null);
        }).ToList();
        s.QuestionIds = PbeSelectionRules.Select(new(s.Id, 8, mode, candidates, [], [], 0.1, groups)).ToList();
        if (s.QuestionIds.Count == 0) throw new PbeSessionUnavailableException(questions.Count > 0 && mode == "Review" ? "PBE_NOTHING_DUE" : "PBE_COVERAGE_UNAVAILABLE", questions.Count > 0 && mode == "Review" ? "No targets are due. Choose Practice." : "No eligible published questions are available. Ask your coach to prepare this scope, or choose Memory.");
        s.Cards = s.QuestionIds.Select(id =>
        {
            var q = questions.Single(q => q.Id == id);
            return new PbeSessionCard { Id = Guid.NewGuid(), Question = q, Targets = loaded.Targets.Where(t => q.Parts.Any(p => p.TargetId == t.Id)).ToList() };
        }).ToList();
        await effort.StartAsync(user.OrganizationId, s, input.Training?.TimeZone, token);
        Write(db, user.OrganizationId, s, "pbe-session", s.Id.ToString(), s);
        if (s.ClientStartId is not null) Write(db, user.OrganizationId, s, "pbe-session-start", startKey!, new { sessionId = s.Id, s.Format, s.RuleVersion, s.ScoringVersion, s.SelectionVersion });
        return SessionDto(s);
    }, ct);
    public Task<object> ActionAsync(Guid sessionId, string? action, JsonElement? input, CancellationToken ct) => progress.ExecuteAsync<object>(async token =>
    {
        var row = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == user.OrganizationId && r.OwnerId == user.UserId && r.Kind == "pbe-session" && r.Id == sessionId.ToString(), token) ?? throw new KeyNotFoundException("Study session was not found.");
        var s = JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!;
        if (action is null && s.Status == "Completed") return new { session = SessionDto(s), card = (object?)null, attempt = (object?)null, summary = Summary(s) };
        var scope = await Eligible(s, token);
        void Save() => Write(db, user.OrganizationId, s, "pbe-session", s.Id.ToString(), s, row);
        if (action == "attempts")
        {
            PbeAnswerRequest answer;
            try
            {
                if (input is null || !input.Value.TryGetProperty("hintsUsed", out _)) throw new JsonException();
                answer = input.Value.Deserialize<PbeAnswerRequest>(PbeQuestionBank.Json)!;
            }
            catch (JsonException) { throw new DomainException("Provide text answers and a hints indicator."); }
            if (answer.Answers is null || answer.Answers.Any(a => a is null || a.Length > 10000) || string.IsNullOrWhiteSpace(answer.ClientSubmissionId) || answer.ClientSubmissionId.Length > 200) throw new DomainException("Provide text answers and a submission ID.");
            var previous = s.Attempts.SingleOrDefault(a => a.ClientSubmissionId == answer.ClientSubmissionId);
            if (previous is not null)
            {
                if (previous.CardId != answer.ChallengeCardId || previous.HintsUsed != answer.HintsUsed || !previous.Answers.SequenceEqual(answer.Answers)) throw new PbeProgressConflictException("This submission ID was already used with a different answer payload.");
                return previous.Result with { AlreadyProcessed = true };
            }
            var card = s.Cards.ElementAtOrDefault(s.Attempts.Count);
            if (s.Status == "Completed" || card is null || card.Id != answer.ChallengeCardId || card.ServedAtMs is null) throw new PbeProgressConflictException("Answer the active saved card.");
            if (answer.Answers.Count != card.Question.Parts.Count) throw new DomainException("Provide one answer per requested part.");
            var atMs = clock.UtcNow.ToUnixTimeMilliseconds();
            var aid = Guid.NewGuid();
            var unaided = card.AssistedAtMs is null && !answer.HintsUsed;
            var grade = PbeRubric.Grade(card.Question, answer.Answers);
            var evidence = PbeReviewRules.Group(card.Question, card.Targets, answer.Answers, aid, atMs, unaided);
            var prepared = await progress.PrepareRecallEvidenceAsync(user.OrganizationId, s.SeasonId, user.UserId, s.ScopeVersion, evidence, token, card.Question.Kind.ToString());
            var result = new PbeSessionResult(aid, grade.EarnedPoints, grade.AvailablePoints, card.Question.Parts.Select(p => p.AcceptedAnswers[0]).ToList(), card.Question.Evidence, card.Question.Reference, unaided, DateTimeOffset.FromUnixTimeMilliseconds(atMs), prepared.AcceptedSequence!.Value, false);
            var attempt = new PbeSessionAttempt(aid, card.Id, answer.ClientSubmissionId, answer.Answers.ToList(), answer.HintsUsed, atMs, result);
            s.Attempts.Add(attempt);
            s.Status = "Active";
            await effort.ApplyAsync(user.OrganizationId, s, result.AcceptedAtUtc, token);
            Write(db, user.OrganizationId, s, "pbe-attempt", aid.ToString(), new { attempt.Id, attempt.CardId, attempt.ClientSubmissionId, attempt.Answers, attempt.HintsUsed, attempt.AtMs, attempt.Result, sessionId = s.Id, s.Format, s.RuleVersion, s.ScoringVersion, s.SelectionVersion });
            Save();
            return result;
        }
        if (action == "complete")
        {
            if (!s.Attempts.Any()) throw new DomainException("A session cannot be completed without an accepted answer.");
            if (s.Status != "Completed")
            {
                s.Status = "Completed";
                s.CompletedAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(clock.UtcNow.ToUnixTimeMilliseconds());
                Save();
            }
            return Summary(s);
        }
        if (action == "source")
        {
            var card = s.Cards.ElementAtOrDefault(s.Attempts.Count);
            if (s.Status == "Completed" || card is null || card.ServedAtMs is null || input is null || !input.Value.TryGetProperty("challengeCardId", out var cid) || !cid.TryGetGuid(out var requested) || requested != card.Id) throw new PbeProgressConflictException("Choose the active saved card.");
            if (s.Mode != "Practice") throw new DomainException("Source assistance is available in Practice.");
            if (card.AssistedAtMs is null)
            {
                card.AssistedAtMs = clock.UtcNow.ToUnixTimeMilliseconds();
                Save();
            }
            return new { challengeCardId = card.Id, assisted = true, sources = card.Question.SourceUnitIds.Select(id => scope.Sources.Single(s => s.Id == id)).Select(s => new { s.Id, s.ContentPackId, s.SourceKind, s.BookKey, s.Chapter, s.Verse, s.Ordinal, citation = s.CitationLabel, s.CanonicalText }) };
        }
        if (action == "next")
        {
            var card = s.Cards.ElementAtOrDefault(s.Attempts.Count);
            if (s.Status == "Completed" || card is null) throw new DomainException("The session target has been reached.");
            if (card.ServedAtMs is null)
            {
                card.ServedAtMs = clock.UtcNow.ToUnixTimeMilliseconds();
                s.Status = "Active";
                await progress.PrepareServiceAsync(user.OrganizationId, s.SeasonId, user.UserId, new(card.Id, card.Question.Id, card.Targets.Select(t => t.Id).ToList(), card.Question.Kind.ToString(), card.ServedAtMs.Value), token);
                Save();
            }
            return CardDto(s, card);
        }
        var shown = s.Cards.LastOrDefault(c => c.ServedAtMs.HasValue);
        var accepted = shown is null ? null : s.Attempts.SingleOrDefault(a => a.CardId == shown.Id);
        return new { session = SessionDto(s), card = shown is null ? null : CardDto(s, shown), attempt = accepted is null ? null : accepted.Result with { AlreadyProcessed = true }, summary = (object?)null };
    }, ct);
}
