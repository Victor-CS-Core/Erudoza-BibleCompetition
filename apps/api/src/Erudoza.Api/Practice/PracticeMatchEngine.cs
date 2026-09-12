using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    private void Phase(PracticeRoom room, string phase, int seconds)
    {
        PracticeMetrics.PhaseTransitions.Add(1, new KeyValuePair<string, object?>("phase", phase));
        room.Phase = phase; room.PhaseTimestamp = runtime.Stamp();
        room.PhaseEndsAt = runtime.Now.AddSeconds(seconds);
    }
    private void Presentation(PracticeRoom room)
    {
        if (IsPbe(room)) { var q = Current(room).Rubric!; if (!room.Services.Any(s => s.QuestionId == q.Id)) room.Services.Add(new PbeRoomService(Guid.NewGuid(), q.Id, q.Kind.ToString(), q.Parts.Select(p => p.TargetId).Distinct().ToArray(), room.Members.Select(m => m.UserId).ToArray(), runtime.Now.ToUnixTimeMilliseconds())); }
        room.CoachReading = null; room.CoachReadyScribeIds.Clear(); room.Drafts.Clear(); room.DraftReceivedAt.Clear(); room.PresentationDelivery.Clear(); room.Acknowledged.Clear(); room.ResponseStartsAt = null;
        Phase(room, "Presentation", 15);
        if (room.Coached || IsPbe(room)) room.PhaseEndsAt = null;
    }
    private void Schedule(PracticeRoom room)
    {
        if (room.Phase == "Scheduled") PracticeMetrics.RescheduledStarts.Add(1);
        Phase(room, "Scheduled", 3);
        room.ScheduleId = Guid.NewGuid(); room.Acknowledged.Clear();
        room.ResponseTimestamp = runtime.After(room.PhaseTimestamp, TimeSpan.FromSeconds(3));
        room.ResponseStartsAt = room.PhaseEndsAt;
        if (IsPbe(room)) room.Presentations[Current(room).Id] = new(room.ScheduleId, room.ResponseStartsAt!.Value, room.ResponseStartsAt.Value.AddSeconds(Duration(Current(room))), new(room.PresentationDelivery), room.CoachReading);
    }
    private void Next(PracticeRoom room)
    {
        if (room.Phase == "Paused") { Presentation(room); return; }
        if (room.Phase == "Break") { Presentation(room); return; }
        room.QuestionIndex++;
        if (room.QuestionIndex >= room.QuestionCount)
        {
            room.QuestionIndex = room.QuestionCount - 1; room.Status = "Completed"; room.CompletedAt = runtime.Now;
            room.PhaseEndsAt = null; return;
        }
        if (room.QuestionCount == 90 && room.QuestionIndex == 45) Phase(room, "Break", 300);
        else Presentation(room);
    }
    private bool Advance(PracticeRoom room, IReadOnlySet<Guid>? eligibleReserveIds = null)
    {
        var removed = room.Messages.RemoveAll(m => m.CreatedAt < runtime.Now.AddDays(-30)) > 0;
        if (room.Status != "Playing") return removed;
        if (room.ProcessId != runtime.ProcessId)
        {
            PracticeMetrics.Restarts.Add(1);
            room.ProcessId = runtime.ProcessId;
            if (IsPbe(room) && room.Phase is "Scheduled" or "Response")
            {
                foreach (var team in ActiveTeams(room)) if (!room.Submissions.Any(s => s.QuestionId == Current(room).Id && s.Team == team))
                {
                    if (room.DraftReceivedAt.TryGetValue(team, out var received) && received >= room.ResponseTimestamp && runtime.Elapsed(room.ResponseTimestamp, received) <= TimeSpan.FromSeconds(Duration(Current(room)))) AddSubmission(room, team, room.Members.Single(m => m.Team == team && m.Scribe).UserId, room.Drafts[team], runtime.Elapsed(room.ResponseTimestamp, received), true);
                    else { room.Status = "Interrupted"; room.Phase = "Interrupted"; room.InterruptionReason = "ArmedResponsesUntrusted"; room.PhaseEndsAt = null; return true; }
                }
                Phase(room, "Review", 10); if (room.Coached) room.PhaseEndsAt = null; return true;
            }
            if (room.Phase is "Scheduled" or "Response" or "Presentation")
            {
                var interruptedId = Current(room).Id;
                room.Submissions.RemoveAll(s => s.QuestionId == interruptedId);
                room.Contributions.RemoveAll(c => c.QuestionId == interruptedId);
                var replacement = IsPbe(room) ? room.Reserves.FindIndex(q => (eligibleReserveIds is null || eligibleReserveIds.Contains(q.Id)) && ValidPbeSet(room.Questions.Select((old, i) => i == room.QuestionIndex ? q.Rubric! : old.Rubric!), room.QuestionCount)) : 0;
                if (room.Reserves.Count == 0 || replacement < 0) { room.Status = IsPbe(room) ? "Interrupted" : "Abandoned"; if (IsPbe(room)) { room.Phase = "Interrupted"; room.InterruptionReason = "UnarmedReserveUnavailable"; room.PhaseEndsAt = null; } room.Awards.Clear(); return true; }
                if (IsPbe(room)) room.Replacements.Add(new(Current(room), room.Reserves[replacement].Id, runtime.Now, "runtime-replacement"));
                room.Questions[room.QuestionIndex] = room.Reserves[replacement]; room.Reserves.RemoveAt(replacement);
                room.Drafts.Clear(); room.Acknowledged.Clear(); room.Phase = "Paused"; room.PhaseEndsAt = null;
            }
            else { room.PhaseTimestamp = runtime.Stamp(); room.PhaseEndsAt = runtime.Now.AddSeconds(room.Phase == "Break" ? 300 : 10); }
            return true;
        }
        var elapsed = runtime.Elapsed(room.PhaseTimestamp, runtime.Stamp());
        switch (room.Phase)
        {
            case "Presentation" when !IsPbe(room) && !room.Coached && elapsed >= TimeSpan.FromSeconds(15): Schedule(room); return true;
            case "Scheduled" when runtime.Stamp() >= room.ResponseTimestamp:
                var scribes = room.Members.Where(m => m.Scribe).Select(m => m.UserId).ToHashSet();
                if (scribes.Count != ActiveTeams(room).Length || !scribes.SetEquals(room.Acknowledged))
                {
                    if (runtime.HasPending(room.Id)) return removed;
                    Schedule(room); return true;
                }
                room.Phase = "Response"; room.PhaseTimestamp = room.ResponseTimestamp;
                room.PhaseEndsAt = room.ResponseStartsAt!.Value.AddSeconds(Duration(Current(room))); return true;
            case "Response":
                if (runtime.HasPending(room.Id)) return removed;
                var question = Current(room);
                bool expired = IsPbe(room) ? runtime.Elapsed(room.ResponseTimestamp, runtime.Stamp()) > TimeSpan.FromSeconds(Duration(question)) : runtime.Elapsed(room.ResponseTimestamp, runtime.Stamp()) >= TimeSpan.FromSeconds(Duration(question));
                if (expired)
                {
                    foreach (var team in ActiveTeams(room))
                    {
                        if (room.Submissions.Any(s => s.QuestionId == question.Id && s.Team == team)) continue;
                        var scribe = room.Members.Single(m => m.Team == team && m.Scribe);
                        AddSubmission(room, team, scribe.UserId, room.Drafts.GetValueOrDefault(team) ?? [], TimeSpan.FromSeconds(Duration(question)), true);
                    }
                }
                if (room.Submissions.Count(s => s.QuestionId == question.Id) == ActiveTeams(room).Length)
                {
                    Phase(room, "Review", 10); if (room.Coached) room.PhaseEndsAt = null;
                    return true;
                }
                return removed;
            case "Review" when !room.Coached && elapsed >= TimeSpan.FromSeconds(10) && !runtime.HasPending(room.Id): Next(room); return true;
            case "Break" when elapsed >= TimeSpan.FromSeconds(300): Next(room); return true;
            default: return removed;
        }
    }
    private static void AddSubmission(PracticeRoom room, int team, Guid scribe, string[] answers, TimeSpan elapsed, bool deadlineDraft)
    {
        var question = Current(room);
        if (IsPbe(room) && (room.ScoringVersion != "pbe-accuracy-v1" || question.Rubric?.SchemaVersion != 2)) throw new DomainException("The saved PBE scoring snapshot is invalid.");
        var earned = IsPbe(room) ? PbeRubric.Grade(question.Rubric ?? throw new DomainException("Missing saved PBE rubric."), question.Parts.Select((_, i) => i < answers.Length ? answers[i] : "").ToArray()).EarnedPoints : PbeQuestionEvaluator.Evaluate(question, answers);
        var score = PvpScoring.Score(earned, Duration(question), elapsed, deadlineDraft);
        room.Submissions.Add(new PracticeSubmission
        {
            AttemptId = IsPbe(room) ? Guid.NewGuid() : Guid.Empty,
            ResponseLockedAtUtc = IsPbe(room) ? room.ResponseStartsAt?.Add(elapsed) : null,
            QuestionId = question.Id,
            Team = team,
            ScribeId = scribe,
            Answers = answers,
            ElapsedTicks = elapsed.Ticks,
            DeadlineDraft = deadlineDraft,
            AccuracyHundredths = IsPbe(room) ? PbePresentationRules.RehearsalPoints(earned, elapsed.TotalMilliseconds, Points(question)) * 100 : score.AccuracyHundredths,
            SpeedHundredths = IsPbe(room) ? 0 : score.SpeedHundredths
        });
    }
    private object View(PracticeRoom room, PracticeActor actor, bool materialUnavailable = false)
    {
        var member = room.Members.FirstOrDefault(m => m.UserId == actor.Id);
        bool coach = member is null && actor.Admin && (room.OwnerId == actor.Id || room.CoachId == actor.Id || room.Submissions.Any(s => s.Appealed));
        var visibleSubmissions = room.Submissions.Where(s => ReviewedQuestion(room, s.QuestionId) || IsPbe(room) && (room.Status is "Interrupted" or "Abandoned") && (coach || s.Team == member?.Team)).ToList();
        var current = room.Status is "Playing" or "Completed" or "Interrupted" && room.Questions.Count > 0 ? Current(room) : null;
        return new
        {
            materialUnavailable,
            room.Id,
            room.SeasonId,
            room.OwnerId,
            room.CoachId,
            format = room.Format ?? "Arcade",
            teamCount = ActiveTeams(room).Length,
            room.TeamSize,
            room.QuestionCount,
            room.Coached,
            room.Revision,
            room.Status,
            room.InterruptionReason,
            room.Phase,
            room.QuestionIndex,
            room.PhaseEndsAt,
            room.ResponseStartsAt,
            room.ScheduleId,
            presentationDelivery = room.PresentationDelivery,
            coachReading = room.CoachReading,
            coachReadyScribeIds = room.CoachReadyScribeIds,
            serverNow = runtime.Now,
            members = room.Members,
            isCoach = coach,
            room.RuleVersion,
            room.ScoringVersion,
            question = materialUnavailable || current is null || IsPbe(room) && room.Phase is "Paused" or "Break" ? null : new { current.Id, current.Prompt, current.Reference, current.Kind, partCount = current.Parts.Count, points = Points(current), durationSeconds = Duration(current) },
            draft = materialUnavailable || member is null ? [] : room.Drafts.GetValueOrDefault(member.Team) ?? [],
            submitted = member is not null && current is not null && room.Submissions.Any(s => s.QuestionId == current.Id && s.Team == member.Team),
            messages = room.Messages.Where(m => !materialUnavailable).Where(m => m.CreatedAt >= runtime.Now.AddDays(-30) && (coach || m.Team == member?.Team)),
            scores = ActiveTeams(room).Select(team => new
            {
                team,
                accuracyHundredths = visibleSubmissions.Where(s => s.Team == team).Sum(s => s.AccuracyHundredths),
                speedHundredths = visibleSubmissions.Where(s => s.Team == team).Sum(s => s.SpeedHundredths),
                availableHundredths = visibleSubmissions.Where(s => s.Team == team).Sum(s => Points(room.Questions.Single(q => q.Id == s.QuestionId)) * 100),
                totalHundredths = visibleSubmissions.Where(s => s.Team == team).Sum(s => s.AccuracyHundredths + s.SpeedHundredths)
            }),
            results = visibleSubmissions.Where(_ => !materialUnavailable).Select(s =>
            {
                var q = room.Questions.Single(q => q.Id == s.QuestionId);
                return new
                {
                    attemptId = IsPbe(room) ? TeamAttemptId(room, s) : null,
                    s.Dispute,
                    s.OriginalAccuracyHundredths,
                    s.QuestionId,
                    q.Prompt,
                    q.Reference,
                    q.Evidence,
                    acceptedAnswers = q.Parts.Select(p => p.AcceptedAnswers),
                    s.Team,
                    s.Answers,
                    s.AccuracyHundredths,
                    s.SpeedHundredths,
                    elapsedMs = TimeSpan.FromTicks(s.ElapsedTicks).TotalMilliseconds,
                    s.Appealed,
                    s.Resolved,
                    s.AppealReason,
                    s.DeadlineDraft,
                    availableHundredths = Points(q) * 100
                };
            }),
            achievements = room.Awards.Where(a => a.UserId == actor.Id),
            pendingCount = visibleSubmissions.Count(s => s.Dispute?.Status == "Pending"),
            provisional = (IsPbe(room) ? visibleSubmissions : room.Submissions).Any(s => !s.Resolved),
            contributions = room.Contributions.Where(c => coach || c.UserId == actor.Id),
            timingDiagnostics = room.TimingDiagnostics.Where(d => coach || d.Key == actor.Id).ToDictionary(d => d.Key, d => d.Value)
        };
    }
    public async Task<List<(Guid OrganizationId, Guid RoomId)>> Tick(CancellationToken ct)
    {
        var changed = new List<(Guid OrganizationId, Guid RoomId)>();
        if (runtime.ShouldPrune()) await PruneMessages(ct);
        var pendingExposure = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.Kind == "pbe-room-service-outbox").Select(r => new { r.OrganizationId, r.Id }).Take(100).ToListAsync(ct);
        foreach (var pending in pendingExposure) if (Guid.TryParse(pending.Id, out var roomId)) await ProjectRoomExposure(pending.OrganizationId, roomId, ct);
        var ids = await Rooms.Where(r => r.Status == "Playing").Select(r => new { r.Id, r.OrganizationId }).ToListAsync(ct);
        foreach (var id in ids)
        {
            using var lease = await runtime.Enter(id.Id, ct);
            var row = await Load(id.OrganizationId, id.Id, ct);
            var room = PracticeJson.Read<PracticeRoom>(row.StateJson);
            IReadOnlySet<Guid>? eligibleReserves = null;
            if (IsPbe(room)) { try { eligibleReserves = EligiblePbeReserves(room, await AuthorizePbeRoom(id.OrganizationId, room, ct)); } catch (PracticeForbiddenException) { continue; } catch (DomainException) { continue; } }
            if (!Advance(room, eligibleReserves)) continue;
            using var awards = room.Status == "Completed" ? await runtime.EnterAwards(id.OrganizationId, ct) : null;
            if (room.Status == "Completed") await ReconcileAwards(id.OrganizationId, room, ct);
            await Save(row, room, ct);
            changed.Add((id.OrganizationId, id.Id));
        }
        return changed;
    }
    private async Task ReconcileAwards(Guid org, PracticeRoom room, CancellationToken ct, bool issueMastery = true)
    {
        var all = (await Rooms.Where(r => r.OrganizationId == org && r.SeasonId == room.SeasonId && r.Status == "Completed").AsNoTracking().ToListAsync(ct))
            .Where(r => r.Id != room.Id).Select(r => PracticeJson.Read<PracticeRoom>(r.StateJson)).Append(room).ToList();
        room.Awards = CalculateAwards(await OverlayRooms(org, all, ct)).ToList();
        if (issueMastery) await RecordMasteryHonors(org, room, all, ct);
        await StoreAwards(org, room.SeasonId, room.Awards, ct);
    }
    private async Task StoreAwards(Guid org, Guid seasonId, IReadOnlyList<PracticeAward> awards, CancellationToken ct)
    {
        var stored = await db.Set<PracticeAwardRecord>().Where(a => a.OrganizationId == org && a.SeasonId == seasonId).ToListAsync(ct);
        var desired = awards.ToDictionary(a => (a.UserId, a.Key));
        foreach (var existing in stored)
        {
            if (!desired.Remove((existing.UserId, existing.Key))) db.Remove(existing);
            else existing.ReconciledAt = runtime.Now;
        }
        foreach (var award in desired.Values) db.Add(new PracticeAwardRecord
        {
            OrganizationId = org,
            SeasonId = award.SeasonId,
            UserId = award.UserId,
            Key = award.Key,
            Title = award.Title,
            ReconciledAt = runtime.Now
        });
    }
    private async Task PruneMessages(CancellationToken ct)
    {
        var all = await Rooms.AsNoTracking().Select(r => new { r.Id, r.OrganizationId, r.StateJson }).ToListAsync(ct);
        foreach (var candidate in all.Where(r => PracticeJson.Read<PracticeRoom>(r.StateJson).Messages.Any(m => m.CreatedAt < runtime.Now.AddDays(-30))))
        {
            using var lease = await runtime.Enter(candidate.Id, ct);
            var row = await Load(candidate.OrganizationId, candidate.Id, ct);
            var room = PracticeJson.Read<PracticeRoom>(row.StateJson);
            room.Messages.RemoveAll(m => m.CreatedAt < runtime.Now.AddDays(-30));
            await Save(row, room, ct);
        }
    }
    public async Task ReconcileReviewedAwards(Guid org, Guid season, CancellationToken ct)
    {
        var rooms = (await Rooms.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.Status == "Completed").ToListAsync(ct)).Select(r => PracticeJson.Read<PracticeRoom>(r.StateJson)).ToList();
        await StoreAwards(org, season, CalculateAwards(await OverlayRooms(org, rooms, ct)).ToList(), ct);
        await db.SaveChangesAsync(ct);
    }
    private static IEnumerable<PracticeAward> CalculateAwards(IEnumerable<PracticeRoom> states)
    {
        var all = states.ToList(); foreach (var award in LegacyAwards(all.Where(r => !IsPbe(r)))) yield return award;
        foreach (var season in all.Where(r => IsPbe(r) && r.Status == "Completed").GroupBy(r => r.SeasonId))
            foreach (var user in season.SelectMany(r => r.Members).Select(m => m.UserId).Distinct())
            {
                var played = season.Where(r => r.Members.Any(m => m.UserId == user)).OrderByDescending(r => r.CompletedAt).ThenByDescending(r => r.Id).ToList();
                yield return new("pbe-team-v1:first-fellowship", "First Fellowship", season.Key, user);
                if (played.Count >= 10 && played.Select(r => r.CompletedAt!.Value.UtcDateTime.Date).Distinct().Count() >= 3) yield return new("pbe-team-v1:team-steady", "Team Steady", season.Key, user);
                if (played.SelectMany(r => r.Submissions).Where(s => s.ScribeId == user && !s.DeadlineDraft).Select(s => s.QuestionId).Distinct().Count() >= 10) yield return new("pbe-team-v1:shared-scribe", "Shared Scribe", season.Key, user);
                var final = played.SelectMany(r => r.Submissions.Where(s => s.Team == r.Members.Single(m => m.UserId == user).Team).Select(s => new { Submission = s, Question = r.Questions.Single(q => q.Id == s.QuestionId) })).GroupBy(x => x.Question.Id).Select(g => g.First()).ToList();
                if (final.All(x => x.Submission.Resolved) && final.Count >= 30 && final.Sum(x => x.Submission.AccuracyHundredths) * 10L >= final.Sum(x => Points(x.Question) * 100L) * 9) yield return new("pbe-team-v1:team-precision", "Team Precision", season.Key, user);
                if (played.Any(r => r.QuestionCount == 90)) yield return new("pbe-team-v1:rehearsal-complete", "Rehearsal Complete", season.Key, user);
            }
    }
    private static IEnumerable<PracticeAward> LegacyAwards(IEnumerable<PracticeRoom> states)
    {
        var complete = states.Where(r => r.Status == "Completed" && r.Submissions.All(s => s.Resolved)).ToList();
        foreach (var season in complete.GroupBy(r => r.SeasonId))
            foreach (var user in season.SelectMany(r => r.Members).Select(m => m.UserId).Distinct())
            {
                var played = season.Where(r => r.Members.Any(m => m.UserId == user)).ToList();
                if (played.Count == 0) continue;
                yield return new("first-fellowship", "First Fellowship", season.Key, user);
                if (played.Count >= 10 && played.Select(r => r.CompletedAt!.Value.UtcDateTime.Date).Distinct().Count() >= 3)
                    yield return new("team-steady", "Team Steady", season.Key, user);
                if (played.SelectMany(r => r.Submissions).Where(s => s.ScribeId == user && !s.DeadlineDraft).Select(s => s.QuestionId).Distinct().Count() >= 10)
                    yield return new("shared-scribe", "Shared Scribe", season.Key, user);
                var distinct = played.SelectMany(r => r.Submissions.Where(s => s.Team == r.Members.Single(m => m.UserId == user).Team)
                    .Select(s => new { Submission = s, Question = r.Questions.Single(q => q.Id == s.QuestionId) }))
                    .GroupBy(s => s.Question.Id).Select(g => g.First()).ToList();
                if (distinct.Count >= 30 && distinct.Sum(x => x.Submission.AccuracyHundredths) * 10L >= distinct.Sum(x => Points(x.Question) * 100L) * 9)
                    yield return new("team-precision", "Team Precision", season.Key, user);
                if (played.Any(r => r.Coached && r.QuestionCount == 90)) yield return new("rehearsal-complete", "Rehearsal Complete", season.Key, user);
            }
    }
}
