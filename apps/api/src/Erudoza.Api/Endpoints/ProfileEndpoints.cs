using Erudoza.Application.Abstractions;
using Erudoza.Application.Honors;

namespace Erudoza.Api.Endpoints;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/profile").RequireAuthorization();
        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            return await next(context);
        });
        group.MapGet("/me", async (ICurrentUser current, MasteryHonorService profiles, CancellationToken ct) => Results.Ok(await profiles.ProfileAsync(current.OrganizationId, current.UserId, ct)));
        group.MapPut("/me/avatar", async (SaveHonorAvatar request, ICurrentUser current, MasteryHonorService profiles, IStudyWriteCoordinator writes, CancellationToken ct) =>
        {
            try { return Results.Ok(await writes.ExecuteAsync(current.UserId, token => profiles.SelectAsync(current.OrganizationId, current.UserId, request.HonorKey, token), ct)); }
            catch (MasteryHonorLockedException error) { return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: error.Message); }
        });
        group.MapGet("/identities", async (HttpRequest request, ICurrentUser current, MasteryHonorService profiles, CancellationToken ct) => Results.Ok(await profiles.IdentitiesAsync(current.OrganizationId, request.Query["userId"].Select(x => x ?? "").ToArray(), ct)));
    }
}
