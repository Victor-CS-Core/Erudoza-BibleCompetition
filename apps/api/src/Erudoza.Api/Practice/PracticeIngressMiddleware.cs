namespace Erudoza.Api.Practice;

/// <summary>Capture complete command receipt before authentication, command queuing, or grading.</summary>
public sealed class PracticeIngressMiddleware(RequestDelegate next)
{
    public const string StampKey = "practice-ingress";
    public const string PbeStampKey = "pbe-solo-ingress";
    public async Task InvokeAsync(HttpContext context, PracticeRuntime runtime, Erudoza.Application.Study.IPbeSoloTimingAuthority solo)
    {
        var segments = context.Request.Path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries) ?? [];
        if (context.Request.Method == "POST" && segments.Length == 6 && segments[0] == "api" && segments[1] == "v1" && segments[2] == "study" && segments[3] == "sessions" && segments[5] == "timed" && Guid.TryParse(segments[4], out var session))
        {
            if (context.Request.ContentLength > 32768) { context.Response.StatusCode = 413; return; }
            context.Request.EnableBuffering(32768, 32768);
            try { var buffer = new byte[4096]; while (await context.Request.Body.ReadAsync(buffer, context.RequestAborted) > 0) { } }
            catch (IOException) { context.Response.StatusCode = 413; return; }
            try { context.Items[PbeStampKey] = solo.CaptureIfActive(session); }
            catch (Erudoza.Application.Study.PbePendingLimitException) { context.Response.StatusCode = 429; return; }
            context.Request.Body.Position = 0;
            await next(context);
            return;
        }
        if (context.Request.Method != "POST" || segments.Length != 8 || segments[0] != "api" || segments[1] != "v1"
            || segments[2] != "organizations" || segments[4] != "practice" || segments[5] != "rooms" || segments[7] != "commands"
            || !Guid.TryParse(segments[6], out var room)) { await next(context); return; }
        if (context.Request.ContentLength > 32768) { context.Response.StatusCode = 413; return; }
        context.Request.EnableBuffering(32768, 32768);
        try
        {
            var buffer = new byte[4096];
            while (await context.Request.Body.ReadAsync(buffer, context.RequestAborted) > 0) { }
        }
        catch (IOException) { context.Response.StatusCode = 413; return; }
        var captured = runtime.Stamp();
        context.Request.Body.Position = 0;
        System.Text.Json.JsonDocument payload;
        try { payload = await System.Text.Json.JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted); }
        catch (System.Text.Json.JsonException) { context.Response.StatusCode = 400; return; }
        using var parsedPayload = payload;
        context.Request.Body.Position = 0;
        var action = payload.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object
            ? payload.RootElement.EnumerateObject().LastOrDefault(p => p.Name.Equals("action", StringComparison.OrdinalIgnoreCase)).Value : default;
        var isSubmission = action.ValueKind == System.Text.Json.JsonValueKind.String && action.GetString() is "submit" or "ack";
        // Admission prevents a timer transition from overtaking an already received command.
        using var admission = isSubmission ? runtime.Admit(room) : null;
        context.Items[StampKey] = captured;
        await next(context);
    }
}
