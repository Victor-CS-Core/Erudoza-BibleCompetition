namespace Erudoza.Domain;

// Archive-only persistence models retained for existing database compatibility.
// No application service creates, selects, or exposes these historical records.
public sealed class QuestionCandidate
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? SeasonId { get; set; }
    public string SchemaVersion { get; set; } = "1";
    public string QuestionType { get; set; } = string.Empty;
    public string Prompt { get; set; } = string.Empty;
    public AnswerMode AnswerMode { get; set; } = AnswerMode.ShortFact;
    public string CanonicalAnswer { get; set; } = string.Empty;
    public string AcceptedAnswersJson { get; set; } = "[]";
    public int Difficulty { get; set; }
    public string? Explanation { get; set; }
    public string GeneratorVersion { get; set; } = string.Empty;
    public QuestionLifecycleStatus Status { get; set; } = QuestionLifecycleStatus.Generated;
    public DateTimeOffset CreatedAtUtc { get; set; }

    public ICollection<QuestionEvidence> Evidence { get; set; } = new List<QuestionEvidence>();
}

public sealed class PlayableQuestion
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid QuestionCandidateId { get; set; }
    public Guid ContentPackId { get; set; }
    public QuestionLifecycleStatus Status { get; set; } = QuestionLifecycleStatus.Playable;
    public DateTimeOffset CreatedAtUtc { get; set; }

    public QuestionCandidate? QuestionCandidate { get; set; }
}

public sealed class QuestionEvidence
{
    public Guid Id { get; set; }
    public Guid QuestionCandidateId { get; set; }
    public Guid SourceUnitId { get; set; }
    public string EvidenceText { get; set; } = string.Empty;

    public QuestionCandidate? QuestionCandidate { get; set; }
    public SourceUnit? SourceUnit { get; set; }
}

public sealed class GenerationJob
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? SeasonId { get; set; }
    public GenerationJobStatus Status { get; set; } = GenerationJobStatus.Queued;
    public string PromptVersionKey { get; set; } = string.Empty;
    public string? Error { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
}

public sealed class PromptVersion
{
    public Guid Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Template { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }
}

public sealed class AuditEvent
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid? ActorUserId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string? CorrelationId { get; set; }
    public string MetadataJson { get; set; } = "{}";
    public DateTimeOffset CreatedAtUtc { get; set; }
}
