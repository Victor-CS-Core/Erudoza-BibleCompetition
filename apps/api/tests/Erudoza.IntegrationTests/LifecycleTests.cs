using System.Net;
using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class LifecycleTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private static string Org => $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}";
    private static ScopeRangeDto Range(int first = 1, int last = 4) => new("DAN", 1, first, 1, last);

    [Fact]
    public async Task Removing_assignment_revokes_open_cards_and_preserves_history()
    {
        var (coach, student, season, assignment) = await Setup();
        var session = await Start(student, season);
        var card = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session}/next");
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session}/attempts", new
        {
            clientSubmissionId = "historic",
            challengeCardId = card!.Id,
            submittedAnswer = "incorrect",
            responseTimeMs = 100,
            hintsUsed = false
        })).EnsureSuccessStatusCode();
        var next = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session}/next");
        var endpoint = $"{Org}/seasons/{season}/assignments/{assignment}";
        (await student.DeleteAsync(endpoint)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await coach.DeleteAsync(endpoint.Replace(SeedIdentifiers.OrganizationId.ToString(), Guid.NewGuid().ToString()))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await coach.DeleteAsync(endpoint)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session}/attempts", new
        {
            clientSubmissionId = "revoked",
            challengeCardId = next!.Id,
            submittedAnswer = "answer",
            responseTimeMs = 100,
            hintsUsed = false
        })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await student.GetAsync($"/api/v1/study/sessions/{session}/next")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season, mode = "Practice" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        (await db.Attempts.CountAsync(a => a.SeasonId == season)).Should().Be(1);
        (await db.MasteryStates.CountAsync(a => a.SeasonId == season)).Should().Be(1);
        (await db.ReviewSchedules.CountAsync(a => a.SeasonId == season)).Should().Be(1);
        (await db.StudySessions.CountAsync(a => a.SeasonId == season)).Should().Be(1);
    }

    [Fact]
    public async Task Correction_is_validated_before_change_and_rechecks_open_card_scope()
    {
        var (coach, student, season, assignment) = await Setup();
        var session = await Start(student, season);
        var card = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session}/next");
        var endpoint = $"{Org}/seasons/{season}/assignments/{assignment}/passage";
        (await coach.PutAsJsonAsync(endpoint, Range(20, 30))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var unchanged = await coach.GetFromJsonAsync<List<AssignmentDto>>($"{Org}/seasons/{season}/assignments");
        unchanged!.Single().StartVerse.Should().Be(1);
        int originalVerse;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var persisted = await db.ChallengeCards.SingleAsync(a => a.Id == card!.Id);
            originalVerse = (await db.SourceUnits.SingleAsync(a => a.Id == persisted.SourceUnitId)).Verse;
        }
        var replacement = originalVerse == 4 ? 1 : 4;
        (await coach.PutAsJsonAsync(endpoint, Range(replacement, replacement))).EnsureSuccessStatusCode();
        (await student.GetAsync($"/api/v1/study/sessions/{session}")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var fresh = await Start(student, season);
        var freshCard = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{fresh}/next");
        freshCard!.Citation.Should().Contain($"1:{replacement}");
    }

    [Theory]
    [InlineData("close")]
    [InlineData("archive")]
    public async Task Closed_seasons_stop_study_and_cannot_be_edited_or_reactivated(string action)
    {
        var (coach, student, season, assignment) = await Setup();
        var session = await Start(student, season);
        var root = $"{Org}/seasons/{season}";
        (await student.PostAsync(root + "/" + action, null)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await coach.PostAsync(root + "/" + action, null)).EnsureSuccessStatusCode();
        (await student.GetAsync($"/api/v1/study/sessions/{session}/next")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PostAsync(root + "/activate", null)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.DeleteAsync(root + $"/assignments/{assignment}")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PutAsJsonAsync(root + $"/students/{SeedIdentifiers.StudentUserId}/difficulty", new { difficulty = "Advanced" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PostAsJsonAsync(root + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { Range() } })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PostAsJsonAsync(root + "/assignments", new { studentUserId = SeedIdentifiers.StudentUserId, type = "PrimarySpecialist", contentPackId = SeedIdentifiers.ContentPackId, range = Range() })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PostAsync(root + "/archive", null)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Student_deactivation_and_reactivation_preserve_user_and_revoke_old_cookies()
    {
        var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var userName = $"lifecycle-{Guid.NewGuid():N}";
        var created = await coach.PostAsJsonAsync(Org + "/students", new { userName, displayName = "Lifecycle student", password = "Student!234" });
        created.EnsureSuccessStatusCode();
        var user = (await created.Content.ReadFromJsonAsync<StudentDto>())!;
        var student = await TestHttp.LoginAsync(factory, userName, "Student!234");
        var untouched = await TestHttp.LoginAsync(factory, userName, "Student!234");
        var endpoint = Org + $"/students/{user.UserId}/state";
        (await student.PutAsJsonAsync(endpoint, new { isActive = false })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await coach.PutAsJsonAsync(endpoint.Replace(SeedIdentifiers.OrganizationId.ToString(), Guid.NewGuid().ToString()), new { isActive = false })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await coach.PutAsJsonAsync(endpoint, new { isActive = false })).EnsureSuccessStatusCode();
        (await student.GetAsync("/api/v1/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using var anonymous = factory.CreateClient();
        (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { identifier = userName, password = "Student!234" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await coach.PutAsJsonAsync(endpoint, new { isActive = true })).EnsureSuccessStatusCode();
        (await untouched.GetAsync("/api/v1/me")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var fresh = await TestHttp.LoginAsync(factory, userName, "Student!234");
        (await fresh.GetAsync("/api/v1/me")).EnsureSuccessStatusCode();
    }

    private static async Task<Guid> Start(HttpClient student, Guid season)
    {
        var response = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season, mode = "Practice" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SessionDto>())!.Id;
    }
    private async Task<(HttpClient Coach, HttpClient Student, Guid Season, Guid Assignment)> Setup()
    {
        var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var response = await coach.PostAsJsonAsync(Org + "/seasons", new { name = "Lifecycle", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        response.EnsureSuccessStatusCode();
        var season = (await response.Content.ReadFromJsonAsync<SeasonDto>())!.Id;
        var root = $"{Org}/seasons/{season}";
        (await coach.PostAsJsonAsync(root + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { Range() } })).EnsureSuccessStatusCode();
        var assignmentResponse = await coach.PostAsJsonAsync(root + "/assignments", new { studentUserId = SeedIdentifiers.StudentUserId, type = "PrimarySpecialist", contentPackId = SeedIdentifiers.ContentPackId, range = Range() });
        assignmentResponse.EnsureSuccessStatusCode();
        var assignment = (await assignmentResponse.Content.ReadFromJsonAsync<AssignmentDto>())!.Id;
        (await coach.PostAsync(root + "/activate", null)).EnsureSuccessStatusCode();
        return (coach, await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234"), season, assignment);
    }
}
