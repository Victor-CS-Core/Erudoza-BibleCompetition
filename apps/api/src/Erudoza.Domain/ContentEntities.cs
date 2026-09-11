namespace Erudoza.Domain;

public sealed class ContentPack
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string PackKey { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Locale { get; set; } = "en";
    public SourceType SourceType { get; set; } = SourceType.Scripture;
    public string LicensingStatus { get; set; } = "development-sample";
    public bool IsActive { get; set; } = true;
    public bool IsBuiltIn { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }

    public Organization? Organization { get; set; }
    public ICollection<SourceDocument> Documents { get; set; } = new List<SourceDocument>();
    public ICollection<SourceUnit> SourceUnits { get; set; } = new List<SourceUnit>();
}

public sealed class SourceDocument
{
    public Guid Id { get; set; }
    public Guid ContentPackId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? CanonicalBookKey { get; set; }

    public ContentPack? ContentPack { get; set; }
    public ICollection<SourceUnit> Units { get; set; } = new List<SourceUnit>();
}

public sealed class SourceUnit
{
    public Guid Id { get; set; }
    public Guid ContentPackId { get; set; }
    public Guid SourceDocumentId { get; set; }
    public Guid OrganizationId { get; set; }
    public SourceType SourceType { get; set; } = SourceType.Scripture;
    public string CanonicalText { get; set; } = string.Empty;
    public string NormalizedComparisonText { get; set; } = string.Empty;
    public string ContentHash { get; set; } = string.Empty;
    public string CitationLabel { get; set; } = string.Empty;
    public string Locale { get; set; } = "en";
    public string LicensingMetadata { get; set; } = "development-sample";
    public bool IsActive { get; set; } = true;
    public bool IsRetired { get; set; }
    public string BookKey { get; set; } = string.Empty;
    public int Chapter { get; set; }
    public int Verse { get; set; }
    public int Ordinal { get; set; }

    public ContentPack? ContentPack { get; set; }
    public SourceDocument? SourceDocument { get; set; }
    public ICollection<KnowledgeUnit> KnowledgeUnits { get; set; } = new List<KnowledgeUnit>();

    public ScriptureLocator ToLocator() => new(BookKey, Chapter, Verse, Ordinal);
}

public sealed class KnowledgeUnit
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid SourceUnitId { get; set; }
    public Guid ContentPackId { get; set; }
    public KnowledgeUnitKind Kind { get; set; } = KnowledgeUnitKind.ExactVerseText;
    public string Title { get; set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; set; }

    public SourceUnit? SourceUnit { get; set; }
    public ContentPack? ContentPack { get; set; }
}
