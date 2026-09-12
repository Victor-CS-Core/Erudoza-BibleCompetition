using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Erudoza.Domain.Practice;

[JsonConverter(typeof(ExactEnumJsonConverter<RecallSkill>))]
public enum RecallSkill { FactualRecall, ExactWords }
[JsonConverter(typeof(ExactEnumJsonConverter<PbeSourceKind>))]
public enum PbeSourceKind { Scripture, Commentary }
[JsonConverter(typeof(ExactEnumJsonConverter<PbeQuestionKind>))]
public enum PbeQuestionKind { ShortAnswer, List, ExactWords, TrueFalse }

public sealed class ExactEnumJsonConverter<TEnum> : JsonConverter<TEnum> where TEnum : struct, Enum
{
    public override TEnum Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException($"{typeof(TEnum).Name} requires an exact string name.");
        var value = reader.GetString();
        foreach (var name in Enum.GetNames<TEnum>())
            if (string.Equals(value, name, StringComparison.Ordinal)) return Enum.Parse<TEnum>(name);
        throw new JsonException($"Unsupported {typeof(TEnum).Name} value.");
    }

    public override void Write(Utf8JsonWriter writer, TEnum value, JsonSerializerOptions options)
    {
        var name = Enum.GetName(value) ?? throw new JsonException($"Unsupported {typeof(TEnum).Name} value.");
        writer.WriteStringValue(name);
    }
}

