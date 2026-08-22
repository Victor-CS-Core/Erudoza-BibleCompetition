using Erudoza.Domain;

namespace Erudoza.Application.Abstractions;

public enum ActivityEligibility
{
    StudyOnly,
    SimulationAllowed
}

public sealed record StudyContext(
    Guid OrganizationId,
    Guid StudentId,
    Guid SeasonId,
    Guid SessionId,
    StudyMode Mode);

public sealed record ActivityRequest(
    StudyContext Context,
    KnowledgeUnit KnowledgeUnit,
    SourceUnit SourceUnit,
    RuleProfileSnapshot RuleProfile,
    int Difficulty,
    int Sequence);

public interface IActivityProvider
{
    string ActivityType { get; }
    bool CanHandle(ActivityRequest request);
    Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken);
}

public interface IStudyEngine
{
    Task<ChallengeCard> GetNextAsync(StudyContext context, CancellationToken cancellationToken);
}

public interface ICompetitionScopeResolver
{
    Task<IReadOnlySet<Guid>> ResolveAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken);
}

public sealed record StudentStudyScope(
    Guid StudentId,
    Guid SeasonId,
    IReadOnlySet<Guid> EligibleSourceUnitIds,
    IReadOnlySet<Guid> PrimarySpecialistSourceUnitIds,
    IReadOnlySet<Guid> RequiredCoverageSourceUnitIds);

public interface IStudentStudyScopeService
{
    Task<StudentStudyScope> GetAsync(
        Guid studentId,
        Guid seasonId,
        CancellationToken cancellationToken);
}

public sealed record AttemptEvidence(
    Guid OrganizationId,
    Guid StudentUserId,
    Guid SeasonId,
    Guid KnowledgeUnitId,
    bool IsCorrect,
    bool HintsUsed,
    string ActivityType,
    AnswerMode AnswerMode);

public sealed record MasteryUpdateResult(
    MasteryLevel Level,
    int ExactWordingScore,
    int RecognitionScore,
    DateTimeOffset? ReviewDueAtUtc,
    string AlgorithmVersion);

public interface IMasteryService
{
    Task<MasteryUpdateResult> ApplyAttemptAsync(
        AttemptEvidence attempt,
        CancellationToken cancellationToken);
}

public sealed record RuleProfileSnapshot(
    string Key,
    int Version,
    bool StudyAllowMultipleChoice,
    bool SimulationAllowMultipleChoice,
    bool SimulationAllowTrueFalse,
    bool PreferShortAnswer,
    bool ShowReference)
{
    public bool AllowsActivity(StudyMode mode, string activityType, bool isMultipleChoice)
    {
        if (mode != StudyMode.Simulation)
        {
            return !isMultipleChoice || StudyAllowMultipleChoice;
        }

        if (isMultipleChoice && !SimulationAllowMultipleChoice)
        {
            return false;
        }

        return activityType is "MissingWords" or "ShortAnswer" or "TrueFalse" || !isMultipleChoice;
    }
}
