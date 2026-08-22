namespace Erudoza.Domain.Study;

public static class ReferenceMatchGenerator
{
    public const string ActivityType = "ReferenceMatch";
    public const string ProviderType = "ReferenceMatchActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(
        SourceUnit unit,
        IReadOnlyList<string> distractorCitations,
        int seed,
        bool allowChoices)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var random = new Random(seed);
        var choices = allowChoices
            ? new[] { unit.CitationLabel }
                .Concat(distractorCitations.Where(item => !string.Equals(item, unit.CitationLabel, StringComparison.OrdinalIgnoreCase)))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(4)
                .OrderBy(_ => random.Next())
                .ToList()
            : null;

        var payload = new ActivityPayload(
            unit.CitationLabel,
            "Match the assigned Scripture to its reference.",
            [],
            1,
            choices);
        return (payload, ActivitySerialization.AnswerKey(unit.CitationLabel));
    }
}
