namespace Erudoza.Application.Contracts;

public sealed record PbeQuestionView(
    Guid Id,
    int Version,
    string Prompt,
    string Reference,
    string Kind,
    IReadOnlyList<int> PartPoints,
    int Points,
    int DurationSeconds);

public sealed record PbeIntroductionDto(Guid Id, Guid OrganizationId, Guid SeasonId, string BookKey, string SourceEdition, string Title, string Citation, string LicensingStatus, bool Reviewed, IReadOnlyList<Erudoza.Domain.PbeIntroductionUnit> Units, long Revision, IReadOnlyList<Guid> AssignedStudentIds);

public sealed record PbeChapterCounts(int AssignedPassages, int QuestionCoveredPassages, int TotalTargets,
    int PracticedTargets, int RecalledTargets, int RetainedTargets, int DueTargets, int MissingVariantTargets);
public sealed record PbeProgressScope(string Key, string ScopeVersion);
public sealed record PbeProgressAction(string Mode, string Label, PbeProgressScope ProgressScope);
public sealed record PbeStampSummary(string StampId, string ChapterKey, string Kind, string Label, string ScopeLabel,
    string ScopeVersion, string RuleVersion, DateTimeOffset EarnedAtUtc, bool? MatchesCurrentScope);
public sealed record PbeProgressRow(string Key, string? ParentChapterKey, string Kind, string Label, string ScopeLabel,
    Guid ContentPackId, string BookKey, int? Chapter, bool? WholeChapterAssigned, PbeChapterCounts Counts,
    string CurrentReadiness, PbeStampSummary? Stamp, bool HasHistoricalStamps, IReadOnlyList<PbeProgressAction> Actions);
public sealed record PbeChapterWork(string? Id, string State, string? Stage, string? Reason);
public sealed record PbeChapterPage(Guid SeasonId, string RuleVersion, string? ScopeVersion, string? SnapshotId,
    string? ChapterKey, PbeChapterWork Work, bool CurrentAvailable, bool HistoryAvailable, DateTimeOffset? AsOfUtc,
    DateTimeOffset? DueRefreshAtUtc, string? NextCursor, string View, object Items);
public sealed record ContinueChaptersRequest(Guid SeasonId, string? WorkId = null);
public sealed record ContinueChaptersResponse(Guid SeasonId, string? ScopeVersion, PbeChapterWork Work, string Next);
