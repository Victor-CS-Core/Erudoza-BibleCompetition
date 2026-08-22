namespace Erudoza.Domain.Study;

public static class WhatComesNextGenerator
{
    public const string ActivityType = "WhatComesNext";
    public const string ProviderType = "WhatComesNextActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(SourceUnit current, SourceUnit next)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(next);
        var payload = new ActivityPayload(
            current.CitationLabel,
            $"What comes next after {current.CitationLabel}?",
            [],
            2);
        return (payload, ActivitySerialization.AnswerKey(next.CanonicalText));
    }
}
