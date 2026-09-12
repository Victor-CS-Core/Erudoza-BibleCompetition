using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class CoachStudentModeTests
{
    [Fact]
    public async Task Personal_plan_is_private_preserves_season_setup_and_produces_real_study_evidence()
    {
        using var factory = new ErudozaApiFactory();
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var me = await coach.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var path = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons";
        var created = await coach.PostAsJsonAsync(path, new { name = "Coach personal season", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        path += "/" + season.Id;
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 5 };
        (await coach.PostAsJsonAsync(path + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { range } })).EnsureSuccessStatusCode();
        var before = await coach.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/my-assignments", new { studentUserId = SeedIdentifiers.StudentUserId, contentPackId = SeedIdentifiers.ContentPackId, type = "RequiredCoverage", range })).StatusCode);
        var response = await coach.PostAsJsonAsync(path + "/my-assignments", new { contentPackId = SeedIdentifiers.ContentPackId, type = "RequiredCoverage", range });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var assignment = await response.Content.ReadFromJsonAsync<AssignmentDto>();
        Assert.Equal(me.GetProperty("userId").GetGuid(), assignment!.StudentUserId);
        Assert.Single((await coach.GetFromJsonAsync<AssignmentDto[]>(path + "/my-assignments"))!);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PutAsJsonAsync(path + "/assignments/" + assignment.Id + "/passage", range)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.DeleteAsync(path + "/assignments/" + assignment.Id)).StatusCode);
        var studentAssigned = await coach.PostAsJsonAsync(path + "/assignments", new { studentUserId = SeedIdentifiers.StudentUserId, contentPackId = SeedIdentifiers.ContentPackId, type = "RequiredCoverage", range });
        studentAssigned.EnsureSuccessStatusCode();
        var studentAssignment = (await studentAssigned.Content.ReadFromJsonAsync<AssignmentDto>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await coach.DeleteAsync(path + "/my-assignments/" + studentAssignment.Id)).StatusCode);
        (await coach.DeleteAsync(path + "/assignments/" + studentAssignment.Id)).EnsureSuccessStatusCode();
        Assert.Empty((await coach.GetFromJsonAsync<AssignmentDto[]>(path + "/assignments"))!);
        var after = await coach.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal(before.GetProperty("status").GetString(), after.GetProperty("status").GetString());
        Assert.Equal(0, after.GetProperty("assignmentCount").GetInt32());
        var coverage = await coach.GetFromJsonAsync<JsonElement>(path + "/coverage");
        Assert.Empty(coverage.GetProperty("students").EnumerateArray());
        Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync(path + "/my-assignments")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season.Id, mode = "Practice" })).StatusCode);
        (await coach.PostAsync(path + "/activate", null)).EnsureSuccessStatusCode();
        var started = await coach.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season.Id, mode = "Practice" });
        started.EnsureSuccessStatusCode();
        var session = (await started.Content.ReadFromJsonAsync<SessionDto>())!;
        (await coach.GetAsync($"/api/v1/study/seasons/{season.Id}/scripture")).EnsureSuccessStatusCode();
        (await coach.GetAsync($"/api/v1/progress/me/today?seasonId={season.Id}")).EnsureSuccessStatusCode();
        (await coach.GetAsync($"/api/v1/progress/me/honors?seasonId={season.Id}")).EnsureSuccessStatusCode();
        var card = await coach.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{session.Id}/next");
        (await coach.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new { clientSubmissionId = "coach-evidence", challengeCardId = card.GetProperty("id").GetGuid(), submittedAnswer = card.GetProperty("debugAnswer").GetString(), responseTimeMs = 1200, hintsUsed = false })).EnsureSuccessStatusCode();
        (await coach.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null)).EnsureSuccessStatusCode();
        var progress = await coach.GetFromJsonAsync<ProgressDto>("/api/v1/progress/me");
        Assert.True(progress!.AttemptCount > 0);
        Assert.NotEmpty(progress.Mastery);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PutAsJsonAsync(path + "/students/" + assignment.StudentUserId + "/difficulty", new { difficulty = "Advanced" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await coach.GetAsync(path + "/students/" + assignment.StudentUserId + "/progress")).StatusCode);
        (await coach.DeleteAsync(path + "/my-assignments/" + assignment.Id)).EnsureSuccessStatusCode();
        (await coach.GetAsync($"/api/v1/study/sessions/{session.Id}/recap")).EnsureSuccessStatusCode();
        (await coach.PostAsync(path + "/close", null)).EnsureSuccessStatusCode();
        (await coach.GetAsync($"/api/v1/study/sessions/{session.Id}/recap")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/my-assignments", new { contentPackId = SeedIdentifiers.ContentPackId, type = "RequiredCoverage", range })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season.Id, mode = "Practice" })).StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        Assert.True(await db.Attempts.AnyAsync(a => a.SessionId == session.Id));
        Assert.True(await db.MasteryStates.AnyAsync(m => m.StudentUserId == assignment.StudentUserId && m.SeasonId == season.Id));
        Assert.True(await db.CompetitionMembers.AnyAsync(m => m.UserId == assignment.StudentUserId && m.SeasonId == season.Id));
    }
}
