using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Competitions;

public sealed class SeasonCoverageService(
    IErudozaDbContext db,
    IStudentStudyScopeService studyScope)
{
    public async Task<SeasonCoverageDto> GetAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(
            item => item.Id == seasonId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Season was not found.");

        var assignments = await db.Assignments.AsNoTracking()
            .Include(item => item.Scopes)
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .ToListAsync(cancellationToken);

        var studentIds = assignments.Select(item => item.StudentUserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking()
            .Where(item => studentIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var mastery = await db.MasteryStates.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .ToListAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var reviews = (await db.ReviewSchedules.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .ToListAsync(cancellationToken))
            .Where(item => item.DueAtUtc <= now)
            .ToList();
        var attemptCounts = (await db.Attempts.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .Select(item => item.StudentUserId)
            .ToListAsync(cancellationToken))
            .GroupBy(id => id)
            .ToDictionary(group => group.Key, group => group.Count());

        var rows = new List<CoverageStudentDto>();
        foreach (var studentId in studentIds)
        {
            var assignment = assignments
                .OrderBy(item => item.Type)
                .First(item => item.StudentUserId == studentId);
            var range = assignment.Scopes.First();
            var user = users[studentId];
            var scope = await studyScope.GetAsync(studentId, seasonId, cancellationToken);
            var studentMastery = mastery.Where(item => item.StudentUserId == studentId).ToList();
            rows.Add(new CoverageStudentDto(
                studentId,
                user.DisplayName,
                user.UserName,
                assignment.Type.ToString(),
                range.BookKey,
                range.StartChapter,
                range.StartVerse,
                range.EndChapter,
                range.EndVerse,
                scope.EligibleSourceUnitIds.Count,
                studentMastery.Count(item => item.Level is MasteryLevel.Strong or MasteryLevel.Mastered),
                reviews.Count(item => item.StudentUserId == studentId),
                attemptCounts.GetValueOrDefault(studentId)));
        }

        return new SeasonCoverageDto(season.Id, season.Name, season.Status.ToString(), rows);
    }
}
