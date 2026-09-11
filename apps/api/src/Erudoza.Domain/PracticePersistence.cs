namespace Erudoza.Domain;

// Aggregates are stored atomically; room revisions provide optimistic concurrency.
public sealed class PracticeRoomRecord
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public string Status { get; set; } = "Lobby";
    public long Revision { get; set; }
    public string StateJson { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class PracticeQuestionRecord
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid QuestionKey { get; set; }
    public int Version { get; set; }
    public bool Published { get; set; }
    public string DefinitionJson { get; set; } = "{}";
}

public sealed class PracticeSetting
{
    public Guid OrganizationId { get; set; }
    public bool Enabled { get; set; }
}

public sealed class PracticeAwardRecord
{
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid UserId { get; set; }
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTimeOffset ReconciledAt { get; set; }
}
