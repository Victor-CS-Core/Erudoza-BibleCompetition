using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class ScriptureReaderTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private sealed record ScriptureResponse(Guid SeasonId, SourceUnitDto[] Verses);

    [Fact]
    public async Task Reader_enforces_student_tenant_membership_and_effective_assignment_scope()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var created = await admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Scripture reader", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        var seasonPath = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}";
        var url = $"/api/v1/study/seasons/{season.Id}/scripture";
        (await admin.PostAsJsonAsync($"{seasonPath}/scope", new DefineScopeRequest(SeedIdentifiers.ContentPackId,
            [new ScopeRangeDto("DAN", 1, 1, 1, 8)], []))).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"{seasonPath}/assignments", new
        {
            studentUserId = SeedIdentifiers.StudentUserId,
            contentPackId = SeedIdentifiers.ContentPackId,
            type = "PrimarySpecialist",
            range = new ScopeRangeDto("DAN", 1, 1, 1, 4)
        })).EnsureSuccessStatusCode();
        (await student.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await admin.PostAsync($"{seasonPath}/activate", null)).EnsureSuccessStatusCode();
        var original = await student.GetFromJsonAsync<ScriptureResponse>(url);
        original!.Verses.Select(item => item.Verse).Should().Equal(1, 2, 3, 4);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            db.ScopeEntries.Add(new CompetitionScopeEntry
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                SeasonId = season.Id,
                ContentPackId = SeedIdentifiers.ContentPackId,
                Kind = ScopeEntryKind.Exclude,
                BookKey = "DAN",
                StartChapter = 1,
                EndChapter = 1,
                StartVerse = 2,
                EndVerse = 2
            });
            (await db.SourceUnits.SingleAsync(item => item.ContentPackId == SeedIdentifiers.ContentPackId && item.Verse == 3)).IsRetired = true;
            (await db.SourceUnits.SingleAsync(item => item.ContentPackId == SeedIdentifiers.ContentPackId && item.Verse == 4)).IsActive = false;
            await db.SaveChangesAsync();
        }
        var filtered = await student.GetFromJsonAsync<ScriptureResponse>(url);
        filtered!.Verses.Select(item => item.Verse).Should().Equal(1);
        filtered.Verses[0].Citation.Should().Be("Daniel 1:1");
        filtered.Verses[0].CanonicalText.Should().NotBeNullOrWhiteSpace();
        (await factory.CreateClient().GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await admin.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await student.GetAsync($"/api/v1/study/seasons/{Guid.NewGuid()}/scripture")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var member = await db.CompetitionMembers.SingleAsync(item => item.SeasonId == season.Id && item.UserId == SeedIdentifiers.StudentUserId);
            db.CompetitionMembers.Remove(member);
            await db.SaveChangesAsync();
        }
        (await student.GetAsync(url)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
