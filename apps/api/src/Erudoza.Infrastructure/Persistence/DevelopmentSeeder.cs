using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Infrastructure.Persistence;

public sealed class DevelopmentSeeder(ErudozaDbContext db, IPasswordHasher passwords, IClock clock)
{
    public static readonly IReadOnlyList<(string Citation, int Verse, string Text)> DanielSamples =
    [
        ("Daniel 1:1", 1, "Development sample: In the first year the assigned city was placed under study by the student named Daniel."),
        ("Daniel 1:2", 2, "Development sample: The keeper brought vessels from the house and placed them in the treasury of the training hall."),
        ("Daniel 1:3", 3, "Development sample: The official asked that youths of the household be taught the language of the assigned books."),
        ("Daniel 1:4", 4, "Development sample: They were to be without blemish, skillful in wisdom, and ready for daily recall practice."),
        ("Daniel 1:5", 5, "Development sample: A daily portion of the king's food was appointed, but the record keeps this as sample text only."),
        ("Daniel 1:6", 6, "Development sample: Among these were Daniel, Hananiah, Mishael, and Azariah from the tribe of Judah."),
        ("Daniel 1:7", 7, "Development sample: The official gave them new names for the season, yet Daniel kept his first purpose."),
        ("Daniel 1:8", 8, "Development sample: Daniel purposed in his heart that he would not defile himself with the king's food.")
    ];

    public async Task SeedAsync(string adminEmail, string adminPassword, string studentUsername, string studentPassword, CancellationToken cancellationToken)
    {
        if (!await db.Organizations.AnyAsync(item => item.Id == SeedIdentifiers.OrganizationId, cancellationToken))
        {
            db.Organizations.Add(new Organization
            {
                Id = SeedIdentifiers.OrganizationId,
                Name = "Development Academy",
                Slug = "development-academy",
                CreatedAtUtc = clock.UtcNow
            });
        }

        if (!await db.Organizations.AnyAsync(item => item.Id == SeedIdentifiers.IsolationOrganizationId, cancellationToken))
        {
            db.Organizations.Add(new Organization
            {
                Id = SeedIdentifiers.IsolationOrganizationId,
                Name = "Isolation Academy",
                Slug = "isolation-academy",
                CreatedAtUtc = clock.UtcNow
            });
        }

        if (!await db.RuleProfiles.AnyAsync(item => item.Key == RuleProfileReader.PbeStyleV1, cancellationToken))
        {
            db.RuleProfiles.Add(new RuleProfile
            {
                Id = SeedIdentifiers.RuleProfileId,
                Key = RuleProfileReader.PbeStyleV1,
                Version = 1,
                ConfigurationJson = RuleProfileReader.PbeStyleV1Json,
                IsBuiltIn = true,
                CreatedAtUtc = clock.UtcNow
            });
        }

        await EnsureUserAsync(
            SeedIdentifiers.AdminUserId,
            adminEmail,
            adminEmail,
            adminPassword,
            "Season Admin",
            UserKind.Adult,
            SeedIdentifiers.OrganizationId,
            OrganizationRole.Admin,
            cancellationToken);

        await EnsureUserAsync(
            SeedIdentifiers.IsolationAdminUserId,
            "orgb.admin@erudoza.local",
            "orgb.admin@erudoza.local",
            adminPassword,
            "Isolation Admin",
            UserKind.Adult,
            SeedIdentifiers.IsolationOrganizationId,
            OrganizationRole.Admin,
            cancellationToken);

        await EnsureUserAsync(
            SeedIdentifiers.StudentUserId,
            studentUsername,
            email: null,
            studentPassword,
            "Daniel Student",
            UserKind.Student,
            SeedIdentifiers.OrganizationId,
            OrganizationRole.Student,
            cancellationToken);

        if (!await db.ContentPacks.AnyAsync(item => item.Id == SeedIdentifiers.ContentPackId, cancellationToken))
        {
            var pack = new ContentPack
            {
                Id = SeedIdentifiers.ContentPackId,
                OrganizationId = SeedIdentifiers.OrganizationId,
                PackKey = "dev-daniel",
                Version = 1,
                Locale = "en",
                SourceType = SourceType.Scripture,
                LicensingStatus = "development-sample",
                IsActive = true,
                CreatedAtUtc = clock.UtcNow
            };
            db.ContentPacks.Add(pack);

            var document = new SourceDocument
            {
                Id = SeedIdentifiers.SourceDocumentId,
                ContentPackId = pack.Id,
                Name = "Daniel",
                CanonicalBookKey = "DAN"
            };
            db.SourceDocuments.Add(document);

            foreach (var sample in DanielSamples)
            {
                var unitId = Guid.Parse($"77777777-7777-7777-7777-77777777770{sample.Verse}");
                var unit = new SourceUnit
                {
                    Id = unitId,
                    ContentPackId = pack.Id,
                    SourceDocumentId = document.Id,
                    OrganizationId = SeedIdentifiers.OrganizationId,
                    SourceType = SourceType.Scripture,
                    CanonicalText = sample.Text,
                    NormalizedComparisonText = TextNormalization.Normalize(sample.Text, NormalizationProfile.ExactText),
                    ContentHash = ContentHashing.Compute(sample.Text, "DAN", 1, sample.Verse, sample.Verse),
                    CitationLabel = sample.Citation,
                    Locale = "en",
                    LicensingMetadata = "development-sample",
                    IsActive = true,
                    BookKey = "DAN",
                    Chapter = 1,
                    Verse = sample.Verse,
                    Ordinal = sample.Verse
                };
                db.SourceUnits.Add(unit);
                db.KnowledgeUnits.Add(new KnowledgeUnit
                {
                    Id = Guid.Parse($"88888888-8888-8888-8888-88888888880{sample.Verse}"),
                    OrganizationId = SeedIdentifiers.OrganizationId,
                    SourceUnitId = unit.Id,
                    ContentPackId = pack.Id,
                    Kind = KnowledgeUnitKind.ExactVerseText,
                    Title = sample.Citation,
                    CreatedAtUtc = clock.UtcNow
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureUserAsync(
        Guid userId,
        string userName,
        string? email,
        string password,
        string displayName,
        UserKind kind,
        Guid organizationId,
        OrganizationRole role,
        CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(item => item.Id == userId, cancellationToken))
        {
            return;
        }

        db.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = userName.ToLowerInvariant(),
            Email = email?.ToLowerInvariant(),
            PasswordHash = passwords.Hash(password),
            DisplayName = displayName,
            Kind = kind,
            CreatedAtUtc = clock.UtcNow
        });

        if (kind == UserKind.Student)
        {
            db.StudentProfiles.Add(new StudentProfile
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                OrganizationId = organizationId,
                DisplayName = displayName,
                CreatedAtUtc = clock.UtcNow
            });
        }

        db.OrganizationMembers.Add(new OrganizationMember
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = userId,
            Role = role,
            CreatedAtUtc = clock.UtcNow
        });
    }
}
