using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;
using static Erudoza.Application.Study.TrainingProgressService;
namespace Erudoza.Application.Study;

public sealed class TrainingQueryService(IErudozaDbContext db, TrainingProgressService training, IClock clock, PbeSourceResolver resolver, IPbeQuestionBank bank)
{
    private async Task<CompetitionSeason?> SeasonAsync(Guid org, Guid student, Guid? id, CancellationToken ct)
    {
        var query = db.Seasons.AsNoTracking().Where(x => x.OrganizationId == org);
        if (id is not null) return await query.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException("Season was not found.");
        return await query.Where(x => x.Status == SeasonStatus.Active && (db.Assignments.Any(a => a.OrganizationId == org && a.StudentUserId == student && a.SeasonId == x.Id) || x.PbeEnabled && db.PbeTrainingRecords.Any(r => r.OrganizationId == org && r.OwnerId == student && r.SeasonId == x.Id && r.Kind == "pbe-introduction-assignment"))).OrderBy(x => x.Name).FirstOrDefaultAsync(ct);
    }
    public async Task<IReadOnlyList<BadgeProgressDto>> HonorsAsync(Guid org, Guid student, Guid season, CancellationToken ct)
    {
        await SeasonAsync(org, student, season, ct); var eligible = await training.EligibleAsync(org, student, season, ct); var fp = Fingerprint(eligible.Select(x => x.Id));
        var progress = await db.TrainingSeasonProgress.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == season && x.ScopeVersion == fp, ct);
        var awards = await db.SoloBadgeAwards.AsNoTracking().Where(x => x.OrganizationId == org && x.StudentUserId == student && (x.SeasonId == season || x.SeasonId == null)).ToListAsync(ct);
        var list = progress is null ? new List<BadgeProgressDto> { new("exact-recall", "training-v1", "Exact Recall", 0, 5, null, "Assigned scope", null), new("reference-ready", "training-v1", "Reference Ready", 0, 10, null, "Assigned scope", null), new("chapter-strong", "training-v1", "Chapter Strong", 0, 0, null, "Assigned scope", null), new("full-coverage", "training-v1", "Full Coverage", 0, eligible.Count, null, "Assigned scope", null), new("steady-study", "training-v1", "Steady Study", 0, 4, null, "Academy practice weeks", null), new("review-complete", "training-v1", "Review Complete", 0, 1, null, "Assigned scope", null) } : Read<List<BadgeProgressDto>>(progress.BadgesJson);
        return list.Select(b => awards.FirstOrDefault(a => a.Key == b.Key) is { } a ? Read<System.Text.Json.JsonElement>(a.EvidenceJson).GetProperty("badge").Deserialize<BadgeProgressDto>(Json)! : b).ToArray();
    }
    public async Task<TrainingTodayDto> TodayAsync(Guid org, Guid student, Guid? seasonId, CancellationToken ct)
    {
        var prefs = await training.PreferencesAsync(org, student, ct); var calendar = TrainingCalendar.Resolve(clock.UtcNow, prefs);
        var savedWeek = await db.TrainingWeeks.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.WeekStartLocalDate == calendar.WeekStartLocalDate, ct);
        var dates = Enumerable.Range(0, 7).Select(i => DateOnly.Parse(calendar.WeekStartLocalDate).AddDays(i).ToString("yyyy-MM-dd")).ToArray();
        var days = await db.TrainingDays.AsNoTracking().Where(x => x.OrganizationId == org && x.StudentUserId == student && dates.Contains(x.LocalDate)).Select(x => x.LocalDate).ToListAsync(ct);
        var week = new TrainingWeekDto(calendar.WeekStartLocalDate, savedWeek?.TimeZone ?? prefs.TimeZone, savedWeek?.Target ?? prefs.WeeklyTarget, days.Count, dates.Select(d => new TrainingWeekDayDto(d, days.Contains(d), d == calendar.LocalDate)).ToArray());
        var season = await SeasonAsync(org, student, seasonId, ct);
        if (season is null) return new(null, "No season", "Unavailable", calendar.LocalDate, prefs, week, new(null, null, "Unavailable", null, [], "Ask your coach for an assignment."), null, []);
        if (season.PbeEnabled && season.Status == SeasonStatus.Active)
        {
            var resolved = await resolver.ResolveAsync(org, season.Id, student, ct);
            var loaded = await ((PbeQuestionBank)bank).LoadResolvedAsync(new(org, season.Id, student, resolved.Sources.Select(s => s.Id).ToList()), resolved, false, ct);
            var headId = TrainingProgressService.Identity(org, student, season.Id.ToString(), calendar.LocalDate);
            var head = await db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == "pbe-daily-mission-head" && r.Id == headId, ct);
            var mid = head is null ? null : JsonDocument.Parse(head.DataJson).RootElement.GetProperty("missionId").GetString();
            var row = mid is null ? null : await db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.OrganizationId == org && r.OwnerId == student && r.Kind == "pbe-session" && r.Id == mid, ct);
            var saved = row is null ? null : Read<PbeSessionSnapshot>(row.DataJson); var version = PbeSourceResolver.Eligibility(season.Id, student, resolved);
            var stalePbe = saved is not null && saved.ScopeVersion != version;
            var available = loaded.Questions.Count > 0 && await db.CompetitionMembers.AnyAsync(m => m.OrganizationId == org && m.SeasonId == season.Id && m.UserId == student, ct);
            IReadOnlyList<TrainingStepDto> pbeSteps = saved is not null && !stalePbe ? PbeSessionService.Steps(saved) : [new("Practice", Math.Min(8, loaded.Questions.Count), 0, "Pending", null)];
            var done = pbeSteps.All(s => s.Status == "Complete"); var nextPbe = pbeSteps.FirstOrDefault(s => s.Status != "Complete");
            return new(season.Id, season.Name, season.Status.ToString(), calendar.LocalDate, prefs, week, new(saved is not null && !stalePbe ? saved.Id.ToString() : null, saved is not null && !stalePbe ? 1 : null, !available ? "Unavailable" : stalePbe ? "Invalidated" : saved is null ? "Suggested" : done ? "Complete" : "Active", version, pbeSteps, !available ? "No eligible published PBE questions. Ask your coach to prepare this scope, or choose Memory." : stalePbe ? "Your assignment changed. Start a fresh daily mission." : null), available && nextPbe is not null ? new(saved?.Status == "Active" ? "Resume PBE practice" : "Start PBE practice", nextPbe.Kind, saved?.Status == "Completed" ? null : nextPbe.SessionId) : null, [], "Pbe");
        }
        var eligible = await training.EligibleAsync(org, student, season.Id, ct); var fp = Fingerprint(eligible.Select(x => x.Id));
        if (season.Status != SeasonStatus.Active || eligible.Count == 0) return new(season.Id, season.Name, season.Status.ToString(), calendar.LocalDate, prefs, week, new(null, null, "Unavailable", fp, [], "Your season needs an active assignment."), null, await HonorsAsync(org, student, season.Id, ct));
        var m = await db.DailyMissions.AsNoTracking().Where(x => x.LocalDate == calendar.LocalDate && x.SeasonId == season.Id && x.OrganizationId == org && x.StudentUserId == student).OrderByDescending(x => x.Revision).FirstOrDefaultAsync(ct);
        var stale = m is not null && (m.Invalidated || m.ScopeVersion != fp);
        List<TrainingStepDto> steps;
        if (m is null || stale) { var due = await training.DueAsync(org, student, season.Id, eligible.Select(x => x.Id).ToList(), clock.UtcNow, ct); steps = [new("Review", due.Count, 0, due.Count == 0 ? "NotNeeded" : "Pending", null), new("Practice", 8, 0, "Pending", null)]; } else steps = Steps(m);
        var linkedIds = steps.Where(s => s.SessionId is not null && s.Status != "Complete").Select(s => s.SessionId!.Value).ToArray();
        var terminalIds = await db.StudySessions.AsNoTracking().Where(s => s.OrganizationId == org && s.StudentUserId == student && linkedIds.Contains(s.Id) && (s.Status == StudySessionStatus.Completed || s.Status == StudySessionStatus.Abandoned)).Select(s => s.Id).ToListAsync(ct);
        steps = steps.Select(step => step.SessionId is { } id && terminalIds.Contains(id) ? step with { SessionId = null, Status = "Pending" } : step).ToList();
        var complete = steps.All(s => s.Status is "Complete" or "NotNeeded"); var next = steps.FirstOrDefault(s => s.Status is not ("Complete" or "NotNeeded"));
        return new(season.Id, season.Name, season.Status.ToString(), calendar.LocalDate, prefs, week, new(stale ? null : m?.Id, stale ? null : m?.Revision, stale ? "Invalidated" : m is null ? "Suggested" : complete ? "Complete" : "Active", fp, steps, stale ? "Your assignment changed. Start a new mission." : null), next is null ? null : new(next.Kind == "Review" ? "Start review" : "Start practice", next.Kind, next.SessionId), await HonorsAsync(org, student, season.Id, ct));
    }
    public async Task<SessionRecapDto> RecapAsync(Guid org, Guid student, Guid sessionId, CancellationToken ct)
    {
        var pbe = await db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.OrganizationId == org && r.OwnerId == student && r.Kind == "pbe-session" && r.Id == sessionId.ToString(), ct);
        if (pbe is not null)
        {
            var s = Read<PbeSessionSnapshot>(pbe.DataJson); if (s.Status != "Completed") throw new TrainingConflictException("Complete your session to save its recap.");
            return new("pbe-daily-v2", s.Id, s.SeasonId, s.Mode, s.CompletedAtUtc, s.Attempts.Count, s.Attempts.Count(a => a.Result.EarnedPoints == a.Result.AvailablePoints), s.Cards.Count, s.Cards.Count == s.Attempts.Count, s.NewlyCreditedDay, s.MissionLocalDate, s.CreditedLocalDate, PbeSessionService.Steps(s), [], []);
        }
        var session = await db.StudySessions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == sessionId && x.OrganizationId == org && x.StudentUserId == student, ct) ?? throw new DomainException("Study session was not found.");
        if (session.Status != StudySessionStatus.Completed) throw new TrainingConflictException($"Resume /student/study?sessionId={session.Id} to finish this session.");
        return await training.RecapAsync(session, ct);
    }
    public async Task<PassageJourneyPageDto> JourneyAsync(Guid org, Guid student, Guid seasonId, string? after, CancellationToken ct)
    {
        await SeasonAsync(org, student, seasonId, ct); var all = await training.EligibleAsync(org, student, seasonId, ct); var fp = Fingerprint(all.Select(x => x.Id));
        var offset = 0; if (after is not null && (!int.TryParse(after, out offset) || offset < 0 || offset > 5000)) throw new DomainException("Invalid journey cursor.");
        var page = all.Skip(offset).Take(100).ToList(); var ids = all.Select(x => x.Id).ToArray();
        var states = await db.MasteryStates.AsNoTracking().Where(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == seasonId && ids.Contains(x.KnowledgeUnitId)).ToDictionaryAsync(x => x.KnowledgeUnitId, ct);
        var reviews = await db.ReviewSchedules.AsNoTracking().Where(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == seasonId && ids.Contains(x.KnowledgeUnitId)).ToDictionaryAsync(x => x.KnowledgeUnitId, ct);
        var progress = await db.TrainingSeasonProgress.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == org && x.StudentUserId == student && x.SeasonId == seasonId && x.ScopeVersion == fp, ct); var seen = progress is null ? [] : Ids(progress.SeenIdsJson);
        return new(seasonId, fp, offset + page.Count < all.Count ? (offset + page.Count).ToString() : null, page.GroupBy(x => (x.SourceUnit!.BookKey, x.SourceUnit.Chapter)).Select(g => new JourneyChapterDto(g.Key.BookKey, g.Key.Chapter, "Assigned scope", all.Count(x => x.SourceUnit!.BookKey == g.Key.BookKey && x.SourceUnit.Chapter == g.Key.Chapter), all.Count(x => x.SourceUnit!.BookKey == g.Key.BookKey && x.SourceUnit.Chapter == g.Key.Chapter && states.ContainsKey(x.Id)), all.Count(x => x.SourceUnit!.BookKey == g.Key.BookKey && x.SourceUnit.Chapter == g.Key.Chapter && states.TryGetValue(x.Id, out var m) && m.AlgorithmVersion == "v2-skill-evidence" && m.Level is MasteryLevel.Strong or MasteryLevel.Mastered), g.Select(x => { states.TryGetValue(x.Id, out var m); reviews.TryGetValue(x.Id, out var r); return new JourneyPassageDto(x.Id, x.SourceUnit!.CitationLabel, m?.AlgorithmVersion == "v2-skill-evidence" ? m.Level.ToString() : "Unknown", m?.AlgorithmVersion ?? "unknown", Scores(m), r?.DueAtUtc); }).ToArray())).ToArray());
    }
}
