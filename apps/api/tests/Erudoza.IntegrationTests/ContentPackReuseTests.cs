using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class ContentPackReuseTests : IClassFixture<ErudozaApiFactory>
{
    private readonly ErudozaApiFactory factory;

    public ContentPackReuseTests(ErudozaApiFactory factory)
    {
        this.factory = factory;
        factory.DisablePracticeTicker = true;
    }

    private static string ImportUrl(Guid? organizationId = null) =>
        $"/api/v1/organizations/{organizationId ?? SeedIdentifiers.OrganizationId}/content-packs/import";

    private static ImportContentPackRequest Request(string scenario) => new(
        $"reuse-{scenario}-{Guid.NewGuid():N}", 1, "en", "Scripture",
        [new ImportDocumentDto("Daniel", [
            new ImportUnitDto("Daniel 1:1", "DAN", 1, 1, 1, $"{scenario}: first verse."),
            new ImportUnitDto("Daniel 1:3", "DAN", 1, 3, 3, $"{scenario}: third verse.")])], "Internal");

    private static async Task<ContentPackDto> Import(HttpClient client, ImportContentPackRequest request, Guid? organizationId = null)
    {
        var response = await client.ImportFixtureAsync(ImportUrl(organizationId), request);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ContentPackDto>())!;
    }

    private async Task<HttpClient> AnotherCoach()
    {
        var identifier = $"coach-{Guid.NewGuid():N}@erudoza.local";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var id = Guid.NewGuid();
            db.Users.Add(new ApplicationUser
            {
                Id = id,
                UserName = identifier,
                Email = identifier,
                DisplayName = "Another coach",
                PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher>().Hash("ReuseCoach!234"),
                Kind = UserKind.Adult,
                CreatedAtUtc = DateTimeOffset.UtcNow
            });
            db.OrganizationMembers.Add(new OrganizationMember
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                UserId = id,
                Role = OrganizationRole.Admin,
                CreatedAtUtc = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }
        return await TestHttp.LoginAsync(factory, identifier, "ReuseCoach!234");
    }

    [Fact]
    public async Task Concurrent_different_coaches_reuse_one_pack_and_one_copy_of_each_verse()
    {
        using var first = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var second = await AnotherCoach();
        var request = Request("concurrent");
        var renamed = request with
        {
            PackKey = $"another-name-{Guid.NewGuid():N}",
            Documents = [new ImportDocumentDto("Another display name", request.Documents[0].Units.Reverse()
                .Select(unit => unit with { Citation = "Another citation label" }).ToArray())]
        };
        var imports = await Task.WhenAll(Import(first, request), Import(second, renamed));
        imports[0].Id.Should().Be(imports[1].Id);
        imports[0].UnitCount.Should().Be(2);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        (await db.ContentPacks.CountAsync(p => p.PackKey == request.PackKey || p.PackKey == renamed.PackKey)).Should().Be(1);
        (await db.SourceUnits.CountAsync(u => u.CanonicalText.StartsWith("concurrent:"))).Should().Be(2);
        (await db.KnowledgeUnits.CountAsync(u => u.ContentPackId == imports[0].Id)).Should().Be(2);
        (await db.SourceDocuments.CountAsync(d => d.ContentPackId == imports[0].Id)).Should().Be(1);
        (await db.SourceUnits.Where(u => u.ContentPackId == imports[0].Id).OrderBy(u => u.Ordinal).Select(u => u.Ordinal).ToArrayAsync())
            .Should().Equal(1, 3);
    }

    [Fact]
    public async Task Reuses_active_legacy_pack_with_existing_id_and_equivalent_metadata()
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = new ImportContentPackRequest("renamed-legacy", 1, " EN ", "scripture",
            [new ImportDocumentDto("A different document title", DevelopmentSeeder.DanielSamples.Reverse()
                .Select(s => new ImportUnitDto("Different label", "DAN", 1, s.Verse, s.Verse, s.Text)).ToArray())], " DEVELOPMENT-SAMPLE ");
        var pack = await Import(client, request);
        pack.Id.Should().Be(SeedIdentifiers.ContentPackId);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        (await db.SourceUnits.CountAsync(u => u.ContentPackId == SeedIdentifiers.ContentPackId)).Should().Be(8);
        (await db.ContentPacks.AnyAsync(p => p.PackKey == "renamed-legacy")).Should().BeFalse();
    }

    [Fact]
    public async Task Concurrent_changed_content_for_same_key_and_version_keeps_one_immutable_winner()
    {
        using var first = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var second = await AnotherCoach();
        var request = Request("same-key-race");
        var responses = await Task.WhenAll(first.ImportFixtureAsync(ImportUrl(), request),
            second.ImportFixtureAsync(ImportUrl(), Change(request, "text")));
        responses.Select(r => r.StatusCode).Should().BeEquivalentTo([HttpStatusCode.OK, HttpStatusCode.BadRequest]);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        (await db.ContentPacks.CountAsync(p => p.PackKey == request.PackKey)).Should().Be(1);
        (await db.SourceUnits.CountAsync(u => u.CanonicalText.StartsWith("same-key-race:"))).Should().Be(2);
    }

    [Fact]
    public async Task Known_catalog_translations_do_not_alias_even_when_selected_wording_matches()
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request("edition") with { PackKey = "kjv-dan-1-1", LicensingStatus = "public-domain" };
        var kjv = await Import(client, request);
        var web = await Import(client, request with { PackKey = "web-dan-1-1" });
        var generic = await Import(client, request with { PackKey = "unnamed-source-edition" });
        new[] { kjv.Id, web.Id, generic.Id }.Should().OnlyHaveUniqueItems();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Book_key_case_does_not_duplicate_equivalent_selectors_including_legacy_hashes(bool legacy)
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request($"book-case-{legacy}");
        var lower = request with
        {
            Documents = [new ImportDocumentDto("Daniel",
            request.Documents[0].Units.Select(u => u with { BookKey = "dan" }).ToArray())]
        };
        var originalId = legacy ? await SeedLegacy(lower) : (await Import(client, lower)).Id;
        var result = await Import(client, request with { PackKey = $"uppercase-{Guid.NewGuid():N}" });
        result.Id.Should().Be(originalId);
    }

    [Fact]
    public async Task Renaming_retired_legacy_content_cannot_bypass_the_new_version_requirement()
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request("legacy-retired");
        await SeedLegacy(request, retired: true);
        (await client.ImportFixtureAsync(ImportUrl(), request with { PackKey = $"retired-alias-{Guid.NewGuid():N}" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        (await db.SourceUnits.CountAsync(u => u.CanonicalText.StartsWith("legacy-retired:"))).Should().Be(2);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task An_active_legacy_equivalent_is_preferred_over_retired_duplicates(bool canonical)
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request($"legacy-active-winner-{canonical}");
        if (canonical)
        {
            var retired = await Import(client, request);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            (await db.SourceUnits.FirstAsync(u => u.ContentPackId == retired.Id)).IsRetired = true;
            await db.SaveChangesAsync();
        }
        else await SeedLegacy(request, retired: true);
        var activeId = await SeedLegacy(request with { PackKey = $"active-legacy-{Guid.NewGuid():N}" });
        (await Import(client, request with { PackKey = $"active-alias-{Guid.NewGuid():N}" })).Id.Should().Be(activeId);
    }

    private async Task<Guid> SeedLegacy(ImportContentPackRequest request, bool retired = false)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var pack = new ContentPack
        {
            Id = Guid.NewGuid(),
            OrganizationId = SeedIdentifiers.OrganizationId,
            PackKey = request.PackKey,
            Version = request.Version,
            Locale = request.Locale,
            SourceType = SourceType.Scripture,
            LicensingStatus = request.LicensingStatus!,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };
        db.ContentPacks.Add(pack);
        var document = new SourceDocument { Id = Guid.NewGuid(), ContentPackId = pack.Id, Name = "Legacy Daniel" };
        db.SourceDocuments.Add(document);
        foreach (var incoming in request.Documents.SelectMany(d => d.Units))
        {
            var unit = new SourceUnit
            {
                Id = Guid.NewGuid(),
                ContentPackId = pack.Id,
                SourceDocumentId = document.Id,
                OrganizationId = SeedIdentifiers.OrganizationId,
                CanonicalText = incoming.Text,
                CitationLabel = incoming.Citation,
                BookKey = incoming.BookKey,
                Chapter = incoming.Chapter,
                Verse = incoming.Verse,
                Ordinal = incoming.Ordinal,
                IsRetired = retired,
                ContentHash = ContentHashing.Compute(incoming.Text, incoming.BookKey, incoming.Chapter, incoming.Verse, incoming.Ordinal)
            };
            db.SourceUnits.Add(unit);
            db.KnowledgeUnits.Add(new KnowledgeUnit
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                ContentPackId = pack.Id,
                SourceUnitId = unit.Id,
                Title = incoming.Citation,
                CreatedAtUtc = DateTimeOffset.UtcNow
            });
        }
        await db.SaveChangesAsync();
        return pack.Id;
    }

    [Theory]
    [InlineData("text")]
    [InlineData("selector")]
    [InlineData("ordinal")]
    [InlineData("version")]
    [InlineData("locale")]
    [InlineData("license")]
    [InlineData("sourceType")]
    public async Task Different_source_identity_requires_distinct_pack(string difference)
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request($"distinct-{difference}");
        var original = await Import(client, request);
        var changed = Change(request, difference) with { PackKey = $"different-{Guid.NewGuid():N}" };
        (await Import(client, changed)).Id.Should().NotBe(original.Id);
    }

    [Theory]
    [InlineData("text")]
    [InlineData("selector")]
    [InlineData("ordinal")]
    [InlineData("locale")]
    [InlineData("license")]
    [InlineData("sourceType")]
    public async Task Same_key_and_version_reject_changed_content_or_metadata_before_reuse(string difference)
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request($"immutable-{difference}");
        await Import(client, request);
        var changed = Change(request, difference);
        await Import(client, changed with { PackKey = $"other-existing-{Guid.NewGuid():N}" });
        (await client.ImportFixtureAsync(ImportUrl(), changed)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Identical_content_in_another_organization_does_not_reuse_pack_or_source_rows()
    {
        using var first = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var second = await TestHttp.LoginAsync(factory, "orgb.admin@erudoza.local", "DevAdmin!234");
        var request = Request("tenant");
        var ours = await Import(first, request);
        var theirs = await Import(second, request, SeedIdentifiers.IsolationOrganizationId);
        theirs.Id.Should().NotBe(ours.Id);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        (await db.SourceUnits.Where(u => u.ContentPackId == theirs.Id).Select(u => u.OrganizationId).Distinct().ToArrayAsync())
            .Should().Equal(SeedIdentifiers.IsolationOrganizationId);
    }

    [Theory]
    [InlineData("pack")]
    [InlineData("unit")]
    [InlineData("retired")]
    public async Task Unavailable_source_is_never_returned_as_a_reusable_pack(string unavailable)
    {
        using var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var request = Request($"unavailable-{unavailable}");
        var pack = await Import(client, request);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            if (unavailable == "pack") (await db.ContentPacks.SingleAsync(p => p.Id == pack.Id)).IsActive = false;
            else
            {
                var unit = await db.SourceUnits.FirstAsync(u => u.ContentPackId == pack.Id);
                if (unavailable == "unit") unit.IsActive = false;
                else unit.IsRetired = true;
            }
            await db.SaveChangesAsync();
        }
        (await client.ImportFixtureAsync(ImportUrl(), request)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.ImportFixtureAsync(ImportUrl(), request with { PackKey = $"unavailable-renamed-{Guid.NewGuid():N}" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private static ImportContentPackRequest Change(ImportContentPackRequest request, string difference)
    {
        if (difference == "version") return request with { Version = 2 };
        if (difference == "locale") return request with { Locale = "es" };
        if (difference == "license") return request with { LicensingStatus = "public-domain" };
        if (difference == "sourceType") return request with { SourceType = "Supplemental" };
        var units = request.Documents[0].Units.ToArray();
        units[0] = difference switch
        {
            "text" => units[0] with { Text = units[0].Text + " Changed." },
            "selector" => units[0] with { Verse = 2 },
            "ordinal" => units[0] with { Ordinal = 2 },
            _ => throw new ArgumentOutOfRangeException(nameof(difference))
        };
        return request with { Documents = [new ImportDocumentDto("Daniel", units)] };
    }
}
