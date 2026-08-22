namespace Erudoza.Domain.Study;

public sealed record EvaluationResult(
    bool IsCorrect,
    string EvaluationCode,
    string NormalizedSubmitted,
    string NormalizedCanonical,
    string EvaluatorVersion);

public static class ExactTextEvaluator
{
    public const string Version = "exact-text-v1";

    public static EvaluationResult Evaluate(string submittedAnswer, string canonicalAnswer)
    {
        var normalizedSubmitted = TextNormalization.Normalize(submittedAnswer, NormalizationProfile.ExactText);
        var normalizedCanonical = TextNormalization.Normalize(canonicalAnswer, NormalizationProfile.ExactText);
        var isCorrect = string.Equals(normalizedSubmitted, normalizedCanonical, StringComparison.Ordinal);

        return new EvaluationResult(
            isCorrect,
            isCorrect ? "ExactMatch" : "Incorrect",
            normalizedSubmitted,
            normalizedCanonical,
            Version);
    }
}
