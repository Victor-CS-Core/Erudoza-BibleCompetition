using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Study;
namespace Erudoza.Api.Endpoints;

public static class PbeCooperationEndpoints
{
    public static void MapPbeCooperationEndpoints(this WebApplication app)
    {
        var own = app.MapGroup("/api/v1/progress/me/pbe-cooperation").RequireAuthorization("CanStudy");
        var coach = app.MapGroup("/api/v1/organizations/{orgId:guid}/seasons/{seasonId:guid}/pbe-cooperation").RequireAuthorization("CanManageSeason");
        foreach (var group in new[] { own, coach }) group.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
            catch (KeyNotFoundException e) { return Results.NotFound(new { message = e.Message }); }
            catch (PbeCooperationConflictException e) { return Results.Conflict(new { code = e.Code }); }
            catch (PbeProgressConflictException) { return Results.Conflict(new { code = "PBE_COOPERATION_WORK_STALE" }); }
            catch (PbeChapterLimitException e) { return Results.Json(new { code = e.Reason }, statusCode: 413); }
            catch (Microsoft.Data.Sqlite.SqliteException e) when (e.SqliteErrorCode is 5 or 6) { return Results.Conflict(new { code = "PBE_COOPERATION_WORK_STALE" }); }
        });
        own.MapGet("", async (Guid seasonId, ICurrentUser user, PbeCooperationService service, CancellationToken ct) => Results.Ok(await service.Get(user.OrganizationId, seasonId, false, ct)));
        own.MapPost("/continue", async (ContinueChaptersRequest input, ICurrentUser user, PbeCooperationService service, CancellationToken ct) => Results.Ok(await service.Continue(user.OrganizationId, input, false, ct)));
        coach.MapGet("", async (Guid orgId, Guid seasonId, PbeCooperationService service, CancellationToken ct) => Results.Ok(await service.Get(orgId, seasonId, true, ct)));
        coach.MapGet("/students", async (Guid orgId, Guid seasonId, string? after, int? limit, PbeCooperationService service, CancellationToken ct) => Results.Ok(await service.Students(orgId, seasonId, after, limit, ct)));
        coach.MapPost("/continue", async (Guid orgId, Guid seasonId, ContinueChaptersRequest input, PbeCooperationService service, CancellationToken ct) =>
        {
            if (input.SeasonId != seasonId) throw new Erudoza.Domain.DomainException("Choose the route season.");
            return Results.Ok(await service.Continue(orgId, input, true, ct));
        });
    }
}
