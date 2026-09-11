using System.Security.Cryptography;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Infrastructure.Content;

public sealed class BuiltInLibraryInstaller(ErudozaDbContext db, IStudyWriteCoordinator writes)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task InstallAsync(string manifestPath, CancellationToken ct = default)
    {
        var fullManifest = Path.GetFullPath(manifestPath);
        var directory = Path.GetDirectoryName(fullManifest)!;
        var manifest = JsonSerializer.Deserialize<Manifest>(await File.ReadAllBytesAsync(fullManifest, ct), Json)
            ?? throw new DomainException("The NKJV library manifest is invalid.");
        if (manifest.SchemaVersion != 1 || manifest.Version != BuiltInLibrary.Version
            || manifest.TranslationId != BuiltInLibrary.TranslationId || manifest.TranslationName != BuiltInLibrary.TranslationName
            || manifest.SourcePdfSha256.Length != 64 || !manifest.SourcePdfSha256.All(Uri.IsHexDigit)
            || manifest.Books.Count != 66 || !manifest.Books.Select(b => b.BookKey).SequenceEqual(BuiltInLibrary.BookKeys))
            throw new DomainException("The NKJV library manifest must contain the supported version and all 66 books in order.");
        var incoming = new List<ContentPack>();
        var nextOrdinal = 1;
        foreach (var book in manifest.Books)
        {
            var file = Path.GetFullPath(Path.Combine(directory, book.File));
            if (!file.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new DomainException("The NKJV book file must stay inside the library directory.");
            var bytes = await File.ReadAllBytesAsync(file, ct);
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(book.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new DomainException($"NKJV book checksum mismatch: {book.BookKey}.");
            var request = JsonSerializer.Deserialize<ImportContentPackRequest>(bytes, Json)
                ?? throw new DomainException("The NKJV book data is invalid.");
            var source = request.Documents.SelectMany(d => d.Units).ToList();
            if (book.ContentPackId != BuiltInLibrary.StableId("book:" + book.BookKey)
                || request.PackKey != "builtin-nkjv-" + book.BookKey.ToLowerInvariant() || request.Version != 1
                || request.Locale != "en" || request.SourceType != "Scripture" || request.Documents.Count != 1
                || request.Documents[0].Name != book.Name || source.Count != book.VerseCount || source.Count == 0
                || source.Any(u => u.BookKey != book.BookKey || string.IsNullOrWhiteSpace(u.Text) || string.IsNullOrWhiteSpace(u.Citation))
                || !source.Select(u => u.Ordinal).SequenceEqual(Enumerable.Range(nextOrdinal, source.Count)))
                throw new DomainException($"The NKJV book data conflicts with its manifest: {book.BookKey}.");
            nextOrdinal += source.Count;
            var chapters = source.GroupBy(u => u.Chapter).ToList();
            if (!chapters.Select(g => g.Key).SequenceEqual(Enumerable.Range(1, chapters.Count))
                || chapters.Count != book.Chapters.Count || chapters.Where((g, i) =>
                    book.Chapters[i].Number != g.Key || !g.Select(u => u.Verse).SequenceEqual(book.Chapters[i].Verses)
                    || !g.Select(u => u.Verse).SequenceEqual(Enumerable.Range(1, g.Count()))).Any())
                throw new DomainException($"The NKJV book has missing or conflicting verse coordinates: {book.BookKey}.");
            var pack = new ContentPack
            {
                Id = book.ContentPackId,
                OrganizationId = BuiltInLibrary.OrganizationId,
                PackKey = request.PackKey,
                Version = BuiltInLibrary.Version,
                Locale = "en",
                SourceType = SourceType.Scripture,
                LicensingStatus = "approved",
                IsActive = true,
                IsBuiltIn = true,
                CreatedAtUtc = DateTimeOffset.UtcNow
            };
            var document = new SourceDocument
            {
                Id = BuiltInLibrary.StableId("document:" + book.BookKey),
                ContentPackId = pack.Id,
                Name = book.Name,
                CanonicalBookKey = book.BookKey
            };
            pack.Documents.Add(document);
            var provenance = JsonSerializer.Serialize(new
            {
                status = "approved",
                source = "supplied-private-nkjv-pdf",
                manifest.SourcePdfSha256,
                bookSha256 = book.Sha256.ToLowerInvariant(),
                translationId = "nkjv",
                version = 1
            }, Json);
            foreach (var unit in source)
            {
                var id = BuiltInLibrary.StableId($"verse:{book.BookKey}:{unit.Chapter}:{unit.Verse}");
                var row = new SourceUnit
                {
                    Id = id,
                    OrganizationId = BuiltInLibrary.OrganizationId,
                    ContentPackId = pack.Id,
                    SourceDocumentId = document.Id,
                    SourceType = SourceType.Scripture,
                    CanonicalText = unit.Text,
                    NormalizedComparisonText = TextNormalization.Normalize(unit.Text, NormalizationProfile.ExactText),
                    ContentHash = ContentHashing.Compute(unit.Text, unit.BookKey, unit.Chapter, unit.Verse, unit.Ordinal),
                    CitationLabel = unit.Citation,
                    Locale = "en",
                    LicensingMetadata = provenance,
                    BookKey = unit.BookKey,
                    Chapter = unit.Chapter,
                    Verse = unit.Verse,
                    Ordinal = unit.Ordinal
                };
                row.KnowledgeUnits.Add(new KnowledgeUnit
                {
                    Id = id,
                    OrganizationId = BuiltInLibrary.OrganizationId,
                    SourceUnitId = id,
                    ContentPackId = pack.Id,
                    Title = unit.Citation,
                    CreatedAtUtc = pack.CreatedAtUtc
                });
                pack.SourceUnits.Add(row);
            }
            incoming.Add(pack);
        }
        await writes.ExecuteAsync(BuiltInLibrary.OrganizationId, async token =>
        {
            var existing = await db.ContentPacks.AsNoTracking().Include(p => p.Documents).Include(p => p.SourceUnits)
                .ThenInclude(u => u.KnowledgeUnits).AsSplitQuery()
                .Where(p => p.OrganizationId == BuiltInLibrary.OrganizationId || incoming.Select(i => i.Id).Contains(p.Id))
                .ToListAsync(token);
            if (existing.Any(p => !incoming.Any(i => i.Id == p.Id))) throw new DomainException("Installed NKJV library version conflict.");
            foreach (var candidate in incoming)
            {
                var prior = existing.SingleOrDefault(p => p.Id == candidate.Id);
                if (prior is not null && !Equivalent(prior, candidate))
                    throw new DomainException($"Installed NKJV content conflict: {candidate.PackKey}. Restore the matching approved library; existing text was preserved.");
            }
            if (!await db.Organizations.AnyAsync(o => o.Id == BuiltInLibrary.OrganizationId, token))
                db.Organizations.Add(new Organization
                {
                    Id = BuiltInLibrary.OrganizationId,
                    Name = BuiltInLibrary.TranslationName,
                    Slug = "erudoza-builtin-nkjv-library",
                    CreatedAtUtc = DateTimeOffset.UtcNow
                });
            foreach (var pack in incoming.Where(p => !existing.Any(e => e.Id == p.Id))) db.ContentPacks.Add(pack);
            return true;
        }, ct);
    }

    private static bool Equivalent(ContentPack a, ContentPack b)
    {
        if (!a.IsBuiltIn || !a.IsActive || a.OrganizationId != b.OrganizationId || a.PackKey != b.PackKey || a.Version != b.Version
            || a.Locale != b.Locale || a.SourceType != b.SourceType || a.LicensingStatus != b.LicensingStatus
            || a.Documents.Count != 1 || a.Documents.Single().Id != b.Documents.Single().Id
            || a.Documents.Single().Name != b.Documents.Single().Name || a.Documents.Single().CanonicalBookKey != b.Documents.Single().CanonicalBookKey
            || a.SourceUnits.Count != b.SourceUnits.Count) return false;
        var units = a.SourceUnits.ToDictionary(u => u.Id);
        return b.SourceUnits.All(u => units.TryGetValue(u.Id, out var prior) && prior.IsActive && !prior.IsRetired
            && prior.OrganizationId == u.OrganizationId && prior.SourceDocumentId == u.SourceDocumentId && prior.SourceType == u.SourceType
            && prior.BookKey == u.BookKey && prior.Chapter == u.Chapter && prior.Verse == u.Verse && prior.Ordinal == u.Ordinal
            && prior.CanonicalText == u.CanonicalText && prior.ContentHash == u.ContentHash && prior.CitationLabel == u.CitationLabel
            && prior.NormalizedComparisonText == u.NormalizedComparisonText && prior.Locale == u.Locale && prior.LicensingMetadata == u.LicensingMetadata
            && prior.KnowledgeUnits.Count == 1 && prior.KnowledgeUnits.Single().Id == u.Id
            && prior.KnowledgeUnits.Single().OrganizationId == u.OrganizationId && prior.KnowledgeUnits.Single().ContentPackId == b.Id
            && prior.KnowledgeUnits.Single().Kind == KnowledgeUnitKind.ExactVerseText);
    }

    private sealed record Manifest(int SchemaVersion, string TranslationId, string TranslationName, int Version,
        string SourcePdfSha256, IReadOnlyList<Book> Books);
    private sealed record Book(Guid ContentPackId, string BookKey, string Name, string File, int VerseCount,
        IReadOnlyList<LibraryChapterDto> Chapters, string Sha256);
}
