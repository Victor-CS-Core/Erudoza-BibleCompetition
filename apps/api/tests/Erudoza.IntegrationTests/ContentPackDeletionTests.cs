using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class ContentPackDeletionTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private static string Url(Guid id) => $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/{id}";
    private async Task<(HttpClient Client, ContentPackDto Pack)> Import()
    {
        var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var key = $"delete-test-{Guid.NewGuid():N}";
        // Each deletion scenario needs independent material now that equivalent packs are reused.
        var response = await client.ImportFixtureAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import",
            new ImportContentPackRequest(key, 1, "en", "Scripture",
                [new ImportDocumentDto("Daniel", [new ImportUnitDto("Daniel 1:1", "DAN", 1, 1, 1, $"Test verse for {key}.")])], "Internal"));
        response.EnsureSuccessStatusCode();
        return (client, (await response.Content.ReadFromJsonAsync<ContentPackDto>())!);
    }

    [Fact]
    public async Task Deletes_unused_pack_and_its_owned_content()
    {
        var (client, pack) = await Import();
        (await client.DeleteAsync(Url(pack.Id))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        (await db.ContentPacks.AnyAsync(x => x.Id == pack.Id)).Should().BeFalse();
        (await db.SourceDocuments.AnyAsync(x => x.ContentPackId == pack.Id)).Should().BeFalse();
        (await db.SourceUnits.AnyAsync(x => x.ContentPackId == pack.Id)).Should().BeFalse();
        (await db.KnowledgeUnits.AnyAsync(x => x.ContentPackId == pack.Id)).Should().BeFalse();
        (await client.DeleteAsync(Url(pack.Id))).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Refuses_pack_used_by_a_season_and_retains_verses()
    {
        var (client, pack) = await Import();
        var response = await client.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Deletion protection", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        response.EnsureSuccessStatusCode();
        var season = (await response.Content.ReadFromJsonAsync<SeasonDto>())!;
        (await client.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}/scope",
            new DefineScopeRequest(pack.Id, [new ScopeRangeDto("DAN", 1, 1, 1, 1)], []))).EnsureSuccessStatusCode();
        (await client.DeleteAsync(Url(pack.Id))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await client.GetFromJsonAsync<SourceUnitDto[]>(Url(pack.Id) + "/source-units"))!.Should().HaveCount(1);
    }

    [Fact]
    public async Task Preserves_saved_mastery_even_without_a_current_season_scope()
    {
        var (client, pack) = await Import();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var unit = await db.KnowledgeUnits.FirstAsync(x => x.ContentPackId == pack.Id);
            db.MasteryStates.Add(new MasteryState
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                StudentUserId = SeedIdentifiers.StudentUserId,
                SeasonId = Guid.NewGuid(),
                KnowledgeUnitId = unit.Id
            });
            await db.SaveChangesAsync();
        }
        (await client.DeleteAsync(Url(pack.Id))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await client.GetFromJsonAsync<SourceUnitDto[]>(Url(pack.Id) + "/source-units"))!.Should().HaveCount(1);
    }

    [Fact]
    public async Task Restricts_deletion_to_coaches_in_the_owning_organization()
    {
        var (client, pack) = await Import();
        (await factory.CreateClient().DeleteAsync(Url(pack.Id))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        (await student.DeleteAsync(Url(pack.Id))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await client.DeleteAsync($"/api/v1/organizations/{SeedIdentifiers.IsolationOrganizationId}/content-packs/{pack.Id}"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await client.GetFromJsonAsync<SourceUnitDto[]>(Url(pack.Id) + "/source-units"))!.Should().HaveCount(1);
    }
}
