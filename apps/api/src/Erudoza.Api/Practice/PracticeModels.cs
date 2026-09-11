using System.Text.Json;
using Erudoza.Domain.Practice;

namespace Erudoza.Api.Practice;

public sealed record PracticeActor(Guid Id, Guid OrganizationId, string Name, bool Admin, string? CredentialVersion = null);
public sealed record CreatePracticeRoom(Guid SeasonId, int TeamSize, int QuestionCount, bool Coached, string? BookKey);
public sealed record PracticeCommand(Guid CommandId, long Revision, string Action, Guid? TargetUserId = null,
    int? Team = null, string? Text = null, string[]? Answers = null, Guid? ScheduleId = null,
    Guid? QuestionId = null, int? Points = null, Guid? OtherUserId = null);
public sealed record ImportPracticeQuestions(Guid SeasonId, List<PracticeQuestion> Questions);
public sealed class PracticeRoom
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SeasonId { get; set; }
    public Guid OwnerId { get; set; }
    public Guid? CoachId { get; set; }
    public int TeamSize { get; set; }
    public int QuestionCount { get; set; }
    public string? BookKey { get; set; }
    public bool Coached { get; set; }
    public string Status { get; set; } = "Lobby";
    public string Phase { get; set; } = "Presentation";
    public string RuleVersion { get; set; } = "ERUDOZA_PBE_PVP_2023_24_V1";
    public string ScoringVersion { get; set; } = "accuracy-plus-speed-25-v1";
    public long Revision { get; set; }
    public int QuestionIndex { get; set; }
    public string ProcessId { get; set; } = "";
    public long PhaseTimestamp { get; set; }
    public DateTimeOffset? PhaseEndsAt { get; set; }
    public DateTimeOffset? ResponseStartsAt { get; set; }
    public long ResponseTimestamp { get; set; }
    public Guid ScheduleId { get; set; }
    public List<Guid> Acknowledged { get; set; } = [];
    public List<PracticeMember> Members { get; set; } = [];
    public List<PracticeInvitation> Invitations { get; set; } = [];
    public List<PracticeQuestion> Questions { get; set; } = [];
    public List<PracticeQuestion> Reserves { get; set; } = [];
    public List<PracticeSubmission> Submissions { get; set; } = [];
    public List<PracticeMessage> Messages { get; set; } = [];
    public Dictionary<int, string[]> Drafts { get; set; } = [];
    public Dictionary<Guid, Guid> AppliedCommands { get; set; } = [];
    public List<PracticeContribution> Contributions { get; set; } = [];
    public DateTimeOffset? CompletedAt { get; set; }
    public List<PracticeAward> Awards { get; set; } = [];
    public List<PracticeAdjustment> Adjustments { get; set; } = [];
    public Dictionary<Guid, PracticeTimingDiagnostics> TimingDiagnostics { get; set; } = [];
}
public sealed class PracticeMember
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = "";
    public int Team { get; set; }
    public bool Ready { get; set; }
    public bool Captain { get; set; }
    public bool Scribe { get; set; }
}
public sealed class PracticeInvitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoomId { get; set; }
    public Guid UserId { get; set; }
    public int? Team { get; set; }
    public string InviterName { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public bool Accepted { get; set; }
}
public sealed class PracticeSubmission
{
    public Guid QuestionId { get; set; }
    public int Team { get; set; }
    public Guid ScribeId { get; set; }
    public string[] Answers { get; set; } = [];
    public long ElapsedTicks { get; set; }
    public bool DeadlineDraft { get; set; }
    public int AccuracyHundredths { get; set; }
    public int SpeedHundredths { get; set; }
    public bool Appealed { get; set; }
    public bool Resolved { get; set; } = true;
    public string? AppealReason { get; set; }
}
public sealed record PracticeMessage(Guid Id, Guid UserId, string DisplayName, int Team, string Text, DateTimeOffset CreatedAt);
public sealed record PracticeContribution(Guid UserId, Guid QuestionId, bool Scribe);
public sealed record PracticeAward(string Key, string Title, Guid SeasonId, Guid UserId);
public sealed record PracticeAdjustment(Guid QuestionId, int Team, Guid CoachId, int OldPoints, int NewPoints, string Reason, DateTimeOffset At);
public static class PracticeJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Options)!;
    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
}
