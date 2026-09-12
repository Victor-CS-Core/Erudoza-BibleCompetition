using System.Text.Json;

namespace Erudoza.Domain.Study;

public sealed record ActivityPayload(
    string Citation,
    string Prompt,
    IReadOnlyList<MissingWordsToken> Tokens,
    int Difficulty,
    IReadOnlyList<string>? Choices = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? GeneratorVersion = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? EvidenceProfile = null);

public sealed record ActivityAnswerKey(string CanonicalAnswer, IReadOnlyList<string>? HiddenWords = null);

public static class ActivitySerialization
{
    public static string Payload(ActivityPayload payload) => JsonSerializer.Serialize(payload);

    public static string AnswerKey(string canonicalAnswer, IReadOnlyList<string>? hidden = null) =>
        JsonSerializer.Serialize(new ActivityAnswerKey(canonicalAnswer, hidden));

    public static ActivityPayload ReadPayload(string json) =>
        JsonSerializer.Deserialize<ActivityPayload>(json)
        ?? throw new DomainException("Challenge payload is invalid.");

    public static ActivityAnswerKey ReadAnswerKey(string json) =>
        JsonSerializer.Deserialize<ActivityAnswerKey>(json)
        ?? throw new DomainException("Challenge card is missing an answer key.");
}
