namespace Erudoza.Domain;
// Compact versioned projections; historic evidence remains immutable in attempts and awards.
public sealed class TrainingPreference
{
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public string PreferencesJson { get; set; } = "{}";
    public DateTimeOffset LastEventAtUtc { get; set; }
    public int Revision { get; set; }
}
public sealed class TrainingDay
{
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public string LocalDate { get; set; } = "";
    public string TimeZone { get; set; } = "UTC";
    public string WeekStartLocalDate { get; set; } = "";
    public DateTimeOffset CreditedAtUtc { get; set; }
    public Guid SessionId { get; set; }
}
public sealed class TrainingWeek
{
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public string WeekStartLocalDate { get; set; } = "";
    public string TimeZone { get; set; } = "UTC";
    public int Target { get; set; } = 5;
    public int CompletedDays { get; set; }
    public DateTimeOffset? QualifiedAtUtc { get; set; }
}
public sealed class DailyMission
{
    public string Id { get; set; } = "";
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public string LocalDate { get; set; } = "";
    public string TimeZone { get; set; } = "UTC";
    public int Revision { get; set; } = 1;
    public string ScopeVersion { get; set; } = "";
    public string EligibleIdsJson { get; set; } = "[]";
    public string ReviewIdsJson { get; set; } = "[]";
    public string AcceptedReviewIdsJson { get; set; } = "[]";
    public bool Invalidated { get; set; }
    public Guid? ReviewSessionId { get; set; }
    public Guid? PracticeSessionId { get; set; }
    public int PracticeCompleted { get; set; }
}
public sealed class TrainingSeasonProgress
{
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public Guid SeasonId { get; set; }
    public string ScopeVersion { get; set; } = "";
    public string SeenIdsJson { get; set; } = "[]";
    public string BadgesJson { get; set; } = "[]";
}
public sealed class SoloBadgeAward
{
    public Guid OrganizationId { get; set; }
    public Guid StudentUserId { get; set; }
    public string Key { get; set; } = "";
    public string RuleVersion { get; set; } = "training-v1";
    public string AwardScope { get; set; } = "";
    public Guid? SeasonId { get; set; }
    public DateTimeOffset EarnedAtUtc { get; set; }
    public Guid SessionId { get; set; }
    public string EvidenceJson { get; set; } = "{}";
}
