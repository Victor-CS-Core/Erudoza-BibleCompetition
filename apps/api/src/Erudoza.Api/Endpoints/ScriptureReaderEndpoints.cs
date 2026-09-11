using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Api.Endpoints;

public static class ScriptureReaderEndpoints
{
    public static void MapScriptureReaderEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/study/seasons/{seasonId:guid}/scripture", async (
            Guid seasonId, ICurrentUser current, IErudozaDbContext db,
            IStudentStudyScopeService studyScope, CancellationToken ct) =>
        {
            var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(item => item.Id == seasonId
                && item.OrganizationId == current.OrganizationId, ct);
            var isMember = await db.CompetitionMembers.AsNoTracking().AnyAsync(item => item.SeasonId == seasonId
                && item.OrganizationId == current.OrganizationId && item.UserId == current.UserId, ct);
            if (season is null || !isMember) return Results.NotFound();
            DomainInvariants.EnsureSeasonIsActiveForStudy(season);

            // The same assignment intersection and include-minus-exclude resolver used by activities.
            var scope = await studyScope.GetAsync(current.UserId, seasonId, ct);
            var approvedLicenses = new[] { "development-sample", "public-domain", "approved", "creative-commons" };
            var verses = await db.SourceUnits.AsNoTracking()
                .Where(item => (item.OrganizationId == current.OrganizationId && item.ContentPack!.OrganizationId == current.OrganizationId || item.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack!.OrganizationId == BuiltInLibrary.OrganizationId && item.ContentPack.IsBuiltIn)
                    && scope.EligibleSourceUnitIds.Contains(item.Id)
                    && item.IsActive && !item.IsRetired && item.ContentPack!.IsActive
                    && approvedLicenses.Contains(item.ContentPack.LicensingStatus.ToLower()))
                .OrderBy(item => item.Ordinal).ThenBy(item => item.Id)
                .Select(item => new SourceUnitDto(item.Id, item.CitationLabel, item.BookKey,
                    item.Chapter, item.Verse, item.Ordinal, item.CanonicalText))
                .Take(5001).ToListAsync(ct);
            if (verses.Count > 5000) return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "This reading scope is too large. Ask your coach to narrow the assigned passages.");
            return Results.Ok(new { seasonId, verses });
        }).RequireAuthorization("CanStudy");
    }
}
