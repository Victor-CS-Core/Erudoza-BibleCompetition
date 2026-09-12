using System.Security.Claims;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Erudoza.Api.Practice;

public static class PracticeEndpoints
{
    public sealed record EnabledRequest(bool Enabled);
    public sealed record AcceptRequest(int? Team);
    public static PracticeActor Actor(ICurrentUser user) => new(user.UserId, user.OrganizationId, user.DisplayName, user.IsAdmin);
    public static void MapPractice(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/organizations/{orgId:guid}/practice").RequireAuthorization();
        group.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (UnauthorizedAccessException) { return Results.Forbid(); }
            catch (PracticeForbiddenException) { PracticeMetrics.RejectedCommands.Add(1); return Results.Forbid(); }
            catch (Erudoza.Domain.DomainException) { PracticeMetrics.RejectedCommands.Add(1); throw; }
        });
        var pbe = group.MapGroup("/pbe/seasons/{seasonId:guid}");
        pbe.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (KeyNotFoundException error) { return Results.NotFound(new { message = error.Message }); }
            catch (PbeBankConflictException error) { return Results.Conflict(new { message = error.Message }); }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException) { return Results.Conflict(new { message = "The PBE record changed. Refresh and retry." }); }
            catch (Microsoft.Data.Sqlite.SqliteException error) when (error.SqliteErrorCode is 5 or 6) { return Results.Conflict(new { message = "The PBE record changed. Refresh and retry." }); }
        });
        pbe.MapGet("/introductions", (Guid orgId, Guid seasonId, PbeIntroductionService service, CancellationToken ct) => service.List(orgId, seasonId, ct));
        pbe.MapPost("/introductions", (Guid orgId, Guid seasonId, System.Text.Json.JsonElement request, PbeIntroductionService service, CancellationToken ct) => service.Create(orgId, seasonId, request, ct));
        pbe.MapPost("/introductions/{id:guid}/review", (Guid orgId, Guid seasonId, Guid id, System.Text.Json.JsonElement request, PbeIntroductionService service, CancellationToken ct) => service.Update(orgId, seasonId, id, true, request, ct));
        pbe.MapPost("/introductions/{id:guid}/assignments", (Guid orgId, Guid seasonId, Guid id, System.Text.Json.JsonElement request, PbeIntroductionService service, CancellationToken ct) => service.Update(orgId, seasonId, id, false, request, ct));
        pbe.MapGet("/introductions/{id:guid}/reader", (Guid orgId, Guid seasonId, Guid id, PbeIntroductionService service, CancellationToken ct) => service.Reader(orgId, seasonId, id, ct));
        pbe.MapGet("/bank", (Guid orgId, Guid seasonId, ICurrentUser user, PracticeService service, IPbeQuestionBank bank, CancellationToken ct) => service.PbeMetadata(orgId, seasonId, Actor(user), bank, ct));
        pbe.MapPost("/enabled", async (Guid orgId, Guid seasonId, PbeEnabledRequest request, ICurrentUser user, PracticeService service, IPbeQuestionBank bank, CancellationToken ct) => { await service.PbeEnable(orgId, seasonId, request.Enabled, Actor(user), bank, ct); return Results.NoContent(); });
        pbe.MapPost("/questions/import", async (Guid orgId, Guid seasonId, System.Text.Json.JsonElement request, ICurrentUser user, PracticeService service, IPbeQuestionBank bank, CancellationToken ct) =>
        {
            ImportPbeQuestions? input;
            try { input = System.Text.Json.JsonSerializer.Deserialize<ImportPbeQuestions>(request.GetRawText(), Erudoza.Application.Study.PbeQuestionBank.Json); }
            catch (System.Text.Json.JsonException) { return Results.BadRequest(new { message = "Malformed PBE import." }); }
            if (input is null) return Results.BadRequest(new { message = "Malformed PBE import." });
            await service.PbeImport(orgId, seasonId, input, Actor(user), bank, ct); return Results.NoContent();
        });
        pbe.MapPost("/questions/{id:guid}/{version:int}/publish", async (Guid orgId, Guid seasonId, Guid id, int version, ICurrentUser user, PracticeService service, IPbeQuestionBank bank, CancellationToken ct) => { await service.PbePublish(orgId, seasonId, id, version, Actor(user), bank, ct); return Results.NoContent(); });
        group.MapGet("/bootstrap", (Guid orgId, ICurrentUser user, PracticeService service, CancellationToken ct) => service.Bootstrap(orgId, Actor(user), ct));
        group.MapPost("/enabled", async (Guid orgId, EnabledRequest request, ICurrentUser user, PracticeService service, CancellationToken ct) =>
        { await service.SetEnabled(orgId, request.Enabled, Actor(user), ct); return Results.NoContent(); });
        group.MapPost("/rooms", (Guid orgId, CreatePracticeRoom request, ICurrentUser user, PracticeService service, CancellationToken ct) => service.Create(orgId, Actor(user), request, ct));
        group.MapGet("/rooms/{id:guid}", (Guid orgId, Guid id, ICurrentUser user, PracticeService service, CancellationToken ct) => service.Snapshot(orgId, id, Actor(user), ct));
        group.MapPost("/rooms/{id:guid}/commands", async (Guid orgId, Guid id, PracticeCommand command, ICurrentUser user,
            PracticeService service, PracticeRuntime runtime, IHubContext<PracticeHub> hub, HttpContext http, CancellationToken ct) =>
        {
            var ingress = http.Items[PracticeIngressMiddleware.StampKey] is long captured ? captured : runtime.Stamp();
            var result = await service.Command(orgId, id, Actor(user), command, ingress, ct);
            PracticeMetrics.CommandMilliseconds.Record(runtime.Elapsed(ingress, runtime.Stamp()).TotalMilliseconds);
            await hub.Clients.Group(PracticeHub.Group(orgId, id)).SendAsync("Changed", cancellationToken: ct);
            return result;
        });
        group.MapPost("/invitations/{id:guid}/accept", async (Guid orgId, Guid id, AcceptRequest request, ICurrentUser user, PracticeService service, IHubContext<PracticeHub> hub, CancellationToken ct) =>
        {
            var result = await service.Accept(orgId, id, request.Team, Actor(user), ct);
            await hub.Clients.All.SendAsync("Changed", cancellationToken: ct); // Invalidation only: never contains tenant data.
            return result;
        });
        group.MapPost("/questions/import", async (Guid orgId, System.Text.Json.JsonElement request, ICurrentUser user, PracticeService service, CancellationToken ct) =>
        {
            if (request.ValueKind != System.Text.Json.JsonValueKind.Object) return Results.BadRequest();
            foreach (var property in request.EnumerateObject().Where(p => p.Name.Equals("questions", StringComparison.OrdinalIgnoreCase)))
                if (property.Value.ValueKind == System.Text.Json.JsonValueKind.Array && property.Value.EnumerateArray().Any(q => q.ValueKind == System.Text.Json.JsonValueKind.Object && q.EnumerateObject().Any(p => p.Name.Equals("schemaVersion", StringComparison.OrdinalIgnoreCase)))) return Results.BadRequest(new { message = "Versioned PBE questions require the PBE import endpoint." });
            ImportPracticeQuestions? input;
            try { input = System.Text.Json.JsonSerializer.Deserialize<ImportPracticeQuestions>(request.GetRawText(), PracticeJson.Options); }
            catch (System.Text.Json.JsonException) { return Results.BadRequest(); }
            if (input is null) return Results.BadRequest();
            await service.Import(orgId, Actor(user), input, ct); return Results.NoContent();
        });
        group.MapPost("/questions/{id:guid}/publish", async (Guid orgId, Guid id, ICurrentUser user, PracticeService service, CancellationToken ct) =>
        { await service.Publish(orgId, id, Actor(user), ct); return Results.NoContent(); });
        app.MapHub<PracticeHub>("/api/v1/pvp/hub", options => options.AllowStatefulReconnects = true).RequireAuthorization();
    }
}

