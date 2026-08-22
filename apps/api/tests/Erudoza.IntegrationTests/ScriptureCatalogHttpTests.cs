using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class ScriptureCatalogHttpTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Admin_can_list_and_import_a_public_domain_catalog_pack()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var catalog = await admin.GetFromJsonAsync<ScriptureCatalogDto>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/scripture-catalog");
        catalog.Should().NotBeNull();
        catalog!.Translations.Should().Contain(item => item.Id == "web");
        catalog.Books.Should().Contain(item => item.BookKey == "DAN");

        var imported = await admin.PostAsJsonAsync(
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
    public async Task Student_cannot_import_from_the_catalog()
    {
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var response = await student.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import-from-catalog",
            new { translationId = "web", bookKey = "DAN", startChapter = 1, endChapter = 1 });
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Generation_status_reports_the_local_fallback_in_tests()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var status = await admin.GetFromJsonAsync<GenerationStatusDto>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/generation-status");
        status.Should().NotBeNull();
        status!.OpenAiEnabled.Should().BeFalse();
        status.Generator.Should().Be("fake-generative-v1");
    }
}
