namespace Erudoza.Domain.Study;

public sealed record MissingWordAnswer(int Index, string Text);

public sealed record MissingWordResult(int Index, bool IsCorrect, string Expected);

public sealed record MissingWordAnswerPayload(string Format, IReadOnlyList<MissingWordAnswer> Answers, IReadOnlyList<MissingWordResult> Results)
{
    public const string CurrentFormat = "missing-words-slots/v1";
    private static readonly System.Text.Json.JsonSerializerOptions Json = new(System.Text.Json.JsonSerializerDefaults.Web);
    public string Serialize() => System.Text.Json.JsonSerializer.Serialize(this, Json);
    public static MissingWordAnswerPayload? Read(string? json) => json is null ? null : System.Text.Json.JsonSerializer.Deserialize<MissingWordAnswerPayload>(json, Json);
}

public sealed record MissingWordEvaluation(bool IsCorrect, IReadOnlyList<MissingWordResult> Results);

public static class MissingWordAnswers
{
    public static MissingWordEvaluation Evaluate(
        IReadOnlyList<MissingWordsToken> tokens,
        IReadOnlyList<MissingWordAnswer> answers)
    {
        if (tokens is null || answers is null)
        {
            throw InvalidAnswers();
        }

        var tokenIndices = new HashSet<int>();
        foreach (var token in tokens)
        {
            if (!tokenIndices.Add(token.Index))
            {
                throw InvalidAnswers();
            }
        }

        var hidden = tokens.Where(token => token.Hidden).ToList();
        var hiddenIndices = hidden.Select(token => token.Index).ToHashSet();
        var submitted = new Dictionary<int, string>();
        foreach (var answer in answers)
        {
            if (answer is null || answer.Text is null || !hiddenIndices.Contains(answer.Index) ||
                !submitted.TryAdd(answer.Index, answer.Text))
            {
                throw InvalidAnswers();
            }
        }

        if (submitted.Count != hidden.Count)
        {
            throw InvalidAnswers();
        }

        var results = hidden.Select(token =>
        {
            var text = submitted[token.Index];
            var normalizedExpected = TextNormalization.Normalize(token.Text, NormalizationProfile.ExactText);
            var normalizedSubmitted = TextNormalization.Normalize(text, NormalizationProfile.ExactText);
            var isCorrect = normalizedExpected.Length > 0
                ? normalizedSubmitted.Length > 0 && normalizedSubmitted == normalizedExpected
                : text.Trim().Length > 0 && string.Equals(text.Trim(), token.Text.Trim(), StringComparison.Ordinal);
            return new MissingWordResult(token.Index, isCorrect, token.Text);
        }).ToList();

        return new MissingWordEvaluation(results.All(result => result.IsCorrect), results);
    }

    private static DomainException InvalidAnswers() => new("Invalid missing-word answers.");
}
