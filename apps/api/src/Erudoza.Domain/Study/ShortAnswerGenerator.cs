namespace Erudoza.Domain.Study;

public static class ShortAnswerGenerator
{
    public const string ActivityType = "ShortAnswer";
    public const string ProviderType = "PlayableShortAnswerActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(QuestionCandidate question, SourceUnit unit)
    {
        ArgumentNullException.ThrowIfNull(question);
        ArgumentNullException.ThrowIfNull(unit);
        var payload = new ActivityPayload(unit.CitationLabel, question.Prompt, [], question.Difficulty);
        return (payload, ActivitySerialization.AnswerKey(question.CanonicalAnswer));
    }
}
