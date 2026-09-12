using System.Data;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Api.Practice;

public sealed class PbeDisputeService(ErudozaDbContext db, ICurrentUser user, PracticeService practice, PracticeRuntime runtime, PbeEvidenceReplayService evidence)
{
    PracticeActor Actor => PracticeEndpoints.Actor(user);
    bool Coach(PbeDispute d) => user.Kind == UserKind.Adult && user.IsAdmin && !d.AllParticipantIds.Contains(user.UserId);
    static string Reason(string? reason) => string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 500 ? throw new DomainException("Provide a review reason of at most 500 characters.") : reason.Trim();
    public static object Dto(PbeDispute d) => new { d.Id, d.OrganizationId, d.SeasonId, d.Activity, d.SessionId, d.AttemptId, d.QuestionId, d.QuestionVersion, d.Team, d.Status, d.Reason, d.Revision, d.PartPoints, d.SourceEvidence, d.Question, d.Answers, d.OriginalPointsByPart, d.AcceptedAtUtc, d.Resolution };
    IQueryable<PbeTrainingRecord> Rows(string kind) => db.PbeTrainingRecords.Where(r => r.OrganizationId == user.OrganizationId && r.Kind == kind);
    async Task<PbeTrainingRecord> Required(string kind, string id, CancellationToken ct) => await Rows(kind).SingleOrDefaultAsync(r => r.Id == id, ct) ?? throw new KeyNotFoundException("Saved answer was not found.");
    async Task Gate(string activity, CancellationToken ct) { await practice.Check(Actor, user.OrganizationId, ct, false); if (activity == "Team" && !await practice.DisputeTeamEnabled(user.OrganizationId, ct)) throw new PracticeForbiddenException(); }
    void Add(string kind, string id, PbeDispute d, object data) => db.PbeTrainingRecords.Add(new() { Kind = kind, Id = id, OrganizationId = user.OrganizationId, SeasonId = d.SeasonId, OwnerId = d.ParticipantIds[0], DataJson = JsonSerializer.Serialize(data, PbeQuestionBank.Json) });
    async Task Overlay(PbeDispute d, CancellationToken ct)
    {
        var id = $"{d.Activity}:{d.SessionId}"; var row = await Rows("pbe-result-overlay").SingleOrDefaultAsync(r => r.Id == id, ct);
        var overlay = row is null ? new PbeResultOverlay(id, d.Activity, d.SessionId, []) : JsonSerializer.Deserialize<PbeResultOverlay>(row.DataJson, PbeQuestionBank.Json)!;
        overlay.Entries[d.AttemptId] = new(d.Id, d.Status, d.Revision, d.QuestionId, d.QuestionVersion, d.Resolution?.PointsByPart);
        if (row is null) Add("pbe-result-overlay", id, d, overlay); else { row.DataJson = JsonSerializer.Serialize(overlay, PbeQuestionBank.Json); row.Revision++; }
    }
    public async Task<(PbeDispute Value, bool Created)> Flag(PbeDisputeFlag input, CancellationToken ct)
    {
        if (input.Activity is not ("Solo" or "Team") || !Guid.TryParse(input.SessionId, out var sessionId) || string.IsNullOrWhiteSpace(input.AttemptId) || input.AttemptId.Length > 150) throw new DomainException("Choose a saved Solo or Team result.");
        await Gate(input.Activity, ct); if (!user.IsStudent || user.Kind != UserKind.Student) throw new PracticeForbiddenException();
        var reason = Reason(input.Reason); var attemptId = input.AttemptId.ToLowerInvariant(); PbeFrozenAttempt frozen;
        if (input.Activity == "Team") frozen = await practice.DisputeAttempt(user.OrganizationId, sessionId, attemptId, Actor, ct);
        else
        {
            var session = JsonSerializer.Deserialize<PbeSessionSnapshot>((await Required("pbe-session", sessionId.ToString(), ct)).DataJson, PbeQuestionBank.Json)!;
            if (session.StudentUserId != user.UserId) throw new PracticeForbiddenException();
            var attempt = session.Attempts.SingleOrDefault(a => a.Result.AttemptId.ToString() == attemptId) ?? throw new KeyNotFoundException("Saved answer was not found.");
            if (session.Mode == "Simulation" && session.Status is not ("Completed" or "Interrupted")) throw new PbeBankConflictException("Finish the rehearsal before reviewing answers.");
            var card = session.Cards.Single(c => c.Id == attempt.CardId);
            frozen = new(session.Id, session.SeasonId, attemptId, null, card.Question, attempt.Answers.ToArray(), attempt.Result.AcceptedAtUtc, [session.StudentUserId], [session.StudentUserId]);
        }
        if (!frozen.ParticipantIds.Contains(user.UserId)) throw new PracticeForbiddenException();
        var id = $"{input.Activity}:{sessionId}:{attemptId}";
        using var writer = db.Database.IsSqlite() ? await runtime.EnterSqlite(ct) : null; using var gate = await runtime.Enter(sessionId, ct);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var prior = await Rows("pbe-dispute").SingleOrDefaultAsync(r => r.Id == id, ct);
        if (prior is not null) { var old = JsonSerializer.Deserialize<PbeDispute>(prior.DataJson, PbeQuestionBank.Json)!; if (old.Reason != reason) throw new PbeBankConflictException("This answer already has another review request."); return (old, false); }
        var d = new PbeDispute(id, user.OrganizationId, frozen.SeasonId, input.Activity, sessionId.ToString(), attemptId, frozen.Question.Id, frozen.Question.Version, frozen.Team, "Pending", reason, 1, frozen.Question.Parts.Select(p => p.Points).ToArray(), frozen.Question.Evidence, frozen.Question, frozen.Answers, PbeRubric.Grade(frozen.Question, frozen.Answers).Parts.Select(p => p.EarnedPoints).ToArray(), frozen.AcceptedAtUtc, frozen.ParticipantIds, frozen.AllParticipantIds, null);
        await Gate(d.Activity, ct); await Overlay(d, ct); await evidence.StageDispute(d, ct); Add("pbe-dispute", id, d, d); Add("pbe-dispute-pending", id, d, d); await db.SaveChangesAsync(ct); if (d.Activity == "Team") await practice.ReconcileReviewedAwards(user.OrganizationId, d.SeasonId, ct); await transaction.CommitAsync(ct); return (d, true);
    }
    public async Task<PbeDispute> Read(string id, CancellationToken ct)
    {
        var d = JsonSerializer.Deserialize<PbeDispute>((await Required("pbe-dispute", id, ct)).DataJson, PbeQuestionBank.Json)!; await Gate(d.Activity, ct);
        if (!Coach(d) && !d.ParticipantIds.Contains(user.UserId)) throw new PracticeForbiddenException(); return d;
    }
    public async Task<object> Replay(string id, CancellationToken ct) { var d = await Read(id, ct); using var writer = db.Database.IsSqlite() ? await runtime.EnterSqlite(ct) : null; return await evidence.Continue(d, ct); }
    public async Task<object> Evidence(string id, Guid targetId, string? after, CancellationToken ct) => await evidence.Page(await Read(id, ct), targetId, after, ct);
    public async Task<object> Queue(string? after, CancellationToken ct)
    {
        await Gate("Solo", ct); if (user.Kind != UserKind.Adult || !user.IsAdmin) throw new PracticeForbiddenException();
        if (after?.Length > 200) throw new DomainException("Invalid cursor.");
        var enabled = await practice.DisputeTeamEnabled(user.OrganizationId, ct); var query = Rows("pbe-dispute-pending").AsNoTracking();
        if (!enabled) query = query.Where(r => r.Id.StartsWith("Solo:")); if (!string.IsNullOrEmpty(after)) query = query.Where(r => string.Compare(r.Id, after) > 0);
        var rows = await query.OrderBy(r => r.Id).Take(51).ToListAsync(ct); var page = rows.Take(50).ToList();
        return new { items = page.Select(r => JsonSerializer.Deserialize<PbeDispute>(r.DataJson, PbeQuestionBank.Json)!).Where(Coach).Select(Dto), nextCursor = rows.Count > 50 ? page[^1].Id : null };
    }
    public async Task<PbeDispute> Resolve(string id, PbeDisputeResolve input, CancellationToken ct)
    {
        var reason = Reason(input.Reason); using var writer = db.Database.IsSqlite() ? await runtime.EnterSqlite(ct) : null;
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var row = await Required("pbe-dispute", id, ct); var d = JsonSerializer.Deserialize<PbeDispute>(row.DataJson, PbeQuestionBank.Json)!; await Gate(d.Activity, ct); if (!Coach(d)) throw new PracticeForbiddenException();
        if (input.PointsByPart is null || input.PointsByPart.Length != d.PartPoints.Length || input.PointsByPart.Where((p, i) => p < 0 || p > d.PartPoints[i]).Any()) throw new DomainException("Use whole points within each frozen rubric part.");
        if (d.Status == "Resolved") { if (input.ExpectedRevision == d.Revision - 1 && d.Resolution!.ResolvedBy == user.UserId && d.Resolution.Reason == reason && d.Resolution.PointsByPart.SequenceEqual(input.PointsByPart)) return d; throw new PbeBankConflictException("This review already has another ruling."); }
        if (input.ExpectedRevision != d.Revision) throw new PbeBankConflictException("The review changed. Refresh and retry.");
        var final = d with { Revision = d.Revision + 1, Status = "Resolved", Resolution = new(input.PointsByPart, reason, user.UserId, runtime.Now) };
        await Overlay(final, ct); await evidence.StageDispute(final, ct);
        row.DataJson = JsonSerializer.Serialize(final, PbeQuestionBank.Json); row.Revision++;
        Add("pbe-grade-adjustment", $"{d.Id}:{final.Revision}", d, new { id = $"{d.Id}:{final.Revision}", disputeId = d.Id, d.Activity, d.SessionId, d.AttemptId, d.QuestionId, d.QuestionVersion, d.Team, input.PointsByPart, reason, resolvedBy = user.UserId, resolvedAtUtc = final.Resolution.ResolvedAtUtc, originalAcceptedAtUtc = d.AcceptedAtUtc });
        db.PbeTrainingRecords.Remove(await Required("pbe-dispute-pending", id, ct)); await db.SaveChangesAsync(ct); if (d.Activity == "Team") await practice.ReconcileReviewedAwards(user.OrganizationId, d.SeasonId, ct); await transaction.CommitAsync(ct); return final;
    }
}
public sealed partial class PracticeService
{
    public Task<bool> DisputeTeamEnabled(Guid org, CancellationToken ct) => Enabled(org, ct);
    public static string TeamAttemptId(PracticeRoom r, PracticeSubmission s) => s.AttemptId != Guid.Empty ? s.AttemptId.ToString() : $"team:{r.Id}:{s.QuestionId}:{s.Team}";
    private static bool ReviewedQuestion(PracticeRoom room, Guid questionId) { var index = room.Questions.FindIndex(q => q.Id == questionId); return index >= 0 && (room.Status == "Completed" || !IsPbe(room) && room.Status == "Interrupted" || index < room.QuestionIndex || index == room.QuestionIndex && room.Phase == "Review"); }
    public async Task<PbeFrozenAttempt> DisputeAttempt(Guid org, Guid roomId, string attemptId, PracticeActor actor, CancellationToken ct)
    {
        await Check(actor, org, ct); using var lease = await runtime.Enter(roomId, ct);
        var record = await Rooms.AsNoTracking().SingleOrDefaultAsync(r => r.OrganizationId == org && r.Id == roomId, ct) ?? throw new KeyNotFoundException("Room not found."); var room = PracticeJson.Read<PracticeRoom>(record.StateJson);
        if (!IsPbe(room)) throw new DomainException("Choose a PBE result."); var member = room.Members.SingleOrDefault(m => m.UserId == actor.Id); var coach = actor.Admin && member is null;
        if (member is null && !coach) throw new PracticeForbiddenException(); var s = room.Submissions.SingleOrDefault(s => TeamAttemptId(room, s) == attemptId) ?? throw new KeyNotFoundException("Saved answer was not found.");
        if (!coach && member?.Team != s.Team) throw new PracticeForbiddenException();
        if (room.Status is "Lobby" or "Playing") { await AuthorizePbeRoom(org, room, ct); if (!ReviewedQuestion(room, s.QuestionId)) throw new PbeBankConflictException("Wait for answer review."); }
        var q = room.Questions.Single(q => q.Id == s.QuestionId).Rubric ?? throw new DomainException("The saved rubric is unavailable.");
        return new(room.Id, room.SeasonId, TeamAttemptId(room, s), s.Team, q, s.Answers, s.ResponseLockedAtUtc ?? room.Presentations.GetValueOrDefault(s.QuestionId)?.ResponseEndsAtUtc ?? DateTimeOffset.UnixEpoch, room.Members.Where(m => m.Team == s.Team).Select(m => m.UserId).ToArray(), room.Members.Select(m => m.UserId).ToArray());
    }
}
