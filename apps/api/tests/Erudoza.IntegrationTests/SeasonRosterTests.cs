using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class SeasonRosterTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Admin_and_assigned_student_can_read_the_season_roster()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Roster Season", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = await created.Content.ReadFromJsonAsync<SeasonDto>();

        var scope = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season!.Id}/scope",
            new
            {
                contentPackId = SeedIdentifiers.ContentPackId,
                includes = new[]
                {
                    new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 4 }
                }
            });
        scope.EnsureSuccessStatusCode();

        var assigned = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}/assignments",
            new
            {
                studentUserId = SeedIdentifiers.StudentUserId,
                type = "PrimarySpecialist",
                contentPackId = SeedIdentifiers.ContentPackId,
                range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 4 }
            });
        assigned.EnsureSuccessStatusCode();

        var roster = await admin.GetFromJsonAsync<List<AssignmentDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}/assignments");
        roster.Should().ContainSingle();
        roster![0].StudentUserId.Should().Be(SeedIdentifiers.StudentUserId);
        roster[0].StudentUserName.Should().Be("daniel.student");
        roster[0].StudentDisplayName.Should().Be("Daniel Student");
        roster[0].Type.Should().Be("PrimarySpecialist");

        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var own = await student.GetFromJsonAsync<List<AssignmentDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}/assignments");
        own.Should().ContainSingle(item => item.StudentUserId == SeedIdentifiers.StudentUserId);
    }
}
