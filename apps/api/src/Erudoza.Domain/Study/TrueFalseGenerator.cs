namespace Erudoza.Domain.Study;

public static class TrueFalseGenerator
{
    public const string ActivityType = "TrueFalse";
    public const string ProviderType = "TrueFalseActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(
        SourceUnit unit,
        SourceUnit? distractor,
        int seed, int difficulty = 3)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var isTrue = distractor is null || seed % 2 == 0;
        var statement = isTrue ? unit.CanonicalText : distractor!.CanonicalText;
        if (difficulty <= 1)
            statement = string.Join(' ', statement.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(4));
        var expectedStatement = difficulty <= 1
            ? string.Join(' ', unit.CanonicalText.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(4))
            : unit.CanonicalText;
        isTrue = string.Equals(statement, expectedStatement, StringComparison.Ordinal);
        var prompt = $"According to {unit.CitationLabel}, is this {(difficulty <= 1 ? "the beginning of the stored wording" : "the stored wording")}? {statement}";
        var payload = new ActivityPayload(unit.CitationLabel, prompt, [], difficulty);
        return (payload, ActivitySerialization.AnswerKey(isTrue ? "True" : "False"));
    }
}
