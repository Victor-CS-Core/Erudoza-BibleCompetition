namespace Erudoza.Api.Operations;

public static class ProductionSafety
{
    public static void Validate(IConfiguration configuration, IHostEnvironment environment)
    {
        if (!environment.IsProduction()) return;
        if (configuration.GetValue("Seed:Enabled", false) || configuration.GetValue("ExposeDebugAnswers", false))
            throw new InvalidOperationException("Production must disable demo seeding and debug answers.");
        if (!Uri.TryCreate(configuration["PUBLIC_ORIGIN"], UriKind.Absolute, out var origin) || origin.Scheme != "https")
            throw new InvalidOperationException("Production requires an HTTPS PUBLIC_ORIGIN.");
        if (string.IsNullOrWhiteSpace(configuration["DataProtection:KeyPath"]))
            throw new InvalidOperationException("Production requires a persistent DataProtection:KeyPath.");
        if (string.IsNullOrWhiteSpace(configuration["Database:ConnectionString"]) || configuration["Database:ConnectionString"]!.Contains("erudoza.dev.db", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Production requires an explicit database connection.");
    }
}
