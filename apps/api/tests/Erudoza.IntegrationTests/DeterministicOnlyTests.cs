using System.Net;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class DeterministicOnlyTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Removed_generation_and_review_routes_are_unavailable_even_to_coach()
    {
        var client = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}";
        var season = Guid.NewGuid();
        foreach (var route in new[] { "/generation-status", $"/seasons/{season}/generation-jobs", $"/seasons/{season}/questions" })
            (await client.GetAsync(root + route)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        foreach (var route in new[] { $"/seasons/{season}/generation-jobs", $"/questions/{Guid.NewGuid()}/approve", $"/questions/{Guid.NewGuid()}/reject" })
            (await client.PostAsync(root + route, null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public void Only_five_deterministic_activity_providers_are_registered()
    {
        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetServices<IActivityProvider>().Select(provider => provider.ActivityType)
            .Should().BeEquivalentTo("MissingWords", "VerseBuilder", "ReferenceMatch", "WhatComesNext", "TrueFalse");
    }
}
