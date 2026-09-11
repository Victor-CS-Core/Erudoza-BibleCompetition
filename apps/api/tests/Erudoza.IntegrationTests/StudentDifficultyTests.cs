using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;

namespace Erudoza.IntegrationTests;

public sealed class StudentDifficultyTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private static string Root => $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons";
    private static object Range => new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 4 };

    [Fact]
    public async Task Difficulty_is_per_student_and_season_and_session_keeps_its_snapshot()
    {
        var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var first = await Season(coach, "Foundation");
        var second = await Season(coach, "Advanced");
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = first, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        session!.Difficulty.Should().Be("Foundation");
        var setting = $"{Root}/{first}/students/{SeedIdentifiers.StudentUserId}/difficulty";
        (await coach.PutAsJsonAsync(setting, new { difficulty = "Advanced" })).EnsureSuccessStatusCode();
        var oldCard = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session.Id}/next");
        oldCard!.Tokens.Count(item => item.Hidden).Should().Be(1);
        var newSession = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = first, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        newSession!.Difficulty.Should().Be("Advanced");
        var advancedCard = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{newSession.Id}/next");
        advancedCard!.Tokens.Count(item => item.Hidden).Should().BeGreaterThan(5);
        (await coach.PutAsJsonAsync(setting, new { difficulty = "Standard" })).EnsureSuccessStatusCode();
        var secondAssignments = await coach.GetFromJsonAsync<List<AssignmentDto>>($"{Root}/{second}/assignments");
        secondAssignments!.Should().OnlyContain(item => item.Difficulty == "Advanced");
        var another = await coach.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students",
            new { userName = $"other-{Guid.NewGuid():N}", displayName = "Other learner", password = "DevStudent!234" });
        another.EnsureSuccessStatusCode();
        var other = await another.Content.ReadFromJsonAsync<StudentDto>();
        (await coach.PostAsJsonAsync($"{Root}/{first}/assignments", new
        {
            studentUserId = other!.UserId,
            type = "RequiredCoverage",
            contentPackId = SeedIdentifiers.ContentPackId,
            range = Range,
            difficulty = "Foundation"
        })).EnsureSuccessStatusCode();
        var assignments = await coach.GetFromJsonAsync<List<AssignmentDto>>($"{Root}/{first}/assignments");
        assignments!.Single(item => item.StudentUserId == other.UserId).Difficulty.Should().Be("Foundation");
        assignments!.Single(item => item.StudentUserId == SeedIdentifiers.StudentUserId).Difficulty.Should().Be("Standard");
        (await student.PutAsJsonAsync(setting, new { difficulty = "Foundation" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await coach.PutAsJsonAsync(setting, new { difficulty = 99 })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Extra_assignment_without_difficulty_preserves_student_setting()
    {
        var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var id = await Season(coach, "Advanced");
        (await coach.PostAsJsonAsync($"{Root}/{id}/assignments", new
        {
            studentUserId = SeedIdentifiers.StudentUserId,
            type = "OptionalReview",
            contentPackId = SeedIdentifiers.ContentPackId,
            range = Range
        })).EnsureSuccessStatusCode();
        var assignments = await coach.GetFromJsonAsync<List<AssignmentDto>>($"{Root}/{id}/assignments");
        assignments!.Should().HaveCount(2).And.OnlyContain(item => item.Difficulty == "Advanced");
    }

    private static async Task<Guid> Season(HttpClient coach, string difficulty)
    {
        var response = await coach.PostAsJsonAsync(Root, new { name = $"Difficulty {Guid.NewGuid():N}", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        response.EnsureSuccessStatusCode();
        var season = await response.Content.ReadFromJsonAsync<SeasonDto>();
        (await coach.PostAsJsonAsync($"{Root}/{season!.Id}/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { Range } })).EnsureSuccessStatusCode();
        (await coach.PostAsJsonAsync($"{Root}/{season.Id}/assignments", new
        {
            studentUserId = SeedIdentifiers.StudentUserId,
            type = "PrimarySpecialist",
            contentPackId = SeedIdentifiers.ContentPackId,
            range = Range,
            difficulty
        })).EnsureSuccessStatusCode();
        (await coach.PostAsync($"{Root}/{season.Id}/activate", null)).EnsureSuccessStatusCode();
        return season.Id;
    }
}
