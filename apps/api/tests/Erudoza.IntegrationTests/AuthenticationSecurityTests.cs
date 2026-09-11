using System.Net;
using System.Net.Http.Json;
using Erudoza.Domain;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Erudoza.IntegrationTests;

public sealed class AuthenticationSecurityTests
{
    [Fact]
    public async Task Reset_password_revokes_an_already_issued_cookie()
    {
        using var factory = new ErudozaApiFactory();
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        (await coach.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students/{SeedIdentifiers.StudentUserId}/password", new { password = "Replacement!234" })).EnsureSuccessStatusCode();
        (await student.GetAsync("/api/v1/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using var newSession = await TestHttp.LoginAsync(factory, "daniel.student", "Replacement!234");
        (await newSession.GetAsync("/api/v1/me")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Reactivation_does_not_resurrect_a_cookie_that_was_never_used_while_inactive()
    {
        using var factory = new ErudozaApiFactory();
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var path = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students/{SeedIdentifiers.StudentUserId}/state";
        (await coach.PutAsJsonAsync(path, new { isActive = false })).EnsureSuccessStatusCode();
        (await coach.PutAsJsonAsync(path, new { isActive = true })).EnsureSuccessStatusCode();
        (await student.GetAsync("/api/v1/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using var newSession = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        (await newSession.GetAsync("/api/v1/me")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Login_attempts_are_throttled_with_retry_guidance()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["RateLimiting:LoginPermitLimit"] = "1" }));
        });
        using var client = factory.CreateClient();
        // Invalid JSON exercises the endpoint limiter without touching any database.
        await client.PostAsync("/api/v1/auth/login", new StringContent("{", System.Text.Encoding.UTF8, "application/json"));
        var response = await client.PostAsync("/api/v1/auth/login", new StringContent("{", System.Text.Encoding.UTF8, "application/json"));
        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter.Should().NotBeNull();
        (await response.Content.ReadAsStringAsync()).Should().Contain("Too many sign-in attempts");
    }
}
