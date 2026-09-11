using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Competitions;

public sealed class SeasonCoverageService(
    IErudozaDbContext db,
    ICompetitionScopeResolver competitionScope)
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
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId && !item.IsLegacyDuplicate)
            .Select(item => item.StudentUserId)
            .ToListAsync(cancellationToken))
            .GroupBy(id => id)
            .ToDictionary(group => group.Key, group => group.Count());

        var rows = new List<CoverageStudentDto>();
        var allowed = await competitionScope.ResolveAsync(organizationId, seasonId, cancellationToken);
        var knowledge = await db.KnowledgeUnits.AsNoTracking().Include(k => k.SourceUnit)
            .Where(k => allowed.Contains(k.SourceUnitId)
                && (k.OrganizationId == organizationId && k.ContentPack!.OrganizationId == organizationId
                    || k.OrganizationId == BuiltInLibrary.OrganizationId && k.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && k.ContentPack.IsBuiltIn))
            .ToListAsync(cancellationToken);
        // Resolve all students against the same bounded season source set, without a query per student/book.
        foreach (var studentId in studentIds)
        {
            var assignment = assignments
                .OrderBy(item => item.Type)
                .First(item => item.StudentUserId == studentId);
            var range = assignment.Scopes.First();
            var user = users[studentId];
            var scopes = assignments.Where(a => a.StudentUserId == studentId).SelectMany(a => a.Scopes).ToList();
            var eligible = knowledge.Where(k => k.SourceUnit is not null && k.SourceUnit.OrganizationId == k.OrganizationId
                && scopes.Any(s => s.ContentPackId == k.ContentPackId && s.ToRange().Contains(k.SourceUnit.ToLocator()))).ToList();
            var eligibleKnowledgeIds = eligible.Select(k => k.Id).ToHashSet();
            var studentMastery = mastery.Where(item => item.StudentUserId == studentId
                && eligibleKnowledgeIds.Contains(item.KnowledgeUnitId)).ToList();
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
                eligible.Select(k => k.SourceUnitId).Distinct().Count(),
                studentMastery.Count(item => item.Level == MasteryLevel.Mastered
                    && item.AlgorithmVersion == ScaffoldMasteryRules.AlgorithmVersion),
                reviews.Count(item => item.StudentUserId == studentId && eligibleKnowledgeIds.Contains(item.KnowledgeUnitId)),
                attemptCounts.GetValueOrDefault(studentId)));
        }

        return new SeasonCoverageDto(season.Id, season.Name, season.Status.ToString(), rows);
    }
}
