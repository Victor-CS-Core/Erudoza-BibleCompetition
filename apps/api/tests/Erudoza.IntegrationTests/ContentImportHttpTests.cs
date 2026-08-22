using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class ContentImportHttpTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Admin_can_import_a_pack_and_read_stored_verses()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var packKey = $"dev-joshua-{Guid.NewGuid():N}";
        var imported = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import",
            SamplePack(packKey, "Development sample: Joshua rose early."));
        imported.EnsureSuccessStatusCode();
        var pack = await imported.Content.ReadFromJsonAsync<ContentPackDto>();
        pack.Should().NotBeNull();
        pack!.PackKey.Should().Be(packKey);
        pack.UnitCount.Should().Be(1);

        var again = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import",
            SamplePack(packKey, "Development sample: Joshua rose early."));
        again.EnsureSuccessStatusCode();
        var same = await again.Content.ReadFromJsonAsync<ContentPackDto>();
        same!.Id.Should().Be(pack.Id);

        var changed = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import",
            SamplePack(packKey, "Changed wording requires a new version."));
        changed.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var units = await admin.GetFromJsonAsync<List<SourceUnitDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/{pack.Id}/source-units");
        units.Should().ContainSingle();
        units![0].CanonicalText.Should().Be("Development sample: Joshua rose early.");
        units[0].BookKey.Should().Be("JOS");
    }

    private static object SamplePack(string packKey, string text) => new
    {
        packKey,
        version = 1,
        locale = "en",
        sourceType = "Scripture",
        documents = new[]
        {
            new
            {
                name = "Joshua",
                units = new[]
                {
                    new { citation = "Joshua 1:1", bookKey = "JOS", chapter = 1, verse = 1, ordinal = 1, text }
                }
            }
        }
    };
}