public sealed class PbeTarget
{
    [JsonRequired] public Guid Id { get; set; }
    [JsonRequired] public List<Guid> SourceUnitIds { get; set; } = [];
    [JsonRequired, JsonConverter(typeof(ExactEnumJsonConverter<RecallSkill>))] public RecallSkill Skill { get; set; }
    [JsonRequired] public string Label { get; set; } = "";
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class PbeQuestionPart
{
    [JsonRequired] public Guid TargetId { get; set; }
    [JsonRequired] public List<string> AcceptedAnswers { get; set; } = [];
    [JsonRequired] public int Points { get; set; }
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class PbeQuestion
{
    [JsonRequired] public int SchemaVersion { get; set; }
    [JsonRequired] public Guid Id { get; set; }
    [JsonRequired] public int Version { get; set; }
    [JsonRequired] public Guid ContentPackId { get; set; }
    [JsonRequired] public Guid SourceUnitId { get; set; }
    [JsonRequired] public List<Guid> SourceUnitIds { get; set; } = [];
    [JsonRequired, JsonConverter(typeof(ExactEnumJsonConverter<PbeSourceKind>))] public PbeSourceKind SourceKind { get; set; }
    [JsonRequired] public string Reference { get; set; } = "";
    [JsonRequired] public string Evidence { get; set; } = "";
    [JsonRequired, JsonConverter(typeof(ExactEnumJsonConverter<PbeQuestionKind>))] public PbeQuestionKind Kind { get; set; }
    [JsonRequired] public string Prompt { get; set; } = "";
    [JsonRequired] public bool Ordered { get; set; }
    [JsonRequired] public List<PbeQuestionPart> Parts { get; set; } = [];
    [JsonExtensionData] public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed record PbeGradePart(int Index, Guid TargetId, int? AnswerIndex, int EarnedPoints, int AvailablePoints);
public sealed record PbeGrade(int EarnedPoints, int AvailablePoints, IReadOnlyList<PbeGradePart> Parts);

public static partial class PbeRubric
{
    public static void Validate(PbeQuestion question, IReadOnlyList<PbeTarget> targets)
    {
        ArgumentNullException.ThrowIfNull(question);
        ArgumentNullException.ThrowIfNull(targets);
        if (HasExtra(question.Extra)) throw new ArgumentException("Malformed PBE question.");
        if (question.SchemaVersion != 2 || question.Id == Guid.Empty || question.ContentPackId == Guid.Empty || question.SourceUnitId == Guid.Empty || question.Version < 1)
            throw new ArgumentException("PBE question identity and version are invalid.");
        if (!ValidIds(question.SourceUnitIds) || !question.SourceUnitIds.Contains(question.SourceUnitId) || !Enum.IsDefined(question.SourceKind) || !Enum.IsDefined(question.Kind) || !Text(question.Reference) || !Text(question.Evidence) || !Text(question.Prompt))
            throw new ArgumentException("PBE question source and prompt are invalid.");
        if (targets.Count is < 1 or > 50 || targets.Any(target => target is null || HasExtra(target.Extra) || target.Id == Guid.Empty || !ValidIds(target.SourceUnitIds) || !Enum.IsDefined(target.Skill) || !Text(target.Label)) || targets.Select(target => target.Id).Distinct().Count() != targets.Count)
            throw new ArgumentException("PBE targets are invalid.");
        if (question.Parts is null || question.Parts.Count is < 1 or > 50) throw new ArgumentException("PBE question parts are invalid.");
        var byId = targets.ToDictionary(target => target.Id);
        var covered = new HashSet<Guid>();
        var total = 0;
        foreach (var part in question.Parts)
        {
            if (part is null || HasExtra(part.Extra) || part.TargetId == Guid.Empty || part.Points is < 1 or > 8 || part.AcceptedAnswers is null || part.AcceptedAnswers.Count is < 1 or > 50 || part.AcceptedAnswers.Any(answer => !Text(answer, 2_000)))
                throw new ArgumentException("PBE question parts are invalid.");
            if (!byId.TryGetValue(part.TargetId, out var target)) throw new ArgumentException("PBE question part references an unknown target.");
            if (question.Kind == PbeQuestionKind.ExactWords && target.Skill != RecallSkill.ExactWords) throw new ArgumentException("Exact-words questions require exact-words targets.");
            foreach (var source in target.SourceUnitIds)
            {
                if (!question.SourceUnitIds.Contains(source)) throw new ArgumentException("Target source is outside the question source coverage.");
                covered.Add(source);
            }
            total += part.Points;
        }
        _ = PbeRules.ResponseSeconds(total);
        if (question.SourceUnitIds.Any(source => !covered.Contains(source))) throw new ArgumentException("Question source coverage must be covered by its targets.");
        if (question.Kind == PbeQuestionKind.TrueFalse && (question.Parts.Count != 1 || question.Parts[0].AcceptedAnswers.Select(Normalize).Distinct().Count() != 1 || question.Parts[0].AcceptedAnswers.Any(answer => Normalize(answer) is not ("TRUE" or "FALSE"))))
            throw new ArgumentException("True/false questions require one unambiguous answer.");
    }

    public static PbeGrade Grade(PbeQuestion question, IReadOnlyList<string> answers)
    {
        ValidateForGrade(question, answers);
        var submitted = answers.Select(Normalize).ToArray();
        var accepted = question.Parts.Select(part => part.AcceptedAnswers.Select(Normalize).ToHashSet(StringComparer.Ordinal)).ToArray();
        var answerForPart = Enumerable.Repeat(-1, question.Parts.Count).ToArray();
        if (question.Ordered || question.Kind == PbeQuestionKind.ExactWords)
        {
            for (var index = 0; index < question.Parts.Count; index++) if (accepted[index].Contains(submitted[index])) answerForPart[index] = index;
        }
        else
        {
            var partForAnswer = Enumerable.Repeat(-1, answers.Count).ToArray();
            bool Assign(int part, bool[] visited)
            {
                for (var answer = 0; answer < answers.Count; answer++)
                {
                    if (visited[answer] || !accepted[part].Contains(submitted[answer])) continue;
                    visited[answer] = true;
                    var displaced = partForAnswer[answer];
                    if (displaced < 0 || Assign(displaced, visited))
                    {
                        partForAnswer[answer] = part;
                        answerForPart[part] = answer;
                        return true;
                    }
                }
                return false;
            }
            foreach (var part in Enumerable.Range(0, question.Parts.Count).OrderByDescending(index => question.Parts[index].Points).ThenBy(index => index)) Assign(part, new bool[answers.Count]);
        }
        var parts = question.Parts.Select((part, index) => new PbeGradePart(index, part.TargetId, answerForPart[index] < 0 ? null : answerForPart[index], answerForPart[index] < 0 ? 0 : part.Points, part.Points)).ToArray();
        return new(parts.Sum(part => part.EarnedPoints), parts.Sum(part => part.AvailablePoints), parts);
    }

    private static void ValidateForGrade(PbeQuestion question, IReadOnlyList<string> answers)
    {
        ArgumentNullException.ThrowIfNull(question);
        ArgumentNullException.ThrowIfNull(answers);
        if (HasExtra(question.Extra) || question.SchemaVersion != 2 || question.Id == Guid.Empty || question.ContentPackId == Guid.Empty || question.SourceUnitId == Guid.Empty || question.Version < 1 || !ValidIds(question.SourceUnitIds) || !question.SourceUnitIds.Contains(question.SourceUnitId) || !Enum.IsDefined(question.SourceKind) || !Enum.IsDefined(question.Kind) || !Text(question.Reference) || !Text(question.Evidence) || !Text(question.Prompt) || question.Parts is null || question.Parts.Count is < 1 or > 50 || answers.Count != question.Parts.Count || answers.Any(answer => answer is null || answer.Length > 2_000)) throw new ArgumentException("Provide exactly one answer for each PBE part.");
        var total = 0;
        foreach (var part in question.Parts)
        {
            if (part is null || HasExtra(part.Extra) || part.TargetId == Guid.Empty || part.Points is < 1 or > 8 || part.AcceptedAnswers is null || part.AcceptedAnswers.Count is < 1 or > 50 || part.AcceptedAnswers.Any(answer => !Text(answer, 2_000))) throw new ArgumentException("Malformed PBE question parts.");
            total += part.Points;
        }
        _ = PbeRules.ResponseSeconds(total);
    }

    private static bool HasExtra(Dictionary<string, JsonElement>? extra) => extra is { Count: > 0 };
    private static bool ValidIds(List<Guid>? ids) => ids is { Count: > 0 and <= 50 } && ids.All(id => id != Guid.Empty) && ids.Distinct().Count() == ids.Count;
    public static void ValidateTarget(PbeTarget target)
    {
        if (target is null || HasExtra(target.Extra) || target.Id == Guid.Empty || !ValidIds(target.SourceUnitIds) || !Enum.IsDefined(target.Skill) || !Text(target.Label)) throw new ArgumentException("Invalid PBE target.");
    }
    private static bool Text(string? value, int max = 10_000) => value is not null && value.Any(c => !char.IsWhiteSpace(c) && c != '\ufeff') && value.Length <= max;
    private static string Normalize(string text) => Whitespace().Replace(text.Normalize(NormalizationForm.FormC).Trim(), " ").ToUpperInvariant();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
