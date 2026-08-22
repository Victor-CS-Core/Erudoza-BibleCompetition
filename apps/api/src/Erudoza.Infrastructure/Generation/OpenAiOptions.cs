using Erudoza.Application.Generation;
using Microsoft.Extensions.Configuration;

namespace Erudoza.Infrastructure.Generation;

public static class OpenAiOptions
{
    public static bool TryResolve(IConfiguration configuration, out string apiKey, out string model)
    {
        var configured = OpenAiSettings.ResolveApiKey(
            configuration["OpenAI:ApiKey"],
            configuration["OPENAI_API_KEY"]);
        var enabled = configuration.GetValue("OpenAI:Enabled", true);
        model = configuration["OpenAI:Model"] ?? "gpt-4.1-mini";
        apiKey = configured ?? string.Empty;
        return OpenAiSettings.CanGenerate(enabled, configured);
    }
}
