using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    public async Task<object> Command(Guid org, Guid id, PracticeActor actor, PracticeCommand command, long ingress, CancellationToken ct)
    {
        // SQLite has one writer; queue here rather than blocking thread-pool threads in SQLite busy retries.
        using var writer = db.Database.IsSqlite() ? await runtime.EnterSqlite(ct) : null;
        await Check(actor, org, ct);
        using var lease = await runtime.Enter(id, ct);
        var row = await Load(org, id, ct);
        var room = PracticeJson.Read<PracticeRoom>(row.StateJson);
        if (!Member(room, actor) && !(actor.Admin && command.Action == "judge")) throw new PracticeForbiddenException();
        if (command.CommandId == Guid.Empty) throw new DomainException("A command ID is required.");
        if (room.AppliedCommands.TryGetValue(command.CommandId, out var previousActor))
        {
            if (previousActor != actor.Id) throw new PracticeForbiddenException();
            return View(room, actor);
        }
        if (command.Action != "submit" && Advance(room)) await Save(row, room, ct);
        // Scheduling and live chat are concurrent streams. Membership-changing commands require revisions.
        if (command.Action is "move" or "swap" or "remove" or "owner" or "start" or "captain" or "scribe" && command.Revision != room.Revision)
            throw new DomainException("The room changed. Refresh and try again.");
        var member = room.Members.SingleOrDefault(m => m.UserId == actor.Id);
        var target = room.Members.SingleOrDefault(m => m.UserId == command.TargetUserId);
        bool owner = room.OwnerId == actor.Id;
        void RequireOwner() { if (!owner) throw new PracticeForbiddenException(); }
        void RequireLobby() { if (room.Status != "Lobby") throw new DomainException("Teams are locked after the match starts."); }
        void RequirePlayer() { if (member is null) throw new PracticeForbiddenException(); }
        switch (command.Action)
        {
            case "join":
                RequireLobby();
                Join(room, actor, command.Team ?? 1);
                break;
            case "ready":
                RequireLobby(); RequirePlayer(); member!.Ready = !member.Ready;
                break;
            case "move":
                RequireLobby(); RequireOwner();
                if (target is null || command.Team is not (1 or 2)) throw new DomainException("Choose a player and team.");
                if (target.Team == command.Team) break;
                if (room.Members.Count(m => m.Team == command.Team) >= room.TeamSize) throw new DomainException("That team is full.");
                target.Team = command.Team.Value; target.Captain = false; target.Scribe = false;
                RepairRoles(room); ResetReady(room);
                break;
            case "remove":
                RequireLobby(); RequireOwner();
                if (target is null || target.UserId == room.OwnerId) throw new DomainException("Transfer ownership before removing the owner.");
                room.Members.Remove(target); RepairRoles(room); ResetReady(room);
                break;
            case "swap":
                RequireLobby(); RequireOwner();
                var other = room.Members.SingleOrDefault(m => m.UserId == command.OtherUserId);
                if (target is null || other is null || target.Team == other.Team) throw new DomainException("Choose one player from each team.");
                (target.Team, other.Team) = (other.Team, target.Team);
                target.Captain = false; target.Scribe = false; other.Captain = false; other.Scribe = false;
                RepairRoles(room); ResetReady(room);
                break;
            case "leave":
                RequireLobby(); RequirePlayer();
                if (owner) throw new DomainException("Transfer ownership or abandon the room before leaving.");
                room.Members.Remove(member!); RepairRoles(room); ResetReady(room);
                break;
            case "owner":
                RequireLobby(); RequireOwner();
                if (room.Coached || target is null) throw new DomainException("Select a player in an independent lobby.");
                room.OwnerId = target.UserId;
                break;
            case "captain":
            case "scribe":
                RequirePlayer();
                if (room.Status != "Lobby" && room.Phase is not ("Review" or "Break" or "Paused")) throw new DomainException("Change roles between questions.");
                if (!member!.Captain || target is null || target.Team != member.Team) throw new PracticeForbiddenException();
                foreach (var teammate in room.Members.Where(m => m.Team == member.Team))
                    if (command.Action == "captain") teammate.Captain = teammate == target; else teammate.Scribe = teammate == target;
                if (room.Status == "Lobby") ResetReady(room);
                break;
            case "invite":
                RequireLobby();
                if (command.TargetUserId is null || room.Members.Any(m => m.UserId == command.TargetUserId)) throw new DomainException("Select a player who is not already in the room.");
                if (command.Team.HasValue && command.Team is not (1 or 2)) throw new DomainException("Choose a valid team.");
                if (command.Team.HasValue && !owner && member?.Team != command.Team) throw new PracticeForbiddenException();
                if (!await db.Users.AnyAsync(u => u.Id == command.TargetUserId && u.IsActive && u.Kind == UserKind.Student
                    && db.OrganizationMembers.Any(m => m.UserId == u.Id && m.OrganizationId == org), ct)) throw new DomainException("Player not found in this organization.");
                if (room.Invitations.Count(i => i.UserId == command.TargetUserId && !i.Accepted && i.ExpiresAt > runtime.Now) > 0) throw new DomainException("That player already has a pending invitation.");
                room.Invitations.Add(new PracticeInvitation
                {
                    RoomId = id,
                    UserId = command.TargetUserId.Value,
                    Team = command.Team,
                    InviterName = actor.Name,
                    ExpiresAt = runtime.Now.AddHours(24)
                });
                break;
            case "start":
                RequireLobby(); RequireOwner();
                if (room.Members.Count != room.TeamSize * 2 || room.Members.Any(m => !m.Ready)) throw new DomainException("Both teams must be full and ready.");
                await SelectQuestions(org, room, ct);
                room.Status = "Playing"; room.ProcessId = runtime.ProcessId;
                Presentation(room);
                break;
            case "ack":
                RequirePlayer();
                if (room.Phase != "Scheduled" || command.ScheduleId != room.ScheduleId || !member!.Scribe) throw new DomainException("This start schedule is no longer awaiting your acknowledgement.");
                if (ingress >= room.ResponseTimestamp) { Schedule(room); break; }
                if (!room.Acknowledged.Contains(actor.Id)) room.Acknowledged.Add(actor.Id);
                break;
            case "draft":
                RequirePlayer(); RequireResponse(room, member!, ingress);
                if (command.QuestionId != Current(room).Id) throw new DomainException("This draft is for a different question.");
                if (room.Submissions.Any(s => s.QuestionId == Current(room).Id && s.Team == member!.Team)) throw new DomainException("This answer is already locked.");
                ValidateAnswers(room, command.Answers);
                room.Drafts[member!.Team] = command.Answers!;
                Contribute(room, actor.Id, true);
                break;
            case "submit":
                RequirePlayer();
                if (room.Status != "Playing" || room.Questions.Count == 0) throw new DomainException("There is no active question to submit.");
                if (room.ProcessId != runtime.ProcessId) { Advance(room); throw new DomainException("The interrupted question was voided. Refresh the room."); }
                if (command.QuestionId != Current(room).Id) throw new DomainException("This submission is for a different question.");
                var original = room.Submissions.FirstOrDefault(s => s.QuestionId == command.QuestionId && s.Team == member!.Team);
                if (original is not null && !original.DeadlineDraft) break;
                if (!member!.Scribe || room.Phase is not ("Scheduled" or "Response" or "Review")) throw new PracticeForbiddenException();
                if (room.Acknowledged.Count != 2 || ingress < room.ResponseTimestamp) throw new DomainException("The shared response window has not started.");
                ValidateAnswers(room, command.Answers);
                var elapsed = runtime.Elapsed(room.ResponseTimestamp, ingress);
                if (elapsed > TimeSpan.FromSeconds(Duration(Current(room))))
                {
                    if (original is null) AddSubmission(room, member.Team, actor.Id, room.Drafts.GetValueOrDefault(member.Team) ?? [],
                        TimeSpan.FromSeconds(Duration(Current(room))), true);
                    break;
                }
                if (original is not null)
                {
                    room.Submissions.Remove(original);
                }
                AddSubmission(room, member.Team, actor.Id, command.Answers!, elapsed, false);
                Contribute(room, actor.Id, true);
                Advance(room);
                break;
            case "chat":
                RequirePlayer();
                if (room.Status is "Completed" or "Abandoned") throw new DomainException("Discussion is closed.");
                if (string.IsNullOrWhiteSpace(command.Text) || command.Text.Length > 500) throw new DomainException("Messages must contain 1–500 characters.");
                if (room.Messages.Count(m => m.UserId == actor.Id && m.CreatedAt > runtime.Now.AddSeconds(-10)) >= 5) throw new DomainException("Please wait before sending another message.");
                room.Messages.Add(new PracticeMessage(Guid.NewGuid(), actor.Id, actor.Name, member!.Team, command.Text.Trim(), runtime.Now));
                if (room.Status == "Playing" && room.Phase == "Response") Contribute(room, actor.Id, false);
                break;
            case "next":
                if (!(room.Coached && room.CoachId == actor.Id && actor.Admin) && !(owner && room.Phase == "Paused")) throw new PracticeForbiddenException();
                if (room.Status != "Playing") throw new DomainException("The match is not playing.");
                if (room.Phase == "Review" && runtime.HasPending(room.Id)) throw new DomainException("An answer is still being processed. Please wait.");
                if (room.Phase == "Presentation") Schedule(room);
                else if (room.Phase is "Review" or "Break" or "Paused") Next(room);
                else throw new DomainException("Wait for this question to finish.");
                break;
            case "appeal":
                RequirePlayer();
                if (command.QuestionId is null || string.IsNullOrWhiteSpace(command.Text) || command.Text.Length > 500) throw new DomainException("Provide the question and a short reason.");
                var appeal = room.Submissions.SingleOrDefault(s => s.Team == member!.Team && s.QuestionId == command.QuestionId) ?? throw new DomainException("Answer not found.");
                if (room.Status != "Completed" && room.Phase != "Review") throw new DomainException("Appeal after answers are revealed.");
                if (appeal.Appealed) throw new DomainException("This answer has already been appealed.");
                appeal.Appealed = true; appeal.Resolved = false; appeal.AppealReason = command.Text;
                room.Awards.Clear();
                break;
            case "judge":
                if (!actor.Admin || room.Members.Any(m => m.UserId == actor.Id)) throw new PracticeForbiddenException();
                if (command.Team is not (1 or 2) || command.Points is null || string.IsNullOrWhiteSpace(command.Text)) throw new DomainException("Provide team, points, and a reason.");
                var judged = room.Submissions.SingleOrDefault(s => s.Team == command.Team && s.QuestionId == command.QuestionId) ?? throw new DomainException("Answer not found.");
                if (!judged.Appealed && (!room.Coached || room.Phase != "Review")) throw new DomainException("Only revealed coached answers or appeals can be judged.");
                var question = room.Questions.Single(q => q.Id == judged.QuestionId);
                if (command.Points < 0 || command.Points > Points(question)) throw new DomainException("Points exceed this question's rubric.");
                room.Adjustments.Add(new PracticeAdjustment(judged.QuestionId, judged.Team, actor.Id, judged.AccuracyHundredths / 100,
                    command.Points.Value, command.Text, runtime.Now));
                var corrected = PvpScoring.Score(command.Points.Value, Duration(question), TimeSpan.FromTicks(judged.ElapsedTicks), judged.DeadlineDraft);
                judged.AccuracyHundredths = corrected.AccuracyHundredths; judged.SpeedHundredths = corrected.SpeedHundredths; judged.Resolved = true;
                break;
            case "abandon":
                RequireOwner();
                if (room.Status is not ("Lobby" or "Playing")) throw new DomainException("A finalized match cannot be abandoned.");
                room.Status = "Abandoned"; room.Awards.Clear();
                break;
            default: throw new DomainException("Unknown room command.");
        }
        room.AppliedCommands[command.CommandId] = actor.Id;
        using var awards = room.Status == "Completed" ? await runtime.EnterAwards(org, ct) : null;
        if (room.Status == "Completed") await ReconcileAwards(org, room, ct);
        await Save(row, room, ct);
        return Member(room, actor) || actor.Admin && command.Action == "judge" ? View(room, actor) : new { left = true };
    }
    private async Task SelectQuestions(Guid org, PracticeRoom room, CancellationToken ct)
    {
        var records = await Questions.Where(q => q.OrganizationId == org && q.SeasonId == room.SeasonId && q.Published).ToListAsync(ct);
        var scope = await new Erudoza.Application.Content.CompetitionScopeResolver(db).ResolveAsync(org, room.SeasonId, ct);
        var sources = await db.SourceUnits.Where(s => (s.OrganizationId == org && s.ContentPack!.OrganizationId == org || s.OrganizationId == BuiltInLibrary.OrganizationId && s.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && s.ContentPack.IsBuiltIn) && scope.Contains(s.Id) && s.IsActive && !s.IsRetired && s.ContentPack!.IsActive).ToDictionaryAsync(s => s.Id, ct);
        var eligible = records.Where(r => IsLegacyQuestion(r.DefinitionJson)).GroupBy(r => r.QuestionKey).Select(g => g.MaxBy(q => q.Version)!)
            .Select(r => PracticeJson.Read<PracticeQuestion>(r.DefinitionJson))
            .Where(q => scope.Contains(q.SourceUnitId) && sources.TryGetValue(q.SourceUnitId, out var s)
                && q.ContentPackId == s.ContentPackId && (string.IsNullOrEmpty(room.BookKey) || s.BookKey == room.BookKey))
            .OrderBy(q => q.Id).ToList();
        // Both teams receive this same deterministic snapshot. True/false never exceeds 10%.
        var selected = new List<PracticeQuestion>();
        foreach (var q in eligible)
            if (q.Kind != "TrueFalse" || selected.Count(x => x.Kind == "TrueFalse") < room.QuestionCount / 10) selected.Add(q);
        if (selected.Count < room.QuestionCount) throw new DomainException($"This scope needs {room.QuestionCount} eligible published questions; {selected.Count} are available.");
        room.Questions = selected.Take(room.QuestionCount).ToList(); room.Reserves = selected.Skip(room.QuestionCount).ToList();
    }
    private static int Points(PracticeQuestion question) => question.Parts.Sum(p => p.Points);
    private static int Duration(PracticeQuestion question) => 20 + Points(question) * 5;
    private static PracticeQuestion Current(PracticeRoom room) => room.Questions[room.QuestionIndex];
    private static void ValidateAnswers(PracticeRoom room, string[]? answers)
    {
        if (answers is null || answers.Length > Current(room).Parts.Count || answers.Any(a => a is null || a.Length > 2000))
            throw new DomainException("Provide answers within the question's response fields.");
    }
    private void RequireResponse(PracticeRoom room, PracticeMember member, long ingress)
    {
        if (!member.Scribe || room.Phase != "Response" || ingress < room.ResponseTimestamp
            || runtime.Elapsed(room.ResponseTimestamp, ingress) > TimeSpan.FromSeconds(Duration(Current(room))))
            throw new DomainException("Only the scribe can edit during the response window.");
    }
    private static void Contribute(PracticeRoom room, Guid actor, bool scribe)
    {
        var contribution = new PracticeContribution(actor, Current(room).Id, scribe);
        if (!room.Contributions.Contains(contribution)) room.Contributions.Add(contribution);
    }
}
