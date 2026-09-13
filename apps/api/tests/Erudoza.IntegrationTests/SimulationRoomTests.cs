using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Honors;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class SimulationRoomTests
{
    [Fact]
    public void Simulation_awards_require_actual_served_members_and_never_accept_pvp()
    {
        var user = Guid.NewGuid();
        var room = new Erudoza.Api.Practice.PracticeRoom
        {
            Format = "Pbe",
            TeamCount = 1,
            Status = "Completed",
            CompletedAt = DateTimeOffset.UtcNow,
            Simulation = new(1, "Custom", [], [], true, true, 1, false, "Chat"),
            Members = [new() { UserId = user, Team = 1 }]
        };
        var method = typeof(Erudoza.Api.Practice.PracticeService).GetMethod("CalculateSimulationAchievements", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        Assert.NotNull(method);
        var result = JsonSerializer.SerializeToElement(method.Invoke(null, new object[] { new[] { room }, user }), Erudoza.Api.Practice.PracticeJson.Options);
        Assert.All(result.EnumerateArray(), a => Assert.Equal(JsonValueKind.Null, a.GetProperty("earnedAtUtc").ValueKind));
    }

    [Fact]
    public void Latest_pending_or_corrected_results_revoke_precision_without_using_pvp_evidence()
    {
        var user = Guid.NewGuid(); var season = Guid.NewGuid(); var at = DateTimeOffset.Parse("2026-09-13T12:00:00Z");
        var room = new Erudoza.Api.Practice.PracticeRoom
        {
            Format = "Pbe",
            TeamCount = 1,
            SeasonId = season,
            Status = "Completed",
            CompletedAt = at,
            QuestionCount = 30,
            Simulation = new(1, "Custom", [], [], true, true, 1, false, "Chat"),
            Members = [new() { UserId = user, Team = 1 }]
        };
        for (var n = 0; n < 30; n++)
        {
            var id = Guid.NewGuid(); room.Questions.Add(new() { Id = id, Parts = [new() { Points = 1 }] });
            room.Services.Add(new(Guid.NewGuid(), id, "ShortAnswer", [], [user], at.ToUnixTimeMilliseconds()));
            room.Submissions.Add(new() { QuestionId = id, Team = 1, ScribeId = user, AccuracyHundredths = 100 });
        }
        var method = typeof(Erudoza.Api.Practice.PracticeService).GetMethod("CalculateSimulationAchievements", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic)!;
        JsonElement Evaluate(params Erudoza.Api.Practice.PracticeRoom[] rooms) => JsonSerializer.SerializeToElement(method.Invoke(null, new object[] { rooms, user }), Erudoza.Api.Practice.PracticeJson.Options);
        bool Earned(JsonElement data, string key) => data.EnumerateArray().Single(a => a.GetProperty("key").GetString() == key).GetProperty("earnedAtUtc").ValueKind != JsonValueKind.Null;
        Assert.True(Earned(Evaluate(room), "simulation:team-precision")); Assert.True(Earned(Evaluate(room), "simulation:trusted-scribe"));
        var latest = Erudoza.Api.Practice.PracticeJson.Read<Erudoza.Api.Practice.PracticeRoom>(Erudoza.Api.Practice.PracticeJson.Write(room)); latest.Id = Guid.NewGuid(); latest.CompletedAt = at.AddDays(1);
        latest.Submissions[0].Resolved = false; Assert.False(Earned(Evaluate(room, latest), "simulation:team-precision"));
        latest.Submissions[0].Resolved = true; foreach (var answer in latest.Submissions) answer.AccuracyHundredths = 0;
        Assert.False(Earned(Evaluate(room, latest), "simulation:team-precision"));
        foreach (var answer in room.Submissions) answer.ResponseLockedAtUtc = at.AddHours(2);
        foreach (var answer in latest.Submissions) answer.ResponseLockedAtUtc = at.AddHours(1);
        Assert.True(Earned(Evaluate(room, latest), "simulation:team-precision"));
        latest.TeamCount = 2; Assert.True(Earned(Evaluate(room, latest), "simulation:team-precision"));
        room.Services.Clear(); Assert.False(Earned(Evaluate(room), "simulation:first-rehearsal"));
    }

    [Fact]
    public async Task Profile_identity_revokes_simulation_selection_when_review_eligibility_is_removed()
    {
        using var fixture = await PracticeRoomHttpTests.Setup.Create();
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var user = SeedIdentifiers.StudentUserId; var org = SeedIdentifiers.OrganizationId; const string key = "simulation:team-precision";
        var unlock = new MasteryHonorUnlock { OrganizationId = org, UserId = user, SeasonId = fixture.SeasonId, Key = key, RuleVersion = "simulation-v1", EarnedAtUtc = DateTimeOffset.UtcNow };
        db.MasteryHonorUnlocks.Add(unlock);
        var eligibility = new PbeTrainingRecord { OrganizationId = org, SeasonId = fixture.SeasonId, OwnerId = user, Kind = "simulation-eligibility", Id = $"{user}:{fixture.SeasonId}:{key}", DataJson = "{\"key\":\"simulation:team-precision\"}" };
        db.PbeTrainingRecords.Add(eligibility); await db.SaveChangesAsync();
        var service = new MasteryHonorService(db); var selected = await service.SelectAsync(org, user, key, default);
        Assert.Equal(key, selected.AvatarHonorKey); Assert.Contains(selected.Honors, h => h.Key == key && h.Category == "Simulation" && h.RuleVersion == "simulation-v1");
        db.PbeTrainingRecords.Remove(eligibility); await db.SaveChangesAsync();
        Assert.Null((await service.ProfileAsync(org, user, default)).AvatarHonorKey);
        Assert.Null((await service.IdentitiesAsync(org, [user.ToString()], default)).Single().AvatarHonorKey);
        await Assert.ThrowsAsync<MasteryHonorLockedException>(() => service.SelectAsync(org, user, key, default));
        Assert.True(await db.MasteryHonorUnlocks.AnyAsync(u => u.Id == unlock.Id));
    }

    [Fact]
    public async Task Simulation_configuration_cannot_be_attached_to_arcade_or_two_teams()
    {
        using var fixture = await PracticeRoomHttpTests.Setup.Create();
        var response = await fixture.Owner.PostAsJsonAsync(fixture.Path + "/rooms", new
        {
            seasonId = fixture.SeasonId,
            teamSize = 2,
            questionCount = 10,
            format = "Arcade",
            teamCount = 2,
            simulation = new { version = 1, preset = "Custom", bookKeys = Array.Empty<string>(), chapters = Array.Empty<object>(), includeScripture = true, includeIntroductions = true, timeMultiplier = 2, halfTime = false, discussion = "InPerson" }
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
