using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class ScriptureCatalogHttpTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Internal_migration_can_restore_a_legacy_catalog_pack()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var catalog = new ScriptureCatalogDto(ScriptureCatalog.Translations, ScriptureCatalog.Books);
        catalog.Should().NotBeNull();
        catalog!.Translations.Should().Contain(item => item.Id == "web");
        catalog.Books.Should().Contain(item => item.BookKey == "DAN");

        var imported = await admin.ImportFixtureAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import-from-catalog",
            new { translationId = "web", bookKey = "DAN", startChapter = 1, endChapter = 1 });
        imported.EnsureSuccessStatusCode();
        var pack = await imported.Content.ReadFromJsonAsync<ContentPackDto>();
        pack.Should().NotBeNull();
        pack!.PackKey.Should().Be("web-dan-1-1");
        pack.LicensingStatus.Should().Be("public-domain");
        pack.UnitCount.Should().Be(2);

        var units = await admin.GetFromJsonAsync<List<SourceUnitDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/{pack.Id}/source-units");
        units.Should().Contain(item => item.CanonicalText == "Catalog sample verse 1:1");
    }

    [Fact]
    public async Task Public_catalog_metadata_is_retired()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/scripture-catalog";
        (await admin.GetAsync(root)).StatusCode.Should().Be(HttpStatusCode.Gone);
        (await admin.GetAsync($"{root}/books?translationId=web")).StatusCode.Should().Be(HttpStatusCode.Gone);
        (await admin.GetAsync($"{root}/books/DAN/chapters?translationId=web")).StatusCode.Should().Be(HttpStatusCode.Gone);
    }

    [Theory]
    [InlineData("JUD", 2, 2)]
    [InlineData("DAN", 13, 13)]
    [InlineData("DAN", 1, 9)]
    [InlineData("DAN", 0, 1)]
    [InlineData("EXO", 1, 1)]
    public async Task Invalid_catalog_ranges_are_rejected_before_import(string bookKey, int startChapter, int endChapter)
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var response = await admin.ImportFixtureAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import-from-catalog",
            new { translationId = "web", bookKey, startChapter, endChapter });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Student_cannot_access_coach_catalog_metadata()
    {
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/scripture-catalog";
        (await student.GetAsync($"{root}/books?translationId=web")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await student.GetAsync($"{root}/books/DAN/chapters?translationId=web")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Student_cannot_import_from_the_catalog()
    {
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var response = await student.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import-from-catalog",
            new { translationId = "web", bookKey = "DAN", startChapter = 1, endChapter = 1 });
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

}
