using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Study;
namespace Erudoza.Api.Endpoints;

public static class TrainingEndpoints
{
    public static void MapTrainingEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1").RequireAuthorization("CanStudy");
        group.MapGet("/progress/me/today", async (Guid? seasonId, ICurrentUser current, TrainingQueryService query, CancellationToken ct) => Results.Ok(await query.TodayAsync(current.OrganizationId, current.UserId, seasonId, ct)));
        group.MapGet("/progress/me/honors", async (Guid seasonId, ICurrentUser current, TrainingQueryService query, CancellationToken ct) => Results.Ok(await query.HonorsAsync(current.OrganizationId, current.UserId, seasonId, ct)));
        group.MapGet("/progress/me/journey", async (Guid seasonId, string? after, ICurrentUser current, TrainingQueryService query, CancellationToken ct) => Results.Ok(await query.JourneyAsync(current.OrganizationId, current.UserId, seasonId, after, ct)));
        group.MapGet("/study/sessions/{sessionId:guid}/recap", async (Guid sessionId, ICurrentUser current, TrainingQueryService query, CancellationToken ct) => Results.Ok(await query.RecapAsync(current.OrganizationId, current.UserId, sessionId, ct)));
        group.MapPut("/progress/me/preferences", async (SaveTrainingPreferencesRequest request, ICurrentUser current, TrainingProgressService training, IStudyWriteCoordinator writes, CancellationToken ct) => Results.Ok(await writes.ExecuteAsync(current.UserId, token => training.SavePreferencesAsync(current.OrganizationId, current.UserId, request, token), ct)));
    }
}
