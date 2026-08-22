using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Assignments;

public sealed class StudentStudyScopeService(IErudozaDbContext db) : IStudentStudyScopeService
{
    public async Task<StudentStudyScope> GetAsync(
        Guid studentId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var season = await db.Seasons.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == seasonId, cancellationToken)
            ?? throw new DomainException("Season was not found.");

        var assignments = await db.Assignments
            .AsNoTracking()
            .Include(item => item.Scopes)
            .Where(item => item.OrganizationId == season.OrganizationId
                && item.SeasonId == seasonId
                && item.StudentUserId == studentId)
            .ToListAsync(cancellationToken);

        var packIds = assignments.SelectMany(item => item.Scopes).Select(scope => scope.ContentPackId).Distinct().ToList();
        var units = await db.SourceUnits
            .AsNoTracking()
            .Where(unit => unit.OrganizationId == season.OrganizationId && packIds.Contains(unit.ContentPackId))
            .ToListAsync(cancellationToken);

        var specialist = Resolve(assignments, AssignmentType.PrimarySpecialist, units);
        var required = Resolve(assignments, AssignmentType.RequiredCoverage, units);
        var optional = Resolve(assignments, AssignmentType.OptionalReview, units);
        var eligible = specialist.Union(required).Union(optional).ToHashSet();

        return new StudentStudyScope(studentId, seasonId, eligible, specialist, required);
    }

    private static HashSet<Guid> Resolve(
        IEnumerable<Assignment> assignments,
        AssignmentType type,
        IReadOnlyCollection<SourceUnit> units)
    {
        var ids = new HashSet<Guid>();
        foreach (var assignment in assignments.Where(item => item.Type == type))
        {
            foreach (var scope in assignment.Scopes)
            {
                var range = scope.ToRange();
                foreach (var unit in units.Where(candidate => candidate.ContentPackId == scope.ContentPackId && range.Contains(candidate.ToLocator())))
                {
                    ids.Add(unit.Id);
                }
            }
        }

        return ids;
    }
}
