using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Generation;
using Microsoft.Extensions.Configuration;

namespace Erudoza.Infrastructure.Generation;

public sealed class OpenAiGenerativeQuestionService(
    IHttpClientFactory httpFactory,
    IConfiguration configuration,
    FakeGenerativeQuestionService fallback) : IGenerativeQuestionService
{
    public async Task<QuestionCandidateData> GenerateAsync(
        QuestionGenerationContext context,
        CancellationToken cancellationToken)
    {
        var enabled = configuration.GetValue("OpenAI:Enabled", false);
        var apiKey = configuration["OpenAI:ApiKey"];
        if (!enabled || string.IsNullOrWhiteSpace(apiKey))
        {
            return await fallback.GenerateAsync(context, cancellationToken);
        }

        var client = httpFactory.CreateClient("openai");
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        var request = new
        {
            model = configuration["OpenAI:Model"] ?? "gpt-4.1-mini",
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new { role = "system", content = "Create one short-answer factual question from the provided source units only. Never invent Scripture wording. Return JSON with prompt, canonicalAnswer, acceptedAnswers, evidenceText." },
                new { role = "user", content = JsonSerializer.Serialize(context) }
            }
        };

        using var response = await client.PostAsJsonAsync("https://api.openai.com/v1/chat/completions", request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return await fallback.GenerateAsync(context, cancellationToken);
        }

        return await fallback.GenerateAsync(context, cancellationToken);
    }
}
