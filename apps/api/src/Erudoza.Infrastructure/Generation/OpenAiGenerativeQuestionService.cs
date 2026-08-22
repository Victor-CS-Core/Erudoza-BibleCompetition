using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Generation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Erudoza.Infrastructure.Generation;

public sealed class OpenAiGenerativeQuestionService(
    IHttpClientFactory httpFactory,
    IConfiguration configuration,
    IErudozaDbContext db,
    FakeGenerativeQuestionService fallback) : IGenerativeQuestionService
{
    public async Task<QuestionCandidateData> GenerateAsync(
        QuestionGenerationContext context,
        CancellationToken cancellationToken)
    {
        var enabled = configuration.GetValue("OpenAI:Enabled", false);
        var apiKey = configuration["OpenAI:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            apiKey = configuration["OPENAI_API_KEY"];
        }

        if (!enabled || string.IsNullOrWhiteSpace(apiKey))
        {
            return await fallback.GenerateAsync(context, cancellationToken);
        }

        var units = await db.SourceUnits.AsNoTracking()
            .Where(item => item.OrganizationId == context.OrganizationId && context.SourceUnitIds.Contains(item.Id))
            .ToListAsync(cancellationToken);
        if (units.Count == 0)
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
                new
                {
                    role = "system",
                    content = "Create one short-answer factual question from the provided source units only. Never invent Scripture wording. Return JSON with prompt, canonicalAnswer, acceptedAnswers, sourceUnitId, and evidenceText copied exactly from a provided unit."
                },
                new
                {
                    role = "user",
                    content = JsonSerializer.Serialize(new
                    {
                        context.OrganizationId,
                        context.SeasonId,
                        units = units.Select(unit => new
                        {
                            sourceUnitId = unit.Id,
                            unit.CitationLabel,
                            unit.CanonicalText
                        })
                    })
                }
            }
        };

        using var response = await client.PostAsJsonAsync("https://api.openai.com/v1/chat/completions", request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return await fallback.GenerateAsync(context, cancellationToken);
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return OpenAiQuestionParser.TryParse(body, units)
            ?? await fallback.GenerateAsync(context, cancellationToken);
    }
}
