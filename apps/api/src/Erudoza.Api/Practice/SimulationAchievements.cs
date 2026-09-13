using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Api.Practice;

public sealed record SimulationAchievement(string Key, string Title, string Requirement, int Current, int Target, DateTimeOffset? EarnedAtUtc, Guid SeasonId);
public sealed partial class PracticeService
{
    private static IReadOnlyList<SimulationAchievement> CalculateSimulationAchievements(IEnumerable<PracticeRoom> rooms, Guid user)
    {
        var result = new List<SimulationAchievement>();
        foreach (var season in rooms.Where(IsSimulation).GroupBy(r => r.SeasonId))
        {
            var played = season.Where(r => r.Status == "Completed" && r.CompletedAt.HasValue && r.QuestionCount is 10 or 30 or 90 && r.Questions.Count == r.QuestionCount &&
                r.Questions.Select(q => q.Id).Distinct().Count() == r.QuestionCount && r.Members.Any(m => m.UserId == user) &&
                r.Questions.All(q => r.Services.Any(s => s.QuestionId == q.Id && s.MemberIds.Contains(user)) && r.Submissions.Count(s => s.QuestionId == q.Id && s.Team == 1) == 1))
                .OrderByDescending(r => r.CompletedAt).ThenByDescending(r => r.Id).ToList();
            var full = played.Count(r => r.QuestionCount == 90 && r.Simulation is { Preset: "FullEvent", TimeMultiplier: 1, HalfTime: true } && r.Questions.All(q => r.Presentations.ContainsKey(q.Id)));
            var explicitCount = played.SelectMany(r => r.Submissions).Where(s => s.ScribeId == user && !s.DeadlineDraft).Select(s => s.QuestionId).Distinct().Count();
            var latest = played.SelectMany(r => r.Submissions.Select(s => new { Room = r, Submission = s })).OrderByDescending(x => x.Submission.ResponseLockedAtUtc ?? x.Room.CompletedAt).ThenByDescending(x => x.Room.Id.ToString(), StringComparer.Ordinal).GroupBy(x => x.Submission.QuestionId).Select(g => g.First()).ToList();
            var resolved = latest.All(x => x.Submission.Resolved);
            var precision = resolved && latest.Count >= 30 && latest.Sum(x => (long)x.Submission.AccuracyHundredths) * 10 >= latest.Sum(x => Points(x.Room.Questions.Single(q => q.Id == x.Submission.QuestionId)) * 100L) * 9;
            var currents = new[] { played.Count, full, played.Count, explicitCount, latest.Count(x => x.Submission.Resolved) };
            var targets = new[] { 1, 1, 5, 30, 30 };
            var qualified = new[] { played.Count > 0, full > 0, played.Count >= 5 && played.Select(r => r.CompletedAt!.Value.UtcDateTime.Date).Distinct().Count() >= 3, explicitCount >= 30, precision };
            for (var i = 0; i < SimulationHonorRules.Catalog.Count; i++)
            {
                var d = SimulationHonorRules.Catalog[i];
                DateTimeOffset? earnedAt = qualified[i] ? played.Max(r => r.CompletedAt) : null;
                if (qualified[i] && i == 0) earnedAt = played.Min(r => r.CompletedAt);
                if (qualified[i] && i == 1) earnedAt = played.Where(r => r.QuestionCount == 90 && r.Simulation is { Preset: "FullEvent", TimeMultiplier: 1, HalfTime: true } && r.Questions.All(q => r.Presentations.ContainsKey(q.Id))).Min(r => r.CompletedAt);
                result.Add(new(d.Key, d.Title, d.Requirement, currents[i], targets[i], earnedAt, season.Key));
            }
        }
        return result;
    }
    private async Task RecordSimulationHonors(Guid org, IReadOnlyList<PracticeRoom> rooms, CancellationToken ct)
    {
        var users = rooms.Where(IsSimulation).SelectMany(r => r.Members).Select(m => m.UserId).Distinct().ToArray();
        var unlocks = await db.MasteryHonorUnlocks.Where(x => x.OrganizationId == org && users.Contains(x.UserId) && x.RuleVersion == SimulationHonorRules.Version).ToListAsync(ct);
        foreach (var user in users)
            foreach (var a in CalculateSimulationAchievements(rooms, user).Where(a => a.EarnedAtUtc.HasValue))
            {
                if (unlocks.Any(u => u.UserId == user && u.Key == a.Key)) continue;
                var unlock = new MasteryHonorUnlock
                {
                    OrganizationId = org,
                    UserId = user,
                    SeasonId = a.SeasonId,
                    Key = a.Key,
                    RuleVersion = SimulationHonorRules.Version,
                    EarnedAtUtc = a.EarnedAtUtc!.Value,
                    EvidenceJson = PracticeJson.Write(new { a.SeasonId, roomIds = rooms.Where(r => r.SeasonId == a.SeasonId && IsSimulation(r) && r.Status == "Completed" && r.Services.Any(s => s.MemberIds.Contains(user))).Select(r => r.Id).Order().ToArray(), a.Current, a.Target })
                };
                db.MasteryHonorUnlocks.Add(unlock); unlocks.Add(unlock);
            }
    }
}
