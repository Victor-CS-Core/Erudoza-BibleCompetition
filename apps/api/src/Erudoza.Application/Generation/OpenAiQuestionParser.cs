using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;

namespace Erudoza.Application.Generation;

public static class OpenAiQuestionParser
{
    public static QuestionCandidateData? TryParse(string completionJson, IReadOnlyList<SourceUnit> units)
    {
        if (string.IsNullOrWhiteSpace(completionJson) || units.Count == 0)
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(completionJson);
            if (!document.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
            {
                return null;
            }

            var content = choices[0].GetProperty("message").GetProperty("content").GetString();
            if (string.IsNullOrWhiteSpace(content))
            {
                return null;
            }

            using var body = JsonDocument.Parse(content);
            var root = body.RootElement;
            var prompt = ReadString(root, "prompt");
            var canonical = ReadString(root, "canonicalAnswer");
            var evidenceText = ReadString(root, "evidenceText");
            if (string.IsNullOrWhiteSpace(prompt) || string.IsNullOrWhiteSpace(canonical) || string.IsNullOrWhiteSpace(evidenceText))
            {
                return null;
            }

            var sourceId = ReadGuid(root, "sourceUnitId") ?? units[0].Id;
            var unit = units.FirstOrDefault(item => item.Id == sourceId);
            if (unit is null)
            {
                return null;
            }

            var accepted = ReadStrings(root, "acceptedAnswers");
            if (!accepted.Contains(canonical, StringComparer.OrdinalIgnoreCase))
            {
                accepted.Insert(0, canonical);
            }

            return new QuestionCandidateData(
                "1",
                ReadString(root, "questionType") ?? "ShortFact",
                prompt,
                nameof(AnswerMode.ShortFact),
                canonical,
                accepted,
                [new QuestionEvidenceItem(unit.Id, evidenceText)],
                2,
                ReadString(root, "explanation"),
                "openai-chat-v1");
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static Guid? ReadGuid(JsonElement root, string name) =>
        Guid.TryParse(ReadString(root, name), out var parsed) ? parsed : null;

    private static List<string> ReadStrings(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return value.EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null)
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Cast<string>()
            .ToList();
    }
}
