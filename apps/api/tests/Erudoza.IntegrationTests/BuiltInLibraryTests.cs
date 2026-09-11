using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class BuiltInLibraryTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private static string Org => $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}";

    [Theory]
    [InlineData("import")]
    [InlineData("import-from-catalog")]
    public async Task Public_import_routes_are_retired(string route)
    {
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var response = await coach.PostAsJsonAsync($"{Org}/content-packs/{route}", new { });
        response.StatusCode.Should().Be(HttpStatusCode.Gone);
    }

    [Fact]
    public async Task Uninstalled_library_is_unavailable_without_inventing_books()
    {
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        (await coach.GetAsync($"{Org}/library")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Multi_pack_requests_preserve_existing_private_draft_scope_but_cannot_introduce_private_packs(bool existing)
    {
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await coach.PostAsJsonAsync($"{Org}/seasons", new { name = "Legacy draft", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        var uri = $"{Org}/seasons/{season.Id}/scope";
        if (existing)
            (await coach.PostAsJsonAsync(uri, new DefineScopeRequest(SeedIdentifiers.ContentPackId, [new("DAN", 1, 1, 1, 8)]))).EnsureSuccessStatusCode();
        var update = await coach.PostAsJsonAsync(uri, new DefineScopeRequest(Packs: [new(SeedIdentifiers.ContentPackId, [new("DAN", 1, 1, 1, 4)])]));
        update.StatusCode.Should().Be(existing ? HttpStatusCode.NoContent : HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData("DAN", 1, 1, 7, 1)]
    [InlineData("DAN", 1, 1, 1, 99)]
    [InlineData("DAN", 1, 8, 1, 1)]
    [InlineData("GEN", 1, 1, 1, 2)]
    public async Task Scope_rejects_nonexistent_or_reversed_coordinates(string book, int sc, int sv, int ec, int ev)
    {
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await coach.PostAsJsonAsync($"{Org}/seasons", new { name = "Bounds", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        var response = await coach.PostAsJsonAsync($"{Org}/seasons/{season.Id}/scope",
            new DefineScopeRequest(SeedIdentifiers.ContentPackId, [new(book, sc, sv, ec, ev)], []));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
