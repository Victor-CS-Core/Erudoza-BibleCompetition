using System.Net;
using System.Net.Http.Json;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class AuthorizationAndIsolationTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Unauthenticated_protected_request_is_rejected()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/v1/me");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Student_cannot_create_a_season()
    {
        var client = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var response = await client.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Blocked", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Student_cannot_import_a_content_pack()
    {
        var client = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var response = await client.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/content-packs/import",
            new
            {
                packKey = "blocked-import",
                version = 1,
                locale = "en",
                sourceType = "Scripture",
                documents = new[]
                {
                    new
                    {
                        name = "Blocked",
                        units = new[]
                        {
                            new { citation = "Joshua 1:1", bookKey = "JOS", chapter = 1, verse = 1, ordinal = 1, text = "Blocked." }
                        }
                    }
                }
            });
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Admin_in_org_a_cannot_read_org_b()
    {
        var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var response = await client.GetAsync($"/api/v1/organizations/{SeedIdentifiers.IsolationOrganizationId}");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task App_starts_without_an_openai_key()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/v1/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
