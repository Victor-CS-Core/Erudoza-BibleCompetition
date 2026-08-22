namespace Erudoza.Api.Auth;

public sealed class CorrelationMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-ID";
    public const string ItemKey = "Erudoza.CorrelationId";

    public async Task Invoke(HttpContext context)
    {
        var correlationId = context.Request.Headers[HeaderName].FirstOrDefault() ?? Guid.NewGuid().ToString("N");
        context.Items[ItemKey] = correlationId;
        context.Response.Headers[HeaderName] = correlationId;
        await next(context);
    }
}
