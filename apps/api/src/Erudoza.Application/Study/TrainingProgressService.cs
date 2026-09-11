using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed class SessionTrainingSnapshot
{
    public string? ClientStartId { get; set; }
    public string? StartPayload { get; set; }
    public string? MissionId { get; set; }
    public int? MissionRevision { get; set; }
    public string? MissionLocalDate { get; set; }
    public string TimeZone { get; set; } = "UTC";
    public List<Guid> ReviewKnowledgeUnitIds { get; set; } = [];
    public string? CreditedLocalDate { get; set; }
    public bool NewlyCreditedDay { get; set; }
    public List<BadgeProgressDto> EarnedBadges { get; set; } = [];
}
public sealed class TrainingProgressService(IErudozaDbContext db, IStudentStudyScopeService scopeService, IClock clock)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Json)!;
    internal static string Write<T>(T value) => JsonSerializer.Serialize(value, Json);
    internal static List<Guid> Ids(string value) => Read<List<Guid>>(value);
    internal static string Identity(Guid org, Guid student, params string[] parts) => string.Join(':', new[] { org.ToString(), student.ToString() }.Concat(parts));
    internal static string Fingerprint(IEnumerable<Guid> ids) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', ids.Select(x => x.ToString()).Distinct().Order(StringComparer.Ordinal)))));
    public async Task<List<KnowledgeUnit>> EligibleAsync(Guid org, Guid student, Guid season, CancellationToken ct)
    {
        var scope = await scopeService.GetAsync(student, season, ct);
        var eligible = await db.KnowledgeUnits.AsNoTracking().Include(x => x.SourceUnit).Where(x => scope.EligibleSourceUnitIds.Contains(x.SourceUnitId) && x.Kind == KnowledgeUnitKind.ExactVerseText && x.SourceUnit != null && x.SourceUnit.IsActive && !x.SourceUnit.IsRetired && x.SourceUnit.OrganizationId == x.OrganizationId && (x.OrganizationId == org && x.ContentPack!.OrganizationId == org || x.OrganizationId == BuiltInLibrary.OrganizationId && x.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && x.ContentPack.IsBuiltIn)).OrderBy(x => x.SourceUnit!.Ordinal).ThenBy(x => x.Id).Take(5001).ToListAsync(ct);
        if (eligible.Count > 5000) throw new DomainException("Training scope exceeds the 5,000-passage limit. Ask your coach to narrow the assignment.");
        return eligible;
    }
    public async Task<TrainingPreferencesDto> PreferencesAsync(Guid org, Guid student, CancellationToken ct)
    {
        var p = await db.TrainingPreferences.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student, ct);
        return TrainingCalendar.Effective(clock.UtcNow, p is null ? new("UTC", 5, null) : Read<TrainingPreferencesDto>(p.PreferencesJson));
    }
    private async Task<TrainingPreference> TouchAsync(Guid org, Guid student, DateTimeOffset at, string? zone, CancellationToken ct)
    {
        if (zone is not null) TrainingCalendar.Validate(zone, 5);
        var p = await db.TrainingPreferences.SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student, ct);
        if (p is null) { p = new() { OrganizationId = org, StudentUserId = student, PreferencesJson = Write(new TrainingPreferencesDto(zone ?? "UTC", 5, null)), LastEventAtUtc = at }; db.TrainingPreferences.Add(p); }
        p.PreferencesJson = Write(TrainingCalendar.Effective(at, Read<TrainingPreferencesDto>(p.PreferencesJson)));
        if (at > p.LastEventAtUtc) p.LastEventAtUtc = at;
        p.Revision++;
        return p;
    }
    public async Task<TrainingPreferencesDto> SavePreferencesAsync(Guid org, Guid student, SaveTrainingPreferencesRequest input, CancellationToken ct)
    {
        TrainingCalendar.Validate(input.TimeZone, input.WeeklyTarget);
        var exists = await db.TrainingPreferences.AnyAsync(x => x.OrganizationId == org && x.StudentUserId == student, ct);
        var row = await TouchAsync(org, student, clock.UtcNow, input.TimeZone, ct);
        var current = Read<TrainingPreferencesDto>(row.PreferencesJson);
        var value = !exists ? new TrainingPreferencesDto(input.TimeZone, input.WeeklyTarget, null) : current with { Pending = current.TimeZone == input.TimeZone && current.WeeklyTarget == input.WeeklyTarget ? null : new(input.TimeZone, input.WeeklyTarget, TrainingCalendar.Resolve(clock.UtcNow, current).NextWeekAtUtc) };
        row.PreferencesJson = Write(value); await db.SaveChangesAsync(ct); return value;
    }
    internal async Task PrepareStartAsync(StudySession session, StartSessionRequest request, CancellationToken ct)
    {
        var t = request.Training; var p = await TouchAsync(session.OrganizationId, session.StudentUserId, session.CreatedAtUtc, t?.TimeZone, ct);
        var prefs = Read<TrainingPreferencesDto>(p.PreferencesJson); var calendar = TrainingCalendar.Resolve(session.CreatedAtUtc, prefs);
        var snapshot = new SessionTrainingSnapshot { ClientStartId = t?.ClientStartId, StartPayload = t is null ? null : Write(request), TimeZone = prefs.TimeZone };
        if (t is not null)
        {
            if (string.IsNullOrWhiteSpace(t.ClientStartId) || t.ClientStartId.Length > 200) throw new DomainException("A training start ID is required.");
            if (t.Step is not null && t.Step != session.Mode.ToString() || t.MissionId is not null && (t.MissionRevision is null || t.Step is null) || session.Mode == StudyMode.Simulation && t.MissionId is not null) throw new DomainException("Choose a matching mission revision and step.");
            session.ClientStartId = t.ClientStartId; session.StartPayloadJson = Write(request);
            if (session.Mode != StudyMode.Simulation && t.Step is not null)
            {
                var eligible = await EligibleAsync(session.OrganizationId, session.StudentUserId, session.SeasonId, ct); var fp = Fingerprint(eligible.Select(x => x.Id));
                var missionQuery = db.DailyMissions.Where(x => x.OrganizationId == session.OrganizationId && x.StudentUserId == session.StudentUserId && x.SeasonId == session.SeasonId);
                var mission = t.MissionId is not null ? await missionQuery.SingleOrDefaultAsync(x => x.Id == t.MissionId, ct) : await missionQuery.Where(x => x.LocalDate == calendar.LocalDate).OrderByDescending(x => x.Revision).FirstOrDefaultAsync(ct);
                if (t.MissionId is not null && (mission is null || mission.Revision != t.MissionRevision || mission.Invalidated || mission.ScopeVersion != fp)) throw new TrainingConflictException("The mission changed. Reload Training HQ.");
                if (mission is null || mission.Invalidated || mission.ScopeVersion != fp)
                {
                    var due = await DueAsync(session.OrganizationId, session.StudentUserId, session.SeasonId, eligible.Select(x => x.Id).ToList(), session.CreatedAtUtc, ct);
                    var revision = (mission?.Revision ?? 0) + 1; if (mission is not null) mission.Invalidated = true;
                    mission = new() { Id = Identity(session.OrganizationId, session.StudentUserId, session.SeasonId.ToString(), calendar.LocalDate, revision.ToString()), Revision = revision, OrganizationId = session.OrganizationId, StudentUserId = session.StudentUserId, SeasonId = session.SeasonId, LocalDate = calendar.LocalDate }; db.DailyMissions.Add(mission);
                    mission.ScopeVersion = fp; mission.TimeZone = prefs.TimeZone; mission.EligibleIdsJson = Write(eligible.Select(x => x.Id)); mission.ReviewIdsJson = Write(due); mission.AcceptedReviewIdsJson = "[]"; mission.Invalidated = false; mission.PracticeCompleted = 0; mission.PracticeSessionId = null; mission.ReviewSessionId = null;
                }
                if (session.Mode == StudyMode.Review) { var remaining = Ids(mission.ReviewIdsJson).Except(Ids(mission.AcceptedReviewIdsJson)).ToList(); if (remaining.Count == 0) throw new DomainException("No reviews due. Start the practice drill."); session.TargetCardCount = remaining.Count; snapshot.ReviewKnowledgeUnitIds = Ids(mission.ReviewIdsJson); mission.ReviewSessionId = session.Id; } else mission.PracticeSessionId = session.Id;
                snapshot.MissionId = mission.Id; snapshot.MissionRevision = mission.Revision; snapshot.MissionLocalDate = mission.LocalDate;
            }
        }
        session.TrainingJson = Write(snapshot);
    }
    internal async Task<List<Guid>> DueAsync(Guid org, Guid student, Guid season, List<Guid> eligible, DateTimeOffset at, CancellationToken ct) => (await db.ReviewSchedules.AsNoTracking().Where(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == season && eligible.Contains(x.KnowledgeUnitId)).ToListAsync(ct)).Where(x => x.DueAtUtc <= at).OrderBy(x => x.DueAtUtc).ThenBy(x => x.KnowledgeUnitId).Select(x => x.KnowledgeUnitId).Distinct().Take(8).ToList();
    internal static List<TrainingStepDto> Steps(DailyMission m) => [new("Review", Ids(m.ReviewIdsJson).Count, Ids(m.AcceptedReviewIdsJson).Count, m.Invalidated ? "Invalidated" : Ids(m.ReviewIdsJson).Count == 0 ? "NotNeeded" : Ids(m.ReviewIdsJson).Count <= Ids(m.AcceptedReviewIdsJson).Count ? "Complete" : m.ReviewSessionId is null ? "Pending" : "Active", m.ReviewSessionId), new("Practice", 8, m.PracticeCompleted, m.Invalidated ? "Invalidated" : m.PracticeCompleted >= 8 ? "Complete" : m.PracticeSessionId is null ? "Pending" : "Active", m.PracticeSessionId)];
    internal static SkillScoresDto Scores(MasteryState? m) => new(m?.ExactWordingScore ?? 0, m?.RecognitionScore ?? 0, m?.ReferenceScore ?? 0, m?.SequenceScore ?? 0, m?.FactualRecallScore ?? 0);
    internal async Task<bool> InvalidateStaleAsync(Guid org, Guid student, Guid sessionId, CancellationToken ct)
    {
        var session = await db.StudySessions.SingleOrDefaultAsync(x => x.Id == sessionId && x.OrganizationId == org && x.StudentUserId == student, ct);
        if (session?.TrainingJson is null) return false;
        var t = Read<SessionTrainingSnapshot>(session.TrainingJson); if (t.MissionId is null) return false;
        var mission = await db.DailyMissions.SingleAsync(x => x.Id == t.MissionId && x.OrganizationId == org && x.StudentUserId == student, ct);
        var season = await db.Seasons.AsNoTracking().SingleAsync(x => x.Id == session.SeasonId && x.OrganizationId == org, ct);
        var ids = await EligibleAsync(org, student, session.SeasonId, ct);
        if (season.Status != SeasonStatus.Active || mission.Revision != t.MissionRevision || mission.ScopeVersion != Fingerprint(ids.Select(x => x.Id))) mission.Invalidated = true;
        return mission.Invalidated;
    }
    internal async Task ApplyAsync(StudySession session, Attempt attempt, CancellationToken ct)
    {
        var org = session.OrganizationId; var student = session.StudentUserId; var at = attempt.CreatedAtUtc;
        var pref = await TouchAsync(org, student, at, null, ct); var p = Read<TrainingPreferencesDto>(pref.PreferencesJson);
        var t = session.TrainingJson is null ? new SessionTrainingSnapshot() : Read<SessionTrainingSnapshot>(session.TrainingJson);
        var eligible = await EligibleAsync(org, student, session.SeasonId, ct); var fp = Fingerprint(eligible.Select(x => x.Id));
        var attempts = await db.Attempts.Where(x => x.SessionId == session.Id && !x.IsLegacyDuplicate).ToListAsync(ct); if (!attempts.Any(x => x.Id == attempt.Id)) attempts.Add(attempt);
        var review = false; var reviewTransition = false; DailyMission? evidenceMission = null;
        if (t.MissionId is not null)
        {
            var m = await db.DailyMissions.SingleAsync(x => x.Id == t.MissionId && x.OrganizationId == org && x.StudentUserId == student, ct);
            evidenceMission = m;
            if (m.ScopeVersion != fp) m.Invalidated = true;
            if (!m.Invalidated && m.Revision == t.MissionRevision)
            {
                var accepted = Ids(m.AcceptedReviewIdsJson); var required = Ids(m.ReviewIdsJson); var wasReview = required.Count > 0 && required.All(accepted.Contains);
                if (session.Mode == StudyMode.Review && required.Contains(attempt.KnowledgeUnitId) && !accepted.Contains(attempt.KnowledgeUnitId)) { accepted.Add(attempt.KnowledgeUnitId); m.AcceptedReviewIdsJson = Write(accepted); }
                if (session.Mode == StudyMode.Practice) m.PracticeCompleted = Math.Max(m.PracticeCompleted, attempts.Select(x => x.ChallengeCardId).Distinct().Count());
                review = required.Count > 0 && required.All(accepted.Contains); reviewTransition = review && !wasReview;
            }
        }
        var full = TrainingRules.FullTargetReached(session.TargetCardCount, attempts.Select(Evidence));
        var wasFull = TrainingRules.FullTargetReached(session.TargetCardCount, attempts.Where(x => x.Id != attempt.Id).Select(Evidence));
        if ((t.MissionId is not null && session.Mode == StudyMode.Review ? reviewTransition : full && !wasFull) && t.CreditedLocalDate is null)
        {
            var calendar = TrainingCalendar.Resolve(at, p); t.CreditedLocalDate = calendar.LocalDate;
            if (!await db.TrainingDays.AnyAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.LocalDate == calendar.LocalDate, ct))
            {
                t.NewlyCreditedDay = true; db.TrainingDays.Add(new() { OrganizationId = org, StudentUserId = student, LocalDate = calendar.LocalDate, TimeZone = calendar.TimeZone, WeekStartLocalDate = calendar.WeekStartLocalDate, CreditedAtUtc = at, SessionId = session.Id });
                var week = await db.TrainingWeeks.SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.WeekStartLocalDate == calendar.WeekStartLocalDate, ct);
                if (week is null) { week = new() { OrganizationId = org, StudentUserId = student, WeekStartLocalDate = calendar.WeekStartLocalDate, TimeZone = calendar.TimeZone, Target = p.WeeklyTarget }; db.TrainingWeeks.Add(week); }
                week.CompletedDays++; if (week.CompletedDays >= week.Target) week.QualifiedAtUtc ??= at;
            }
        }
        var progress = await db.TrainingSeasonProgress.SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == session.SeasonId && x.ScopeVersion == fp, ct);
        if (progress is null) { progress = new() { OrganizationId = org, StudentUserId = student, SeasonId = session.SeasonId, ScopeVersion = fp }; db.TrainingSeasonProgress.Add(progress); }
        var seen = Ids(progress.SeenIdsJson); if (!seen.Contains(attempt.KnowledgeUnitId)) { seen.Add(attempt.KnowledgeUnitId); progress.SeenIdsJson = Write(seen); }
        // Save the new mastery and current week inside the outer serializable transaction before bounded projections.
        await db.SaveChangesAsync(ct);
        var masters = await db.MasteryStates.AsNoTracking().Where(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == session.SeasonId).ToListAsync(ct);
        var compatible = masters.Where(x => x.AlgorithmVersion == "v2-skill-evidence" && eligible.Any(e => e.Id == x.KnowledgeUnitId)).ToDictionary(x => x.KnowledgeUnitId);
        var qualifyingWeeks = await db.TrainingWeeks.CountAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.QualifiedAtUtc != null, ct);
        var chapters = eligible.GroupBy(x => (x.SourceUnit!.BookKey, x.SourceUnit.Chapter)).Select(g => new { g.Key.BookKey, g.Key.Chapter, Ids = g.Select(x => x.Id).ToArray(), Total = g.Count(), Strong = g.Count(x => compatible.TryGetValue(x.Id, out var state) && state.Level is MasteryLevel.Strong or MasteryLevel.Mastered) }).OrderByDescending(x => x.Total > 0 && (x.Strong == x.Total)).ThenByDescending(x => (double)x.Strong / x.Total).ToList();
        var chapter = chapters.FirstOrDefault();
        var values = new (string Key, string Title, int Count, int Target)[] { ("exact-recall", "Exact Recall", TrainingRules.ExactRecallCount(eligible.Select(x => x.Id), masters), 5), ("reference-ready", "Reference Ready", TrainingRules.ReferenceReadyCount(eligible.Select(x => x.Id), masters), 10), ("chapter-strong", "Chapter Strong", chapter?.Strong ?? 0, chapter?.Total ?? 0), ("full-coverage", "Full Coverage", eligible.Count(x => seen.Contains(x.Id)), eligible.Count), ("steady-study", "Steady Study", qualifyingWeeks, 4), ("review-complete", "Review Complete", review ? 1 : 0, 1) };
        var counters = new List<BadgeProgressDto>();
        foreach (var v in values)
        {
            var awardScope = v.Key == "steady-study" ? "academy" : session.SeasonId.ToString();
            var award = await db.SoloBadgeAwards.SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.Key == v.Key && x.RuleVersion == TrainingRules.Version && x.AwardScope == awardScope, ct);
            var awardIds = v.Key == "review-complete" && evidenceMission is not null ? Ids(evidenceMission.ReviewIdsJson).ToArray() : v.Key == "chapter-strong" && chapter is not null ? chapter.Ids : eligible.Select(x => x.Id).ToArray();
            var label = v.Key == "steady-study" ? "Academy practice weeks" : v.Key == "review-complete" ? $"Daily review ({(evidenceMission is null ? 0 : Ids(evidenceMission.ReviewIdsJson).Count)} passages)" : v.Key == "chapter-strong" && chapter is not null ? $"Assigned scope · {chapter.BookKey} {chapter.Chapter} ({v.Target} passages)" : $"Assigned scope ({v.Target} passages)";
            var badge = new BadgeProgressDto(v.Key, TrainingRules.Version, v.Title, Math.Min(v.Count, v.Target), v.Target, award?.EarnedAtUtc, label, award?.SessionId);
            if (award is null && v.Target > 0 && v.Count >= v.Target)
            {
                badge = badge with { EarnedAtUtc = at, EvidenceSessionId = session.Id };
                db.SoloBadgeAwards.Add(new() { OrganizationId = org, StudentUserId = student, Key = v.Key, AwardScope = awardScope, SeasonId = v.Key == "steady-study" ? null : session.SeasonId, EarnedAtUtc = at, SessionId = session.Id, EvidenceJson = Write(new { badge, scopeVersion = fp, eligibleKnowledgeUnitIds = awardIds, evidence = new { missionId = evidenceMission?.Id, qualifyingWeekStarts = await db.TrainingWeeks.Where(x => x.OrganizationId == org && x.StudentUserId == student && x.QualifiedAtUtc != null).OrderBy(x => x.WeekStartLocalDate).Select(x => x.WeekStartLocalDate).Take(4).ToListAsync(ct), skills = compatible.Values.Where(x => awardIds.Contains(x.KnowledgeUnitId)).Select(x => new { knowledgeUnitId = x.KnowledgeUnitId, algorithmVersion = x.AlgorithmVersion, scores = Scores(x) }).ToArray() } }) }); t.EarnedBadges.Add(badge);
            }
            counters.Add(award is null ? badge : Read<JsonElement>(award.EvidenceJson).GetProperty("badge").Deserialize<BadgeProgressDto>(Json)!);
        }
        var badgesJson = Write(counters); if (progress.BadgesJson != badgesJson) progress.BadgesJson = badgesJson;
        session.TrainingJson = Write(t);
    }
    public async Task<SessionRecapDto> RecapAsync(StudySession session, CancellationToken ct)
    {
        if (session.RecapJson is not null) return Read<SessionRecapDto>(session.RecapJson);
        var attempts = (await db.Attempts.AsNoTracking().Where(x => x.SessionId == session.Id && !x.IsLegacyDuplicate).ToListAsync(ct)).OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id).ToList();
        var t = session.TrainingJson is null ? null : Read<SessionTrainingSnapshot>(session.TrainingJson);
        var changes = new List<PassageChangeDto>();
        foreach (var group in attempts.Where(x => x.BeforeSkillsJson != null && x.AfterSkillsJson != null).GroupBy(x => x.KnowledgeUnitId))
        {
            var events = group.Select(a => new SkillEventDto(a.Id, a.CreatedAtUtc, Read<SkillScoresDto>(a.BeforeSkillsJson!), Read<SkillScoresDto>(a.AfterSkillsJson!))).ToArray();
            var delta = new SkillScoresDto(events.Sum(x => x.After.ExactWording - x.Before.ExactWording), events.Sum(x => x.After.Recognition - x.Before.Recognition), events.Sum(x => x.After.Reference - x.Before.Reference), events.Sum(x => x.After.Sequence - x.Before.Sequence), events.Sum(x => x.After.FactualRecall - x.Before.FactualRecall));
            var grouped = group.ToArray();
            var contiguous = events.Select((e, i) => i == 0 || grouped[i].PreviousAttemptId == events[i - 1].AttemptId).All(x => x);
            var title = await db.KnowledgeUnits.Where(x => x.Id == group.Key).Select(x => x.SourceUnit!.CitationLabel).SingleAsync(ct);
            changes.Add(new(group.Key, title, delta, contiguous ? events[0].Before : null, contiguous ? events[^1].After : null, events));
        }
        var mission = t?.MissionId is null ? null : await db.DailyMissions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == t.MissionId && x.OrganizationId == session.OrganizationId && x.StudentUserId == session.StudentUserId, ct);
        return new(t is null ? "legacy-counts" : TrainingRules.Version, session.Id, session.SeasonId, session.Mode.ToString(), session.CompletedAtUtc, attempts.Count, attempts.Count(x => x.IsCorrect), session.TargetCardCount, TrainingRules.FullTargetReached(session.TargetCardCount, attempts.Select(Evidence)), t?.NewlyCreditedDay ?? false, t?.MissionLocalDate, t?.CreditedLocalDate, mission is not null && mission.Revision == t?.MissionRevision ? Steps(mission) : [], t?.EarnedBadges ?? [], changes);
    }
    internal static AcceptedTrainingEvidence Evidence(Attempt a) => new(a.ChallengeCardId, a.KnowledgeUnitId, a.IsLegacyDuplicate, a.IsCorrect);
}
public sealed class TrainingConflictException(string message) : Exception(message);
