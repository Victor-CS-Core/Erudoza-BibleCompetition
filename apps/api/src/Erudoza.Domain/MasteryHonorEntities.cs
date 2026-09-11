namespace Erudoza.Domain;

public sealed class MasteryHonorUnlock
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public string Key { get; set; } = "";
    public string RuleVersion { get; set; } = "mastery-v1";
    public Guid SeasonId { get; set; }
    public DateTimeOffset EarnedAtUtc { get; set; }
    public string EvidenceJson { get; set; } = "{}";
}

// One bounded proof per passage, independent of the number of historical attempts.
public sealed class MasteryPassageProof
{
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid KnowledgeUnitId { get; set; }
    public string RuleVersion { get; set; } = "mastery-v1";
    public DateTimeOffset? FirstMasteredAtUtc { get; set; }
    public Guid? FirstMasteredAttemptId { get; set; }
    public string? FirstMasteredEvidenceJson { get; set; }
    public Guid? RetainedAttemptId { get; set; }
    public DateTimeOffset? RetainedAtUtc { get; set; }
    public string? RetainedEvidenceJson { get; set; }
    public Guid? ReviewedAttemptId { get; set; }
    public DateTimeOffset? ReviewedAtUtc { get; set; }
    public string? ReviewedEvidenceJson { get; set; }
}

public sealed class ProfileAvatarSelection
{
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public Guid? UnlockId { get; set; }
    public string? HonorKey { get; set; }
    public string? RuleVersion { get; set; }
}
