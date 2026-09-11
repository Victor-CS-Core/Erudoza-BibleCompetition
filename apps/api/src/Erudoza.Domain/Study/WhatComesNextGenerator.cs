namespace Erudoza.Domain.Study;

public static class WhatComesNextGenerator
{
    public const string ActivityType = "WhatComesNext";
    public const string ProviderType = "WhatComesNextActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(SourceUnit current, SourceUnit next, int difficulty = 3, bool allowSupport = false)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(next);
        var words = next.CanonicalText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var answer = difficulty <= 1 && allowSupport ? string.Join(' ', words.Take(4)) : next.CanonicalText;
        var instruction = difficulty <= 1 && allowSupport
            ? $"Write the first {Math.Min(4, words.Length)} words of the next verse."
            : "Write the full next verse.";
        if (difficulty == 3 && allowSupport && words.Length > 0)
            instruction += $" It starts with: {words[0]}";
        var payload = new ActivityPayload(
            current.CitationLabel,
            $"What comes next after {current.CitationLabel}? {instruction}",
            [],
            difficulty);
        return (payload, ActivitySerialization.AnswerKey(answer));
    }
}
