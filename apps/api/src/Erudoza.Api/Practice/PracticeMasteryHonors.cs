using Erudoza.Application.Honors;
using Erudoza.Domain.Study;

namespace Erudoza.Api.Practice;

public sealed partial class PracticeService
{
    private async Task RecordMasteryHonors(Guid org, PracticeRoom current, IReadOnlyList<PracticeRoom> rooms, CancellationToken ct)
    {
        if (current.Status != "Completed" || current.Submissions.Any(s => !s.Resolved)) return;
        var matches = rooms.Where(r => r.CompletedAt is not null).Select(r => new HonorMatch(r.Id, r.SeasonId,
            r.Revision + (r.Id == current.Id ? 1 : 0), r.CompletedAt!.Value, r.Status == "Completed",
            r.Questions.Count == r.QuestionCount && r.Questions.Select(q => q.Id).Distinct().Count() == r.QuestionCount &&
            r.Submissions.Count == r.QuestionCount * ActiveTeams(r).Length && r.Questions.All(q => ActiveTeams(r).All(team => r.Submissions.Count(s => s.QuestionId == q.Id && s.Team == team && s.Resolved) == 1)),
            r.Coached, r.QuestionCount, r.Members.Select(m => new HonorTeamMember(m.UserId, m.Team)).ToArray(),
            r.Submissions.Where(s => r.Questions.Any(q => q.Id == s.QuestionId)).Select(s => new HonorScoredQuestion(s.QuestionId,
                r.Questions.Single(q => q.Id == s.QuestionId).SourceUnitId, s.Team, s.ScribeId, !s.DeadlineDraft,
                s.AccuracyHundredths, Points(r.Questions.Single(q => q.Id == s.QuestionId)) * 100)).ToArray())).ToArray();
        var service = new MasteryHonorService(db);
        foreach (var user in current.Members.Select(m => m.UserId).Distinct())
            await service.RecordAsync(org, user, current.SeasonId, runtime.Now, MasteryHonorRules.Team(matches, user), ct);
    }
}
