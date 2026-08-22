namespace Erudoza.Domain.Study;

public static class TrueFalseGenerator
{
    public const string ActivityType = "TrueFalse";
    public const string ProviderType = "TrueFalseActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(
        SourceUnit unit,
        SourceUnit? distractor,
        int seed)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var isTrue = distractor is null || seed % 2 == 0;
        var statement = isTrue ? unit.CanonicalText : distractor!.CanonicalText;
        var prompt = $"According to {unit.CitationLabel}, is this the stored wording? {statement}";
        var payload = new ActivityPayload(unit.CitationLabel, prompt, [], 1);
        return (payload, ActivitySerialization.AnswerKey(isTrue ? "True" : "False"));
    }
}
