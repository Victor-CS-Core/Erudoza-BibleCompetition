namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    private static IEnumerable<object> Trends(IEnumerable<PracticeRoom> rooms, Guid user)
    {
        foreach (var group in rooms.Where(r => r.Status == "Completed" && r.Submissions.All(s => s.Resolved)
            && r.Members.Any(m => m.UserId == user)).GroupBy(r => new { r.SeasonId, r.TeamSize, r.BookKey, r.RuleVersion }))
        {
            var submissions = group.SelectMany(r => r.Submissions.Where(s => s.Team == r.Members.Single(m => m.UserId == user).Team)).ToList();
            int Total(PracticeRoom r, int team) => r.Submissions.Where(s => s.Team == team).Sum(s => s.AccuracyHundredths + s.SpeedHundredths);
            yield return new
            {
                group.Key.SeasonId,
                group.Key.TeamSize,
                group.Key.BookKey,
                group.Key.RuleVersion,
                matches = group.Count(),
                wins = group.Count(r => Total(r, r.Members.Single(m => m.UserId == user).Team) > Total(r, 3 - r.Members.Single(m => m.UserId == user).Team)),
                draws = group.Count(r => Total(r, 1) == Total(r, 2)),
                accuracyHundredths = submissions.Sum(s => s.AccuracyHundredths),
                speedHundredths = submissions.Sum(s => s.SpeedHundredths),
                availableHundredths = group.Sum(r => r.Questions.Sum(q => Points(q) * 100)),
                unansweredQuestions = submissions.Count(s => s.Answers.All(string.IsNullOrWhiteSpace)),
                averageResponseMs = submissions.Count == 0 ? 0 : submissions.Average(s => TimeSpan.FromTicks(s.ElapsedTicks).TotalMilliseconds),
                distinctQuestions = group.SelectMany(r => r.Questions).Select(q => q.Id).Distinct().Count(),
                distinctPassages = group.SelectMany(r => r.Questions).Select(q => q.SourceUnitId).Distinct().Count(),
                participatedQuestions = group.SelectMany(r => r.Contributions).Where(c => c.UserId == user).Select(c => c.QuestionId).Distinct().Count()
            };
        }
    }
}
