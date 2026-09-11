namespace Erudoza.Domain.Study;

public static class ReferenceMatchGenerator
{
    public const string ActivityType = "ReferenceMatch";
    public const string ProviderType = "ReferenceMatchActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(
        SourceUnit unit,
        IReadOnlyList<string> distractorCitations,
        int seed,
        bool allowChoices,
        int difficulty = 3)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var random = new Random(seed);
        var choices = allowChoices && difficulty < 5
            && distractorCitations.Any(item => !string.Equals(item, unit.CitationLabel, StringComparison.OrdinalIgnoreCase))
            ? new[] { unit.CitationLabel }
                .Concat(distractorCitations.Where(item => !string.Equals(item, unit.CitationLabel, StringComparison.OrdinalIgnoreCase)))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(difficulty <= 1 ? 2 : 4)
                .OrderBy(_ => random.Next())
                .ToList()
            : null;

        var payload = new ActivityPayload(
            unit.CitationLabel,
            "Match the assigned Scripture to its reference.",
            [],
            difficulty,
            choices);
        return (payload, ActivitySerialization.AnswerKey(unit.CitationLabel));
    }
}
