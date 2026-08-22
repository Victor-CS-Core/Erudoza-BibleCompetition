namespace Erudoza.Domain;

public sealed class Organization
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }

    public ICollection<OrganizationMember> Members { get; set; } = new List<OrganizationMember>();
    public ICollection<CompetitionSeason> Seasons { get; set; } = new List<CompetitionSeason>();
    public ICollection<ContentPack> ContentPacks { get; set; } = new List<ContentPack>();
}

public sealed class ApplicationUser
{
    public Guid Id { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string PasswordHash { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public UserKind Kind { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public bool IsActive { get; set; } = true;

    public StudentProfile? StudentProfile { get; set; }
    public ICollection<OrganizationMember> Memberships { get; set; } = new List<OrganizationMember>();
}

public sealed class StudentProfile
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid OrganizationId { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }

    public ApplicationUser? User { get; set; }
    public Organization? Organization { get; set; }
}

public sealed class OrganizationMember
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid UserId { get; set; }
    public OrganizationRole Role { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }

    public Organization? Organization { get; set; }
    public ApplicationUser? User { get; set; }
}
