using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Content;

public sealed class ContentImportService(IErudozaDbContext db, IClock clock, IStudyWriteCoordinator writes)
{
    private const string UnavailablePackMessage = "This content pack is inactive or contains retired material. Import a new version to use it again.";
    private static readonly Regex CatalogPackKey = new(
        @"^(web|kjv|asv|bbe|webbe|oeb-us)-[a-z0-9]{3,4}-[1-9]\d*-[1-9]\d*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public Task<ContentPack> ImportAsync(
        Guid organizationId,
        ImportContentPackRequest request,
        CancellationToken cancellationToken) =>
        writes.ExecuteAsync(organizationId, ct => ImportCoreAsync(organizationId, request, ct), cancellationToken);

    private async Task<ContentPack> ImportCoreAsync(
        Guid organizationId,
        ImportContentPackRequest request,
        CancellationToken cancellationToken)
    {
        if (organizationId == BuiltInLibrary.OrganizationId) throw new DomainException("The built-in library is immutable; use provisioning to install it.");
        var hashes = request.Documents.SelectMany(document => document.Units).OrderBy(unit => unit.Ordinal)
            .Select(unit => ContentHashing.Compute(unit.Text, NormalizeBookKey(unit.BookKey), unit.Chapter, unit.Verse, unit.Ordinal)).ToArray();
        var locale = NormalizeMetadata(request.Locale);
        var license = NormalizeLicense(request.LicensingStatus);
        var sourceType = Enum.Parse<SourceType>(request.SourceType, true);
        var edition = CatalogEdition(request.PackKey);
        var existing = await db.ContentPacks
            .Include(pack => pack.SourceUnits)
            .ThenInclude(unit => unit.KnowledgeUnits)
            .SingleOrDefaultAsync(
                pack => pack.OrganizationId == organizationId
                    && pack.PackKey == request.PackKey
                    && pack.Version == request.Version,
                cancellationToken);

        if (existing is not null)
        {
            EnsureUnchanged(existing, request, hashes);
            EnsureAvailable(existing);
            return existing;
        }

        // The ID is independent of coach and display names. Across API instances,
        // simultaneous identical imports collide on this primary key; the existing
        // serializable coordinator retries, then reads the winning pack below.
        var identity = JsonSerializer.SerializeToUtf8Bytes(new
        {
            Schema = "erudoza-content-identity-v1",
            OrganizationId = organizationId,
            request.Version,
            Locale = locale,
            LicensingStatus = license,
            SourceType = sourceType,
            CatalogEdition = edition,
            UnitHashes = hashes
        });
        var contentId = new Guid(SHA256.HashData(identity).AsSpan(0, 16));
        var canonical = await db.ContentPacks.Include(pack => pack.SourceUnits)
            .ThenInclude(unit => unit.KnowledgeUnits)
            .SingleOrDefaultAsync(pack => pack.Id == contentId && pack.OrganizationId == organizationId, cancellationToken);
        if (canonical is not null)
        {
            EnsureUnchanged(canonical, request, hashes);
            if (canonical.IsActive && canonical.SourceUnits.All(unit => unit.IsActive && !unit.IsRetired))
                return canonical;
            // An active legacy duplicate may still be usable; prefer it below.
        }

        // Pre-existing packs used random IDs. Match their stored source hashes
        // without migrating IDs or changing season, activity, and mastery links.
        var candidates = await db.ContentPacks
            .Where(pack => pack.OrganizationId == organizationId
                && pack.Version == request.Version && pack.SourceType == sourceType
                && pack.Locale.Trim().ToLower() == locale
                && (pack.LicensingStatus.Trim() == "" ? "development-sample" : pack.LicensingStatus.Trim().ToLower()) == license
                && pack.SourceUnits.Count == hashes.Length)
            .OrderBy(pack => pack.Id)
            .Select(pack => new { pack.Id, pack.PackKey, Available = pack.IsActive && pack.SourceUnits.All(unit => unit.IsActive && !unit.IsRetired) })
            .ToListAsync(cancellationToken);
        var unavailableEquivalent = false;
        foreach (var candidate in candidates)
        {
            if (CatalogEdition(candidate.PackKey) != edition) continue;
            var candidateUnits = await db.SourceUnits.AsNoTracking().Where(unit => unit.ContentPackId == candidate.Id)
                .OrderBy(unit => unit.Ordinal).ToListAsync(cancellationToken);
            if (!candidateUnits.Select(CanonicalHash).SequenceEqual(hashes, StringComparer.Ordinal)) continue;
            if (!candidate.Available)
            {
                unavailableEquivalent = true;
                continue;
            }
            return await db.ContentPacks.Include(pack => pack.SourceUnits).ThenInclude(unit => unit.KnowledgeUnits)
                .SingleAsync(pack => pack.Id == candidate.Id, cancellationToken);
        }
        if (unavailableEquivalent) throw new DomainException(UnavailablePackMessage);

        var pack = new ContentPack
        {
            Id = contentId,
            OrganizationId = organizationId,
            PackKey = request.PackKey,
            Version = request.Version,
            Locale = request.Locale,
            SourceType = sourceType,
            LicensingStatus = string.IsNullOrWhiteSpace(request.LicensingStatus)
                ? "development-sample"
                : request.LicensingStatus,
            IsActive = true,
            CreatedAtUtc = clock.UtcNow
        };

        db.ContentPacks.Add(pack);

        foreach (var documentDto in request.Documents)
        {
            var document = new SourceDocument
            {
                Id = Guid.NewGuid(),
                ContentPackId = pack.Id,
                Name = documentDto.Name,
                CanonicalBookKey = documentDto.Units.FirstOrDefault() is { } firstUnit ? NormalizeBookKey(firstUnit.BookKey) : null
            };
            db.SourceDocuments.Add(document);

            foreach (var unitDto in documentDto.Units.OrderBy(unit => unit.Ordinal))
            {
                var bookKey = NormalizeBookKey(unitDto.BookKey);
                var hash = ContentHashing.Compute(unitDto.Text, bookKey, unitDto.Chapter, unitDto.Verse, unitDto.Ordinal);
                var unit = new SourceUnit
                {
                    Id = Guid.NewGuid(),
                    ContentPackId = pack.Id,
                    SourceDocumentId = document.Id,
                    OrganizationId = organizationId,
                    SourceType = pack.SourceType,
                    CanonicalText = unitDto.Text,
                    NormalizedComparisonText = TextNormalization.Normalize(unitDto.Text, NormalizationProfile.ExactText),
                    ContentHash = hash,
                    CitationLabel = unitDto.Citation,
                    Locale = request.Locale,
                    LicensingMetadata = pack.LicensingStatus,
                    IsActive = true,
                    BookKey = bookKey,
                    Chapter = unitDto.Chapter,
                    Verse = unitDto.Verse,
                    Ordinal = unitDto.Ordinal
                };
                db.SourceUnits.Add(unit);
                db.KnowledgeUnits.Add(new KnowledgeUnit
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = organizationId,
                    SourceUnitId = unit.Id,
                    ContentPackId = pack.Id,
                    Kind = KnowledgeUnitKind.ExactVerseText,
                    Title = unit.CitationLabel,
                    CreatedAtUtc = clock.UtcNow
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return pack;
    }

    private static void EnsureUnchanged(ContentPack existing, ImportContentPackRequest request, string[] hashes)
    {
        if (existing.Version != request.Version
            || NormalizeMetadata(existing.Locale) != NormalizeMetadata(request.Locale)
            || NormalizeLicense(existing.LicensingStatus) != NormalizeLicense(request.LicensingStatus)
            || existing.SourceType != Enum.Parse<SourceType>(request.SourceType, true)
            || CatalogEdition(existing.PackKey) != CatalogEdition(request.PackKey)
            || !existing.SourceUnits.OrderBy(unit => unit.Ordinal).Select(CanonicalHash)
                .SequenceEqual(hashes, StringComparer.Ordinal))
        {
            throw new DomainException("A changed content pack requires a new version.");
        }
    }

    private static void EnsureAvailable(ContentPack pack)
    {
        if (!pack.IsActive || pack.SourceUnits.Any(unit => !unit.IsActive || unit.IsRetired))
        {
            throw new DomainException(UnavailablePackMessage);
        }
    }

    private static string NormalizeMetadata(string value) => value.Trim().ToLowerInvariant();
    private static string NormalizeBookKey(string value) => value.Trim().ToUpperInvariant();
    private static string CanonicalHash(SourceUnit unit) => unit.BookKey == NormalizeBookKey(unit.BookKey)
        ? unit.ContentHash
        : ContentHashing.Compute(unit.CanonicalText, NormalizeBookKey(unit.BookKey), unit.Chapter, unit.Verse, unit.Ordinal);
    private static string NormalizeLicense(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "development-sample" : NormalizeMetadata(value);
    private static string? CatalogEdition(string key)
    {
        var match = CatalogPackKey.Match(key);
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }
}
