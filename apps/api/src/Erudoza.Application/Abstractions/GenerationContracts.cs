namespace Erudoza.Application.Abstractions;

public sealed record QuestionEvidenceItem(Guid SourceUnitId, string EvidenceText);

public sealed record QuestionCandidateData(
    string SchemaVersion,
    string QuestionType,
    string Prompt,
    string AnswerMode,
    string CanonicalAnswer,
    IReadOnlyList<string> AcceptedAnswers,
    IReadOnlyList<QuestionEvidenceItem> SourceEvidence,
    int Difficulty,
    string? Explanation,
    string GeneratorVersion);

public sealed record QuestionGenerationContext(
    Guid OrganizationId,
    Guid SeasonId,
    IReadOnlyList<Guid> SourceUnitIds);

public sealed record QuestionValidationContext(
    Guid OrganizationId,
    Guid SeasonId,
    IReadOnlySet<Guid> AllowedSourceUnitIds);

public sealed record QuestionValidationResult(bool IsValid, IReadOnlyList<string> Errors)
{
    public static QuestionValidationResult Success() => new(true, []);
    public static QuestionValidationResult Failure(params string[] errors) => new(false, errors);
}

public interface IGenerativeQuestionService
{
    Task<QuestionCandidateData> GenerateAsync(
        QuestionGenerationContext context,
        CancellationToken cancellationToken);
}

public interface IQuestionCandidateValidator
{
    Task<QuestionValidationResult> ValidateAsync(
        QuestionCandidateData candidate,
        QuestionValidationContext context,
        CancellationToken cancellationToken);
}

public interface IQuestionLifecycleService
{
    Task<Guid> PromoteValidatedCandidateAsync(
        QuestionCandidateData candidate,
        QuestionValidationContext context,
        CancellationToken cancellationToken);
}
