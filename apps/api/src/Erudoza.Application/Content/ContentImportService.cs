using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Content;

public sealed class ContentImportService(IErudozaDbContext db, IClock clock)
{
    public async Task<ContentPack> ImportAsync(
        Guid organizationId,
        ImportContentPackRequest request,
        CancellationToken cancellationToken)
    {
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
            EnsureUnchanged(existing, request);
            return existing;
        }

        var pack = new ContentPack
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            PackKey = request.PackKey,
            Version = request.Version,
            Locale = request.Locale,
            SourceType = Enum.Parse<SourceType>(request.SourceType, true),
            LicensingStatus = "development-sample",
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
                CanonicalBookKey = documentDto.Units.FirstOrDefault()?.BookKey
            };
            db.SourceDocuments.Add(document);

            foreach (var unitDto in documentDto.Units.OrderBy(unit => unit.Ordinal))
            {
                var hash = ContentHashing.Compute(unitDto.Text, unitDto.BookKey, unitDto.Chapter, unitDto.Verse, unitDto.Ordinal);
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
                    LicensingMetadata = "development-sample",
                    IsActive = true,
                    BookKey = unitDto.BookKey,
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

    public static async Task MarkDependentQuestionsStaleAsync(
        IErudozaDbContext db,
        Guid organizationId,
        Guid sourceUnitId,
        CancellationToken cancellationToken)
    {
        var evidence = await db.QuestionEvidence
            .Where(item => item.SourceUnitId == sourceUnitId)
            .Select(item => item.QuestionCandidateId)
            .ToListAsync(cancellationToken);

        var candidates = await db.QuestionCandidates
            .Where(item => item.OrganizationId == organizationId && evidence.Contains(item.Id))
            .ToListAsync(cancellationToken);

        foreach (var candidate in candidates)
        {
            candidate.Status = QuestionLifecycleStatus.Stale;
        }

        var playable = await db.PlayableQuestions
            .Where(item => item.OrganizationId == organizationId && evidence.Contains(item.QuestionCandidateId))
            .ToListAsync(cancellationToken);

        foreach (var question in playable)
        {
            question.Status = QuestionLifecycleStatus.Stale;
        }
    }

    private static void EnsureUnchanged(ContentPack existing, ImportContentPackRequest request)
    {
        var existingUnits = existing.SourceUnits.OrderBy(unit => unit.Ordinal).ToList();
        var incoming = request.Documents.SelectMany(document => document.Units).OrderBy(unit => unit.Ordinal).ToList();
        if (existingUnits.Count != incoming.Count)
        {
            throw new DomainException("A changed content pack requires a new version.");
        }

        for (var index = 0; index < existingUnits.Count; index++)
        {
            var current = existingUnits[index];
            var next = incoming[index];
            var nextHash = ContentHashing.Compute(next.Text, next.BookKey, next.Chapter, next.Verse, next.Ordinal);
            if (!string.Equals(current.ContentHash, nextHash, StringComparison.Ordinal))
            {
                throw new DomainException("A changed content pack requires a new version.");
            }
        }
    }
}
