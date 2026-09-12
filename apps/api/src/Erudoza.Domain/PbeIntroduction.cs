namespace Erudoza.Domain;

/// <summary>Immutable coach-supplied source identity/text; only Reviewed may change in place.</summary>
public sealed record PbeIntroduction(Guid Id, Guid OrganizationId, Guid SeasonId, string BookKey, string SourceEdition, string Title, string Citation, string LicensingStatus, bool Reviewed, IReadOnlyList<PbeIntroductionUnit> Units);
public sealed record PbeIntroductionUnit(Guid Id, string Citation, string CanonicalText);
public sealed record PbeIntroductionAssignment(string Id, Guid SeasonId, Guid ContentPackId, Guid StudentUserId);
