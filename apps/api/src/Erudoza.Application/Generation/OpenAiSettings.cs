namespace Erudoza.Application.Generation;

public static class OpenAiSettings
{
    public static string? ResolveApiKey(string? configuredKey, string? environmentKey) =>
        string.IsNullOrWhiteSpace(configuredKey) ? environmentKey : configuredKey;

    public static bool CanGenerate(bool enabledFlag, string? apiKey) =>
        enabledFlag && !string.IsNullOrWhiteSpace(apiKey);
}
