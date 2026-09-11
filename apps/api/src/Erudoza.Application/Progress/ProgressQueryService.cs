using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Mapping;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Progress;

public sealed class ProgressQueryService(IErudozaDbContext db, IClock clock, IStudentStudyScopeService studyScope)
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
        var assignedSeasonIds = await db.Assignments.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.StudentUserId == studentId)
            .Select(item => item.SeasonId).Distinct().ToListAsync(cancellationToken);
        if (seasonId is { } requested)
        {
            season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(
                item => item.Id == requested && item.OrganizationId == organizationId && assignedSeasonIds.Contains(item.Id),
                cancellationToken);
        }
        else
        {
            season = (await db.Seasons.AsNoTracking()
                .Where(item => item.OrganizationId == organizationId && item.Status == SeasonStatus.Active && assignedSeasonIds.Contains(item.Id))
                .ToListAsync(cancellationToken))
                .OrderByDescending(item => item.ActivatedAtUtc)
                .FirstOrDefault();
        }

        if (season is null)
        {
            return new ProgressDto(Guid.Empty, string.Empty, "None", [], 0, 0, 0, [], studentId, displayName);
        }

        var scope = await studyScope.GetAsync(studentId, season.Id, cancellationToken);
        var member = await db.CompetitionMembers.AsNoTracking().SingleOrDefaultAsync(
            item => item.OrganizationId == organizationId && item.SeasonId == season.Id && item.UserId == studentId, cancellationToken);
        var eligibleKnowledgeIds = await db.KnowledgeUnits.AsNoTracking()
            .Where(item => (item.OrganizationId == organizationId && item.ContentPack!.OrganizationId == organizationId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn) && scope.EligibleSourceUnitIds.Contains(item.SourceUnitId))
            .Select(item => item.Id).ToListAsync(cancellationToken);
        var assignments = await db.Assignments.AsNoTracking()
            .Include(item => item.Scopes)
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == season.Id && item.StudentUserId == studentId)
            .ToListAsync(cancellationToken);
        var mastery = await db.MasteryStates.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.StudentUserId == studentId && item.SeasonId == season.Id && eligibleKnowledgeIds.Contains(item.KnowledgeUnitId))
            .ToListAsync(cancellationToken);
        var now = clock.UtcNow;
        var reviews = (await db.ReviewSchedules.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.StudentUserId == studentId && item.SeasonId == season.Id && eligibleKnowledgeIds.Contains(item.KnowledgeUnitId))
            .ToListAsync(cancellationToken))
            .ToList();
        var attemptEntities = await db.Attempts.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.StudentUserId == studentId && item.SeasonId == season.Id && !item.IsLegacyDuplicate)
            .ToListAsync(cancellationToken);
        var referencedIds = attemptEntities.Select(a => a.KnowledgeUnitId).Concat(eligibleKnowledgeIds).Distinct().ToArray();
        var knowledge = await db.KnowledgeUnits.AsNoTracking()
            .Where(item => referencedIds.Contains(item.Id) && (item.OrganizationId == organizationId && item.ContentPack!.OrganizationId == organizationId
                || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var attempts = attemptEntities.Count;
        var recentAttempts = attemptEntities
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(20)
            .Select(item => new AttemptRowDto(
                item.Id,
                knowledge.TryGetValue(item.KnowledgeUnitId, out var unit) ? unit.Title : "Passage",
                item.ActivityType,
                item.IsCorrect,
                item.SubmittedAnswer,
                item.EvaluationResult,
                item.CreatedAtUtc))
            .ToList();

        return new ProgressDto(
            season.Id,
            season.Name,
            season.Status.ToString(),
            assignments.Select(item => DtoMapper.ToAssignmentDto(item, difficulty: member?.Difficulty ?? TrainingDifficulty.Standard)).ToList(),
            mastery.Count(item => item.Level == MasteryLevel.Mastered && item.AlgorithmVersion == ScaffoldMasteryRules.AlgorithmVersion),
            reviews.Count(item => item.DueAtUtc <= now),
            attempts,
            mastery.Select(item => new MasteryRowDto(
                item.KnowledgeUnitId,
                knowledge.TryGetValue(item.KnowledgeUnitId, out var unit) ? unit.Title : "Passage",
                item.Level.ToString(),
                item.ExactWordingScore,
                item.RecognitionScore,
                reviews.FirstOrDefault(review => review.KnowledgeUnitId == item.KnowledgeUnitId)?.DueAtUtc,
                item.AlgorithmVersion)).ToList(),
            studentId,
            displayName,
            recentAttempts);
    }
}
