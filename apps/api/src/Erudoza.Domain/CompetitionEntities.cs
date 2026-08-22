namespace Erudoza.Domain;

public sealed class CompetitionSeason
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string YearLabel { get; set; } = string.Empty;
    public SeasonStatus Status { get; set; } = SeasonStatus.Draft;
    public string DefaultLocale { get; set; } = "en";
    public Guid RuleProfileId { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? TargetCompetitionDate { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? ActivatedAtUtc { get; set; }

    public Organization? Organization { get; set; }
    public RuleProfile? RuleProfile { get; set; }
    public ICollection<CompetitionScopeEntry> ScopeEntries { get; set; } = new List<CompetitionScopeEntry>();
    public ICollection<Assignment> Assignments { get; set; } = new List<Assignment>();
    public ICollection<CompetitionMember> Members { get; set; } = new List<CompetitionMember>();
    public ICollection<Team> Teams { get; set; } = new List<Team>();
}

public sealed class RuleProfile
{
    public Guid Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public int Version { get; set; }
    public string ConfigurationJson { get; set; } = "{}";
    public bool IsBuiltIn { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
}

public sealed class CompetitionScopeEntry
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid ContentPackId { get; set; }
    public ScopeEntryKind Kind { get; set; }
    public string BookKey { get; set; } = string.Empty;
    public int StartChapter { get; set; }
    public int StartVerse { get; set; }
    public int EndChapter { get; set; }
    public int EndVerse { get; set; }

    public CompetitionSeason? Season { get; set; }
    public ContentPack? ContentPack { get; set; }

    public ScriptureRange ToRange() =>
        new(BookKey, StartChapter, StartVerse, EndChapter, EndVerse);
}

public sealed class Assignment
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid StudentUserId { get; set; }
    public AssignmentType Type { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }

    public CompetitionSeason? Season { get; set; }
    public ApplicationUser? Student { get; set; }
    public ICollection<AssignmentScope> Scopes { get; set; } = new List<AssignmentScope>();
}

public sealed class AssignmentScope
{
    public Guid Id { get; set; }
    public Guid AssignmentId { get; set; }
    public Guid ContentPackId { get; set; }
    public string BookKey { get; set; } = string.Empty;
    public int StartChapter { get; set; }
    public int StartVerse { get; set; }
    public int EndChapter { get; set; }
    public int EndVerse { get; set; }

    public Assignment? Assignment { get; set; }
    public ContentPack? ContentPack { get; set; }

    public ScriptureRange ToRange() =>
        new(BookKey, StartChapter, StartVerse, EndChapter, EndVerse);
}

public sealed class Team
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public string Name { get; set; } = string.Empty;

    public CompetitionSeason? Season { get; set; }
}

public sealed class CompetitionMember
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SeasonId { get; set; }
    public Guid UserId { get; set; }
    public Guid? TeamId { get; set; }

    public CompetitionSeason? Season { get; set; }
    public ApplicationUser? User { get; set; }
    public Team? Team { get; set; }
}
