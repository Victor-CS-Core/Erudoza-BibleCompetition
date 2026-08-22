namespace Erudoza.Domain;

public sealed class StudySession
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid StudentUserId { get; set; }
    public StudyMode Mode { get; set; } = StudyMode.Practice;
    public StudySessionStatus Status { get; set; } = StudySessionStatus.Created;
    public int TargetCardCount { get; set; } = 8;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }

    public CompetitionSeason? Season { get; set; }
    public ApplicationUser? Student { get; set; }
    public ICollection<ChallengeCard> Cards { get; set; } = new List<ChallengeCard>();
    public ICollection<Attempt> Attempts { get; set; } = new List<Attempt>();
}

public sealed class ChallengeCard
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SessionId { get; set; }
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid KnowledgeUnitId { get; set; }
    public Guid SourceUnitId { get; set; }
    public string ActivityType { get; set; } = string.Empty;
    public string ProviderType { get; set; } = string.Empty;
    public AnswerMode AnswerMode { get; set; } = AnswerMode.ExactText;
    public string EvaluatorVersion { get; set; } = string.Empty;
    public string PayloadJson { get; set; } = "{}";
    public string AnswerKeyJson { get; set; } = "{}";
    public int Sequence { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }

    public StudySession? Session { get; set; }
    public KnowledgeUnit? KnowledgeUnit { get; set; }
    public SourceUnit? SourceUnit { get; set; }
}

public sealed class Attempt
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SessionId { get; set; }
    public Guid ChallengeCardId { get; set; }
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid KnowledgeUnitId { get; set; }
    public string ClientSubmissionId { get; set; } = string.Empty;
    public string SubmittedAnswer { get; set; } = string.Empty;
    public string NormalizedAnswer { get; set; } = string.Empty;
    public bool IsCorrect { get; set; }
    public string EvaluationResult { get; set; } = string.Empty;
    public string EvaluatorVersion { get; set; } = string.Empty;
    public int ResponseTimeMs { get; set; }
    public bool HintsUsed { get; set; }
    public string ActivityType { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }

    public StudySession? Session { get; set; }
    public ChallengeCard? ChallengeCard { get; set; }
}

public sealed class MasteryState
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid KnowledgeUnitId { get; set; }
    public int RecognitionScore { get; set; }
    public int ExactWordingScore { get; set; }
    public int ReferenceScore { get; set; }
    public int SequenceScore { get; set; }
    public int FactualRecallScore { get; set; }
    public MasteryLevel Level { get; set; } = MasteryLevel.Unseen;
    public string AlgorithmVersion { get; set; } = "v1-scaffold";
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class ReviewSchedule
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid KnowledgeUnitId { get; set; }
    public DateTimeOffset DueAtUtc { get; set; }
    public string AlgorithmVersion { get; set; } = "v1-scaffold";
}
