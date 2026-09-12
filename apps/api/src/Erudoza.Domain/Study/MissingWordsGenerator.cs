using System.Text.Json;

namespace Erudoza.Domain.Study;

public sealed record MissingWordsToken(string Text, bool Hidden, int Index);

public sealed record MissingWordsPayload(
    string Citation,
    string Prompt,
    IReadOnlyList<MissingWordsToken> Tokens,
    int Difficulty,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? GeneratorVersion = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? EvidenceProfile = null);

public sealed record MissingWordsAnswerKey(string CanonicalAnswer, IReadOnlyList<string> HiddenWords);

public sealed record MissingWordsCard(
    MissingWordsPayload Payload,
    MissingWordsAnswerKey AnswerKey,
    string PayloadJson,
    string AnswerKeyJson);

public static class MissingWordsGenerator
{
    public const string ActivityType = "MissingWords";
    public const string ProviderType = "MissingWordsActivityProvider";

    public static MissingWordsCard Create(SourceUnit unit, int difficulty, int seed, string? generatorVersion = null, string? evidenceProfile = null)
    {
        ArgumentNullException.ThrowIfNull(unit);
        if (string.IsNullOrWhiteSpace(unit.CanonicalText))
        {
            throw new DomainException("Missing Words requires stored canonical source text.");
        }

        var tokens = unit.CanonicalText
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select((text, index) => new MissingWordsToken(text, false, index))
            .ToList();

        var hideCount = ResolveHideCount(tokens.Count, difficulty);
        var hideable = tokens
            .Where(token => token.Text.Any(char.IsLetter) && token.Text.Length > 2)
            .Select(token => token.Index)
            .ToList();

        if (hideable.Count == 0)
        {
            hideable = tokens.Select(token => token.Index).ToList();
        }

        if (generatorVersion == "memory-v3" && evidenceProfile == "memory-cued-v3")
        {
            var eligibleCount = hideable.Count;
            hideCount = eligibleCount <= 1 ? eligibleCount : Math.Min(eligibleCount - 1, Math.Max(1, (int)Math.Ceiling(eligibleCount * 0.7)));
        }
        var random = new Random(seed);
        var shuffled = hideable.OrderBy(_ => random.Next()).Take(hideCount).ToHashSet();
        var hiddenTokens = tokens
            .Select(token => token with { Hidden = shuffled.Contains(token.Index) })
            .ToList();

        var hiddenWords = hiddenTokens.Where(token => token.Hidden).Select(token => token.Text).ToList();
        var prompt = string.Join(' ', hiddenTokens.Select(token => token.Hidden ? "____" : token.Text));
        var payload = new MissingWordsPayload(unit.CitationLabel, prompt, hiddenTokens, difficulty, generatorVersion, evidenceProfile);
        var answerKey = new MissingWordsAnswerKey(string.Join(' ', hiddenWords), hiddenWords);

        return new MissingWordsCard(
            payload,
            answerKey,
            JsonSerializer.Serialize(payload),
            JsonSerializer.Serialize(answerKey));
    }

    public static int StableSeed(Guid sourceUnitId, Guid sessionId, int sequence)
    {
        // Stable across processes, unlike the randomized HashCode salt.
        uint hash = 2166136261;
        foreach (var value in sourceUnitId.ToByteArray().Concat(sessionId.ToByteArray()))
            hash = unchecked((hash ^ value) * 16777619);
        return unchecked((int)((hash ^ (uint)sequence) * 16777619));
    }

    private static int ResolveHideCount(int tokenCount, int difficulty)
    {
        var boundedDifficulty = Math.Clamp(difficulty, 1, 5);
        return boundedDifficulty switch
        {
            1 => 1,
            2 => Math.Max(2, tokenCount / 6),
            3 => Math.Max(3, tokenCount / 4),
            4 => Math.Max(4, tokenCount / 2),
            _ => Math.Max(1, tokenCount - 1)
        };
    }
}
