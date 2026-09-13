using System.Globalization;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;

namespace Erudoza.Api.Endpoints;

public static class ScriptureNotebookEndpoints
{
    private const int BodyLimit = 16 * 1024;

    public static void MapScriptureNotebookEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/organizations/{orgId:guid}/library/notebook").RequireAuthorization("CanStudy");
        group.MapGet("", (Guid orgId, ICurrentUser current, ScriptureNotebookService notebooks, CancellationToken ct) =>
            orgId != current.OrganizationId
                ? Task.FromResult<IResult>(Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization access denied."))
                : Read(notebooks, orgId, current.UserId, ct));
        group.MapPut("/entries/{entryId}", async (Guid orgId, string entryId, HttpRequest request, ICurrentUser current,
            ScriptureNotebookService notebooks, CancellationToken ct) =>
        {
            if (orgId != current.OrganizationId) return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization access denied.");
            if (!Guid.TryParseExact(entryId, "D", out var id) || id == Guid.Empty) return Results.BadRequest(new { title = "Notebook entry ID must be a valid UUID." });
            var body = await BoundedJson(request, ct);
            return body.Error ?? Results.Ok(await notebooks.PutAsync(orgId, current.UserId, id, body.Value!.Value, ct));
        });
        group.MapDelete("/entries/{entryId}", async (Guid orgId, string entryId, string? version, ICurrentUser current,
            ScriptureNotebookService notebooks, CancellationToken ct) =>
        {
            if (orgId != current.OrganizationId) return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization access denied.");
            if (!Guid.TryParseExact(entryId, "D", out var id) || id == Guid.Empty || !long.TryParse(version, NumberStyles.None, CultureInfo.InvariantCulture, out var expected))
                return Results.BadRequest(new { title = "Notebook entry ID and version must be valid." });
            return Results.Ok(await notebooks.DeleteAsync(orgId, current.UserId, id, expected, ct));
        });
    }

    private static async Task<IResult> Read(ScriptureNotebookService notebooks, Guid org, Guid user, CancellationToken ct) =>
        Results.Ok(await notebooks.GetAsync(org, user, ct));

    private sealed record BodyResult(JsonElement? Value, IResult? Error);
    private static async Task<BodyResult> BoundedJson(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentLength > BodyLimit)
            return new(null, Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "Request body is too large."));
        await using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        while (true)
        {
            var read = await request.Body.ReadAsync(chunk, ct);
            if (read == 0) break;
            if (buffer.Length + read > BodyLimit)
                return new(null, Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "Request body is too large."));
            await buffer.WriteAsync(chunk.AsMemory(0, read), ct);
        }
        try
        {
            using var document = JsonDocument.Parse(buffer.ToArray());
            return new(document.RootElement.Clone(), null);
        }
        catch (JsonException)
        {
            return new(null, Results.BadRequest(new { title = "Invalid JSON request." }));
        }
    }
}
