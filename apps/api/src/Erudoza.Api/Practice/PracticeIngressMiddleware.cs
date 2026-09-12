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
            try { await next(context); }
            finally { (context.Items[PbeStampKey] as Erudoza.Application.Study.PbeSoloIngress)?.Complete(); }
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
        // Allocate ordering ownership immediately after the bounded body is complete,
        // before parsing or authentication can yield and reorder already-arrived commands.
        using var admission = runtime.Admit(room);
        using var ordered = await runtime.EnterIngress(room, context.RequestAborted);
        context.Request.Body.Position = 0;
        try
        {
            using var payload = await System.Text.Json.JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            var action = payload.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object
                ? payload.RootElement.EnumerateObject().LastOrDefault(p => p.Name.Equals("action", StringComparison.OrdinalIgnoreCase)).Value : default;
            if (action.ValueKind != System.Text.Json.JsonValueKind.String || action.GetString() is not ("submit" or "ack" or "draft" or "present")) admission.Dispose();

        }
        catch (System.Text.Json.JsonException) { context.Response.StatusCode = 400; return; }
        context.Request.Body.Position = 0;
        context.Items[StampKey] = captured;
        await next(context);
    }
}