[Authorize]
public sealed class PracticeHub(PracticeService service, PracticeRuntime runtime) : Hub
{
    public static string Group(Guid org, Guid room) => $"practice:{org}:{room}";
    private PracticeActor Actor()
    {
        var user = Context.User!;
        return new(Guid.Parse(user.FindFirstValue("sub")!), Guid.Parse(user.FindFirstValue("org")!), user.FindFirstValue("name") ?? "Player", user.IsInRole("Owner") || user.IsInRole("Admin"), user.FindFirstValue("credential_version") ?? "");
    }
    public async Task Watch(Guid org, Guid room)
    {
        await service.Snapshot(org, room, Actor(), Context.ConnectionAborted);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(org, room));
    }
    public async Task<object> Command(Guid org, Guid room, PracticeCommand command)
    {
        if (command.Action == "submit") throw new HubException("Final answers must use the timestamped HTTP submission endpoint.");
        var ingress = runtime.Stamp();
        try
        {
            var result = await service.Command(org, room, Actor(), command, ingress, Context.ConnectionAborted);
            PracticeMetrics.CommandMilliseconds.Record(runtime.Elapsed(ingress, runtime.Stamp()).TotalMilliseconds);
            await Clients.Group(Group(org, room)).SendAsync("Changed");
            return result;
        }
        catch (Erudoza.Domain.DomainException ex) { PracticeMetrics.RejectedCommands.Add(1); throw new HubException(ex.Message); }
        catch (PracticeForbiddenException) { PracticeMetrics.RejectedCommands.Add(1); throw new HubException("Access denied."); }
    }
    public async Task<object> Ping(string nonce)
    {
        var actor = Actor(); await service.Check(actor, actor.OrganizationId, Context.ConnectionAborted);
        return new { nonce = nonce.Length <= 64 ? nonce : "", serverNow = runtime.Now };
    }
    public async Task<object> Probe(Guid org, Guid room)
    {
        var actor = Actor();
        await service.Snapshot(org, room, actor, Context.ConnectionAborted);
        return new { nonce = runtime.Telemetry.Begin(actor.Id, room), serverNow = runtime.Now };
    }
    public async Task<PracticeTimingDiagnostics> AckProbe(Guid org, Guid room, string nonce)
    {
        var actor = Actor();
        var measurement = runtime.Telemetry.Complete(actor.Id, room, nonce);
        await service.Check(actor, org, Context.ConnectionAborted);
        return measurement;
    }
}

public sealed class PracticeTicker(IServiceScopeFactory factory, ILogger<PracticeTicker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = factory.CreateScope();
                var changed = await scope.ServiceProvider.GetRequiredService<PracticeService>().Tick(stoppingToken);
                var hub = scope.ServiceProvider.GetRequiredService<IHubContext<PracticeHub>>();
                foreach (var room in changed) await hub.Clients.Group(PracticeHub.Group(room.OrganizationId, room.RoomId)).SendAsync("Changed", cancellationToken: stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogError(ex, "Practice room transition failed"); }
        }
    }
}
