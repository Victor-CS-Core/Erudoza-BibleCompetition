using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Mapping;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Progress;

public sealed class ProgressQueryService(IErudozaDbContext db, IClock clock)
{
    public async Task<ProgressDto> GetAsync(
        Guid organizationId,
        Guid studentId,
        Guid? seasonId,
        CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(
            item => item.Id == studentId,
            cancellationToken);
        var displayName = user?.DisplayName ?? "Student";

        CompetitionSeason? season;
        if (seasonId is { } requested)
        {
            season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(
                item => item.Id == requested && item.OrganizationId == organizationId,
                cancellationToken);
        }
        else
        {
            season = (await db.Seasons.AsNoTracking()
                .Where(item => item.OrganizationId == organizationId && item.Status == SeasonStatus.Active)
                .ToListAsync(cancellationToken))
                .OrderByDescending(item => item.ActivatedAtUtc)
                .FirstOrDefault();
        }

        if (season is null)
        {
            return new ProgressDto(Guid.Empty, string.Empty, "None", [], 0, 0, 0, [], studentId, displayName);
        }

        var assignments = await db.Assignments.AsNoTracking()
            .Include(item => item.Scopes)
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == season.Id && item.StudentUserId == studentId)
            .ToListAsync(cancellationToken);
        var mastery = await db.MasteryStates.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.StudentUserId == studentId && item.SeasonId == season.Id)
            .ToListAsync(cancellationToken);
        var now = clock.UtcNow;
        var reviews = (await db.ReviewSchedules.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.StudentUserId == studentId && item.SeasonId == season.Id)
            .ToListAsync(cancellationToken))
            .ToList();
        var knowledge = await db.KnowledgeUnits.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId)
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var attempts = await db.Attempts.CountAsync(
            item => item.OrganizationId == organizationId && item.StudentUserId == studentId && item.SeasonId == season.Id,
            cancellationToken);

        return new ProgressDto(
            season.Id,
            season.Name,
            season.Status.ToString(),
            assignments.Select(DtoMapper.ToAssignmentDto).ToList(),
            mastery.Count(item => item.Level is MasteryLevel.Strong or MasteryLevel.Mastered),
            reviews.Count(item => item.DueAtUtc <= now),
            attempts,
            mastery.Select(item => new MasteryRowDto(
                item.KnowledgeUnitId,
                knowledge.TryGetValue(item.KnowledgeUnitId, out var unit) ? unit.Title : "Passage",
                item.Level.ToString(),
                item.ExactWordingScore,
                item.RecognitionScore,
                reviews.FirstOrDefault(review => review.KnowledgeUnitId == item.KnowledgeUnitId)?.DueAtUtc)).ToList(),
            studentId,
            displayName);
    }
}
