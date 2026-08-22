using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Content;

public sealed class CompetitionScopeResolver(IErudozaDbContext db) : ICompetitionScopeResolver
{
    public async Task<IReadOnlySet<Guid>> ResolveAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var entries = await db.ScopeEntries
            .AsNoTracking()
            .Where(entry => entry.OrganizationId == organizationId && entry.SeasonId == seasonId)
            .ToListAsync(cancellationToken);

        if (entries.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var packIds = entries.Select(entry => entry.ContentPackId).Distinct().ToList();
        var units = await db.SourceUnits
            .AsNoTracking()
            .Where(unit => unit.OrganizationId == organizationId
                && packIds.Contains(unit.ContentPackId)
                && unit.IsActive
                && !unit.IsRetired)
            .ToListAsync(cancellationToken);

        var included = new HashSet<Guid>();
        foreach (var include in entries.Where(entry => entry.Kind == ScopeEntryKind.Include))
        {
            var range = include.ToRange();
            foreach (var unit in units.Where(candidate => candidate.ContentPackId == include.ContentPackId && range.Contains(candidate.ToLocator())))
            {
                included.Add(unit.Id);
            }
        }

        foreach (var exclude in entries.Where(entry => entry.Kind == ScopeEntryKind.Exclude))
        {
            var range = exclude.ToRange();
            foreach (var unit in units.Where(candidate => candidate.ContentPackId == exclude.ContentPackId && range.Contains(candidate.ToLocator())))
            {
                included.Remove(unit.Id);
            }
        }

        return included;
    }
}
