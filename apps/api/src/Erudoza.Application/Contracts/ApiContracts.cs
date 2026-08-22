using Erudoza.Domain;

namespace Erudoza.Application.Contracts;

public sealed record LoginRequest(string Identifier, string Password);

public sealed record MeDto(
    Guid UserId,
    Guid OrganizationId,
    string OrganizationName,
    string DisplayName,
    string UserName,
    string? Email,
    string Kind,
    string Role);

public sealed record OrganizationDto(Guid Id, string Name, string Slug);

public sealed record SeasonDto(
    Guid Id,
    Guid OrganizationId,
    string Name,
    string YearLabel,
    string Status,
    string RuleProfileKey,
    int RuleProfileVersion,
    DateOnly? StartDate,
    DateOnly? TargetCompetitionDate,
    int ScopeUnitCount,
    int AssignmentCount);

public sealed record CreateSeasonRequest(
    string Name,
    string YearLabel,
    string RuleProfileKey,
    DateOnly? StartDate,
    DateOnly? TargetCompetitionDate);

public sealed record StudentDto(Guid UserId, string UserName, string DisplayName, string? Email);

public sealed record CreateStudentRequest(string UserName, string DisplayName, string Password);

public sealed record ContentPackDto(
    Guid Id,
    string PackKey,
    int Version,
    string Locale,
    string SourceType,
    string LicensingStatus,
    int UnitCount);

public sealed record SourceUnitDto(
    Guid Id,
    string Citation,
    string BookKey,
    int Chapter,
    int Verse,
    int Ordinal,
    string CanonicalText);

public sealed record ImportDocumentDto(string Name, IReadOnlyList<ImportUnitDto> Units);

public sealed record ImportUnitDto(
    string Citation,
    string BookKey,
    int Chapter,
    int Verse,
    int Ordinal,
    string Text);

public sealed record ImportContentPackRequest(
    string PackKey,
    int Version,
    string Locale,
    string SourceType,
    IReadOnlyList<ImportDocumentDto> Documents);

public sealed record ScopeRangeDto(
    string BookKey,
    int StartChapter,
    int StartVerse,
    int EndChapter,
    int EndVerse);

public sealed record DefineScopeRequest(
    Guid ContentPackId,
    IReadOnlyList<ScopeRangeDto> Includes,
    IReadOnlyList<ScopeRangeDto>? Excludes);

public sealed record CreateAssignmentRequest(
    Guid StudentUserId,
    AssignmentType Type,
    Guid ContentPackId,
    ScopeRangeDto Range);

public sealed record AssignmentDto(
    Guid Id,
    Guid StudentUserId,
    string Type,
    string BookKey,
    int StartChapter,
    int StartVerse,
    int EndChapter,
    int EndVerse);

public sealed record ActivationResultDto(bool Activated, IReadOnlyList<string> BlockingProblems);

public sealed record StartSessionRequest(Guid SeasonId, StudyMode Mode);

public sealed record SessionDto(Guid Id, Guid SeasonId, string Status, string Mode, int TargetCardCount);

public sealed record ChallengeCardDto(
    Guid Id,
    Guid SessionId,
    string ActivityType,
    string Citation,
    string Prompt,
    IReadOnlyList<ChallengeTokenDto> Tokens,
    int Sequence,
    int Total,
    string? DebugAnswer);

public sealed record ChallengeTokenDto(string Display, bool Hidden, int Index);

public sealed record SubmitAttemptRequest(
    string ClientSubmissionId,
    Guid ChallengeCardId,
    string SubmittedAnswer,
    int ResponseTimeMs,
    bool HintsUsed);

public sealed record AttemptResultDto(
    Guid AttemptId,
    bool IsCorrect,
    string EvaluationResult,
    string CanonicalAnswer,
    string Citation,
    string SourceText,
    string MasteryLevel,
    int ExactWordingScore,
    DateTimeOffset? ReviewDueAtUtc,
    bool AlreadyProcessed);

public sealed record ProgressDto(
    Guid SeasonId,
    string SeasonName,
    string SeasonStatus,
    IReadOnlyList<AssignmentDto> Assignments,
    int MasteredCount,
    int ReviewDueCount,
    int AttemptCount,
    IReadOnlyList<MasteryRowDto> Mastery);

public sealed record MasteryRowDto(
    Guid KnowledgeUnitId,
    string Title,
    string Level,
    int ExactWordingScore,
    int RecognitionScore,
    DateTimeOffset? ReviewDueAtUtc);
