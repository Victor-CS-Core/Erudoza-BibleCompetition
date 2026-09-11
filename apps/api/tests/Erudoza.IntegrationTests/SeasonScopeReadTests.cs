using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class SeasonScopeReadTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Coach_can_restore_saved_inclusions_and_exclusions_and_empty_drafts()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Restorable scope", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = await created.Content.ReadFromJsonAsync<SeasonDto>();
        var url = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season!.Id}/scope";
        var empty = await admin.GetFromJsonAsync<SeasonScopeDto>(url);
        empty!.ContentPackId.Should().BeNull();
        empty.Includes.Should().BeEmpty();
        empty.Excludes.Should().BeEmpty();
        var include = new ScopeRangeDto("DAN", 1, 1, 1, 8);
        var exclude = new ScopeRangeDto("DAN", 1, 5, 1, 5);
        (await admin.PostAsJsonAsync(url, new DefineScopeRequest(SeedIdentifiers.ContentPackId, [include], [exclude]))).EnsureSuccessStatusCode();
        var saved = await admin.GetFromJsonAsync<SeasonScopeDto>(url);
        saved!.ContentPackId.Should().Be(SeedIdentifiers.ContentPackId);
        saved.Includes.Should().Equal(include);
        saved.Excludes.Should().Equal(exclude);
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        (await student.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await factory.CreateClient().GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await admin.GetAsync($"/api/v1/organizations/{SeedIdentifiers.IsolationOrganizationId}/seasons/{season.Id}/scope"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await admin.GetAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{Guid.NewGuid()}/scope"))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
