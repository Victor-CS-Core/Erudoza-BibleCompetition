namespace Erudoza.Application.Contracts;

public sealed record SkillScoresDto(int ExactWording, int Recognition, int Reference, int Sequence, int FactualRecall);
public sealed record PendingTrainingPreferencesDto(string TimeZone, int WeeklyTarget, DateTimeOffset EffectiveAtUtc);
public sealed record TrainingPreferencesDto(string TimeZone, int WeeklyTarget, PendingTrainingPreferencesDto? Pending);
public sealed record SaveTrainingPreferencesRequest(int WeeklyTarget, string TimeZone);
public sealed record TrainingStepDto(string Kind, int Target, int Completed, string Status, Guid? SessionId);
public sealed record BadgeProgressDto(string Key, string RuleVersion, string Title, int Completed, int Target, DateTimeOffset? EarnedAtUtc, string ScopeLabel, Guid? EvidenceSessionId);
public sealed record TrainingWeekDayDto(string LocalDate, bool Credited, bool IsToday);
public sealed record TrainingWeekDto(string WeekStartLocalDate, string TimeZone, int Target, int CompletedDays, IReadOnlyList<TrainingWeekDayDto> Days);
public sealed record TrainingMissionDto(string? Id, int? Revision, string Status, string? ScopeVersion, IReadOnlyList<TrainingStepDto> Steps, string? Explanation);
public sealed record TrainingNextActionDto(string Label, string Mode, Guid? SessionId);
public sealed record TrainingTodayDto(Guid? SeasonId, string SeasonName, string SeasonStatus, string LocalDate, TrainingPreferencesDto Preferences, TrainingWeekDto Week, TrainingMissionDto Mission, TrainingNextActionDto? NextAction, IReadOnlyList<BadgeProgressDto> Honors, string? Format = null);
public sealed record SkillEventDto(Guid AttemptId, DateTimeOffset AcceptedAtUtc, SkillScoresDto Before, SkillScoresDto After);
public sealed record PassageChangeDto(Guid KnowledgeUnitId, string Title, SkillScoresDto Delta, SkillScoresDto? Before, SkillScoresDto? After, IReadOnlyList<SkillEventDto> Events);
public sealed record SessionResultSummaryDto(Guid AttemptId, int EarnedPoints, int AvailablePoints, DateTimeOffset AcceptedAtUtc);
public sealed record SessionRecapDto(string Version, Guid SessionId, Guid SeasonId, string Mode, DateTimeOffset? CompletedAtUtc, int Attempted, int Correct, int TargetCardCount, bool FullTargetReached, bool NewlyCreditedDay, string? MissionLocalDate, string? CreditedLocalDate, IReadOnlyList<TrainingStepDto> MissionSteps, IReadOnlyList<BadgeProgressDto> EarnedBadges, IReadOnlyList<PassageChangeDto> PassageChanges, bool Interrupted = false, IReadOnlyList<SessionResultSummaryDto>? Results = null);
public sealed record StartTrainingContext(string ClientStartId, string? TimeZone = null, string? MissionId = null, int? MissionRevision = null, string? Step = null);

public sealed record JourneyPassageDto(Guid KnowledgeUnitId, string Title, string Level, string AlgorithmVersion, SkillScoresDto Skills, DateTimeOffset? DueAtUtc);
public sealed record JourneyChapterDto(string BookKey, int Chapter, string ScopeLabel, int EligibleCount, int SeenCount, int StrongCount, IReadOnlyList<JourneyPassageDto> Passages);
public sealed record PassageJourneyPageDto(Guid SeasonId, string ScopeVersion, string? After, IReadOnlyList<JourneyChapterDto> Chapters);
