using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Api.Practice;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class PbeDisputeTests
{
    [Fact]
    public async Task Solo_actual_acceptance_can_be_reviewed_with_team_control_off_without_rewriting_the_attempt()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var started = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = started.GetProperty("id").GetGuid(); var card = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{sessionId}/next");
        var owner = (await f.Student.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        var snapshot = JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == sessionId.ToString())).DataJson, PbeQuestionBank.Json)!; var frozen = snapshot.Cards.Single(c => c.Id == card.GetProperty("id").GetGuid()).Question; var question = frozen.Id; var targets = frozen.Parts.Select(p => p.TargetId).Distinct().ToArray();
        var progress = new PbeProgressService(f.Db);
        for (var n = 0; n < 321; n++) { var attempt = Guid.NewGuid(); var items = targets.Select(t => new PbeRecallEvidence(attempt, t, question, n * 86400000L, 1, 1, true, true)).ToArray(); await progress.ExecuteAsync(ct => progress.PrepareRecallEvidenceAsync(f.Org, f.Season, owner, "older-frozen-scope", items, ct, "List")); f.Db.ChangeTracker.Clear(); }
        var accepted = await (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{sessionId}/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "wrong" }, hintsUsed = false })).Content.ReadFromJsonAsync<JsonElement>();
        (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{sessionId}/complete", new { })).EnsureSuccessStatusCode();
        var original = (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == sessionId.ToString())).DataJson;
        var input = new { activity = "Solo", sessionId, attemptId = accepted.GetProperty("attemptId").GetGuid(), reason = "Please check the second part." };
        var flag = await f.Student.PostAsJsonAsync("/api/v1/pbe/disputes", input); Assert.Equal(HttpStatusCode.Created, flag.StatusCode);
        await AssertReview(f.Student, f.Coach, await flag.Content.ReadFromJsonAsync<JsonElement>(), input);
        Assert.Equal(original, (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == sessionId.ToString())).DataJson);
        Assert.Single(await f.Db.PbeTrainingRecords.Where(r => r.Kind == "pbe-grade-adjustment").ToListAsync());
        var recap = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{sessionId}/recap"); Assert.Equal(2, recap.GetProperty("results")[0].GetProperty("earnedPoints").GetInt32()); Assert.Equal(1, recap.GetProperty("results")[0].GetProperty("originalEarnedPoints").GetInt32());
        var recovery = await f.Coach.GetFromJsonAsync<JsonElement>("/api/v1/pbe/disputes"); Assert.Single(recovery.GetProperty("items").EnumerateArray()); Assert.Equal("Resolved", recovery.GetProperty("items")[0].GetProperty("status").GetString());
        var disputeId = $"Solo:{sessionId}:{input.attemptId}"; var ready = false;
        for (var page = 0; page < 20; page++) { var batch = await (await f.Coach.PostAsJsonAsync("/api/v1/pbe/disputes/" + Uri.EscapeDataString(disputeId) + "/replay", new { })).Content.ReadFromJsonAsync<JsonElement>(); Assert.Equal("Provisional", batch.GetProperty("status").GetString()); }
        Assert.Single((await f.Coach.GetFromJsonAsync<JsonElement>("/api/v1/pbe/disputes")).GetProperty("items").EnumerateArray());
        for (var page = 0; page < 64 && !ready; page++) { var replay = await f.Coach.PostAsJsonAsync("/api/v1/pbe/disputes/" + Uri.EscapeDataString(disputeId) + "/replay", new { }); Assert.Equal(HttpStatusCode.OK, replay.StatusCode); ready = (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString() == "Ready"; }
        Assert.Empty((await f.Coach.GetFromJsonAsync<JsonElement>("/api/v1/pbe/disputes")).GetProperty("items").EnumerateArray());
        (await f.Coach.PostAsJsonAsync("/api/v1/pbe/disputes/" + Uri.EscapeDataString(disputeId) + "/resolve", new { expectedRevision = 1, pointsByPart = new[] { 1, 1 }, reason = "Both labels are supported by the frozen source." })).EnsureSuccessStatusCode();
        Assert.Empty((await f.Coach.GetFromJsonAsync<JsonElement>("/api/v1/pbe/disputes")).GetProperty("items").EnumerateArray());
        Assert.True(ready); var proofs = await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.Kind == "pbe-target-review" && r.SeasonId == f.Season).ToListAsync(); Assert.All(proofs, row => Assert.False(JsonDocument.Parse(row.DataJson).RootElement.GetProperty("review").GetProperty("unresolved").GetBoolean()));
    }
    [Theory]
    [InlineData(false, 10, false, 2, 2)]
    [InlineData(true, 10, false, 2, 2)]
    [InlineData(false, 30, false, 2, 2)]
    [InlineData(false, 10, true, 2, 2)]
    [InlineData(false, 90, false, 1, 6)]
    [InlineData(false, 90, false, 2, 6)]
    [InlineData(false, 90, false, 2, 2, true)]
    public async Task Team_actual_authority_retains_immutable_attempt_and_hides_unreviewed_interrupted_final(bool interrupted, int questionCount, bool coached, int teamCount, int teamSize, bool threshold = false)
    {
        var time = new TestTime(); using var f = await PracticeRoomHttpTests.Setup.Create(true, time);
        var clients = new List<HttpClient> { f.Owner }; for (var n = 1; n < teamCount * teamSize; n++) clients.Add(await f.Student("dispute-player"));
        var outsider = await f.Student("dispute-outsider"); var opponent = teamCount == 2 ? clients[teamSize] : outsider;
        var ids = new List<Guid>(); foreach (var c in clients) ids.Add((await c.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid());
        using (var scope = f.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.Seasons.SingleAsync(s => s.Id == f.SeasonId)).PbeEnabled = true;
            var source = await db.SourceUnits.Include(s => s.ContentPack).SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"));
            foreach (var id in ids) { db.CompetitionMembers.Add(new() { OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = f.SeasonId, UserId = id, Difficulty = TrainingDifficulty.Advanced }); db.Assignments.Add(new() { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = f.SeasonId, StudentUserId = id, Type = AssignmentType.RequiredCoverage, Scopes = [new() { Id = Guid.NewGuid(), ContentPackId = source.ContentPackId, BookKey = "DAN", StartChapter = 1, EndChapter = 1, StartVerse = 1, EndVerse = 1 }] }); }
            var targets = Enumerable.Range(0, 2).Select(n => new PbeTarget { Id = Guid.NewGuid(), SourceUnitIds = [source.Id], Skill = RecallSkill.FactualRecall, Label = "Person " + n }).ToArray();
            foreach (var target in targets) db.PbeTrainingRecords.Add(new() { Kind = "pbe-target", Id = target.Id.ToString(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = f.SeasonId, OwnerId = source.Id, DataJson = JsonSerializer.Serialize(target, PbeQuestionBank.Json) });
            for (var n = 0; n < questionCount + 1; n++) { var q = new PbeQuestion { SchemaVersion = 2, Id = Guid.NewGuid(), Version = 1, ContentPackId = source.ContentPackId, SourceUnitId = source.Id, SourceUnitIds = [source.Id], SourceKind = PbeSourceKind.Scripture, Reference = source.CitationLabel, Evidence = "Daniel purposed in his heart", Kind = PbeQuestionKind.List, Prompt = "Name the labels " + n, Ordered = false, Parts = targets.Select((t, i) => new PbeQuestionPart { TargetId = t.Id, AcceptedAnswers = [i == 0 ? "Daniel" : "heart"], Points = 1 }).ToList() }; db.PbeTrainingRecords.Add(new() { Kind = "pbe-question-head", Id = q.Id.ToString(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = f.SeasonId, OwnerId = source.Id, DataJson = JsonSerializer.Serialize(new PbeBankQuestionData(q.Id.ToString(), f.SeasonId, true, q, PbeQuestionBank.SourceProof(q, new Dictionary<Guid, SourceUnit> { { source.Id, source } })), PbeQuestionBank.Json) }); }
            await db.SaveChangesAsync();
        }
        var created = await f.Admin.PostAsJsonAsync(f.Path + "/rooms", new { seasonId = f.SeasonId, format = "Pbe", teamCount, teamSize, questionCount, coached }); created.EnsureSuccessStatusCode(); var room = await created.Content.ReadFromJsonAsync<JsonElement>(); var roomId = room.GetProperty("id").GetGuid(); var path = f.Path + "/rooms/" + roomId;
        async Task Command(HttpClient client, string action, object? extra = null) { var fields = new Dictionary<string, object?> { ["commandId"] = Guid.NewGuid(), ["revision"] = room.GetProperty("revision").GetInt64(), ["action"] = action }; if (extra is not null) foreach (var p in JsonSerializer.SerializeToElement(extra).EnumerateObject()) fields[p.Name] = p.Value; var response = await client.PostAsJsonAsync(path + "/commands", fields); Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); room = await response.Content.ReadFromJsonAsync<JsonElement>(); }
        for (var n = 0; n < clients.Count; n++) { await Command(f.Admin, "invite", new { targetUserId = ids[n], team = n / teamSize + 1 }); var inbox = await clients[n].GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap"); var accepted = await clients[n].PostAsJsonAsync(f.Path + "/invitations/" + inbox.GetProperty("invitations")[0].GetProperty("id").GetGuid() + "/accept", new { team = n / teamSize + 1 }); accepted.EnsureSuccessStatusCode(); room = await accepted.Content.ReadFromJsonAsync<JsonElement>(); }
        foreach (var c in clients) await Command(c, "ready"); await Command(coached ? f.Admin : clients[0], "start"); var questionId = room.GetProperty("question").GetProperty("id").GetGuid();
        if (coached) { await Command(clients[0], "present-ready", new { questionId }); if (teamCount == 2) await Command(clients[teamSize], "present-ready", new { questionId }); await Command(f.Admin, "present", new { questionId, delivery = "Coach" }); }
        else { await Command(clients[0], "present", new { questionId, delivery = "Audio" }); if (teamCount == 2) await Command(clients[teamSize], "present", new { questionId, delivery = "TextFallback" }); }
        time.Advance(TimeSpan.FromSeconds(3));
        await Command(clients[0], "submit", new { questionId, answers = threshold ? new[] { "wrong", "wrong" } : new[] { "Daniel", "wrong" } });
        string original; string attemptId;
        using (var scope = f.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var record = await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == roomId); var state = PracticeJson.Read<PracticeRoom>(record.StateJson); original = PracticeJson.Write(state.Submissions[0]); attemptId = state.Submissions[0].AttemptId.ToString(); Assert.NotEqual(Guid.Empty.ToString(), attemptId); if (interrupted) { state.ProcessId = "replacement"; record.StateJson = PracticeJson.Write(state); await db.SaveChangesAsync(); } }
        if (interrupted) { room = await clients[0].GetFromJsonAsync<JsonElement>(path); Assert.Equal("Interrupted", room.GetProperty("status").GetString()); Assert.Single(room.GetProperty("results").EnumerateArray()); var other = await opponent.GetFromJsonAsync<JsonElement>(path); Assert.Empty(other.GetProperty("results").EnumerateArray()); Assert.DoesNotContain("acceptedAnswers", other.GetRawText()); var coach = await f.Admin.GetFromJsonAsync<JsonElement>(path); Assert.Single(coach.GetProperty("results").EnumerateArray()); }
        else if (teamCount == 2) await Command(clients[teamSize], "submit", new { questionId, answers = new[] { "wrong", "wrong" } });
        foreach (var action in new[] { "appeal", "judge" })
        {
            string before; using (var scope = f.Factory.Services.CreateScope()) before = (await scope.ServiceProvider.GetRequiredService<ErudozaDbContext>().Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == roomId)).StateJson;
            var rejection = await (action == "judge" ? f.Admin : clients[0]).PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action, questionId, team = 1, points = 2, text = "Legacy mutation must not bypass the rubric review" }); Assert.Contains(rejection.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict });
            using var afterScope = f.Factory.Services.CreateScope(); Assert.Equal(before, (await afterScope.ServiceProvider.GetRequiredService<ErudozaDbContext>().Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == roomId)).StateJson);
        }
        var input = new { activity = "Team", sessionId = roomId, attemptId, reason = "Please check the second part." };
        Assert.Equal(HttpStatusCode.Forbidden, (await opponent.PostAsJsonAsync("/api/v1/pbe/disputes", input)).StatusCode);
        var flag = await clients[0].PostAsJsonAsync("/api/v1/pbe/disputes", input); Assert.Equal(HttpStatusCode.Created, flag.StatusCode);
        var pending = await clients[0].GetFromJsonAsync<JsonElement>(path); Assert.True(pending.GetProperty("provisional").GetBoolean()); Assert.Equal(threshold ? 0 : 100, pending.GetProperty("results")[0].GetProperty("accuracyHundredths").GetInt32());
        var d = await flag.Content.ReadFromJsonAsync<JsonElement>(); var reviewPath = "/api/v1/pbe/disputes/" + Uri.EscapeDataString(d.GetProperty("id").GetString()!);
        Assert.Equal(HttpStatusCode.Forbidden, (await opponent.GetAsync(reviewPath)).StatusCode);
        (await f.Admin.PostAsJsonAsync(f.Path + "/enabled", new { enabled = false })).EnsureSuccessStatusCode(); Assert.Empty((await f.Admin.GetFromJsonAsync<JsonElement>("/api/v1/pbe/disputes")).GetProperty("items").EnumerateArray()); Assert.Equal(HttpStatusCode.Forbidden, (await clients[0].GetAsync(reviewPath)).StatusCode); (await f.Admin.PostAsJsonAsync(f.Path + "/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        if (questionCount >= 30)
        {
            var scribes = Enumerable.Range(0, teamCount).Select(t => t * teamSize).ToArray(); var breaks = 0;
            room = await clients[0].GetFromJsonAsync<JsonElement>(path);
            for (var q = 1; q < questionCount; q++)
            {
                if (q == 15) { for (var team = 0; team < teamCount; team++) { scribes[team] = team * teamSize + 1; await Command(clients[team * teamSize], "scribe", new { targetUserId = ids[scribes[team]] }); } }
                time.Advance(TimeSpan.FromSeconds(10)); room = await clients[0].GetFromJsonAsync<JsonElement>(path);
                if (room.GetProperty("phase").GetString() == "Break") { breaks++; Assert.Equal(questionCount / 2, q); Assert.Equal(JsonValueKind.Null, room.GetProperty("question").ValueKind); time.Advance(TimeSpan.FromMinutes(5)); room = await clients[0].GetFromJsonAsync<JsonElement>(path); }
                if (q == 16) { using var reconnect = await TestHttp.LoginAsync(f.Factory, "daniel.student", "DevStudent!234"); var resumed = await reconnect.GetFromJsonAsync<JsonElement>(path); Assert.Equal(room.GetProperty("questionIndex").GetInt32(), resumed.GetProperty("questionIndex").GetInt32()); }
                var next = room.GetProperty("question").GetProperty("id").GetGuid();
                for (var team = 0; team < teamCount; team++) await Command(clients[scribes[team]], "present", new { questionId = next, delivery = team == 0 ? "TextFallback" : "Audio" }); time.Advance(TimeSpan.FromSeconds(3));
                for (var team = 0; team < teamCount; team++) await Command(clients[scribes[team]], "submit", new { questionId = next, answers = threshold && team == 0 && q > 80 ? (q == 81 ? new[] { "Daniel", "wrong" } : new[] { "wrong", "wrong" }) : new[] { "Daniel", "heart" } });
            }
            time.Advance(TimeSpan.FromSeconds(10)); room = await clients[0].GetFromJsonAsync<JsonElement>(path); Assert.Equal("Completed", room.GetProperty("status").GetString()); Assert.Equal(questionCount == 90 ? 1 : 0, breaks); Assert.Equal(questionCount * teamCount, room.GetProperty("results").GetArrayLength());
            var bootstrap = await clients[0].GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap"); var keys = bootstrap.GetProperty("achievements").EnumerateArray().Select(a => a.GetProperty("key").GetString()).ToList(); Assert.Contains("pbe-team-v1:first-fellowship", keys); if (questionCount == 30 || threshold) Assert.DoesNotContain("pbe-team-v1:team-precision", keys);
            var trend = bootstrap.GetProperty("trends")[0]; Assert.Equal(1, trend.GetProperty("pendingCount").GetInt32()); Assert.Equal(threshold ? 16100 : (questionCount - 1) * 200, trend.GetProperty("accuracyHundredths").GetInt32()); Assert.Equal((questionCount - 1) * 200, trend.GetProperty("availableHundredths").GetInt32());
            Assert.Equal(questionCount, trend.GetProperty("distinctQuestions").GetInt32()); Assert.Equal(1, trend.GetProperty("distinctPassages").GetInt32());
            if (teamCount == 2) { var other = await opponent.GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap"); Assert.Contains(other.GetProperty("achievements").EnumerateArray(), a => a.GetProperty("key").GetString() == "pbe-team-v1:team-precision"); }
            (await clients[0].PostAsJsonAsync(f.Path + "/rooms", new { seasonId = f.SeasonId, format = "Pbe", teamCount, teamSize, questionCount })).EnsureSuccessStatusCode();
        }
        if (threshold)
        {
            Assert.Equal(d.GetRawText(), (await (await clients[0].PostAsJsonAsync("/api/v1/pbe/disputes", input)).Content.ReadFromJsonAsync<JsonElement>()).GetRawText());
            var ruling = new { expectedRevision = 1, pointsByPart = new[] { 0, 0 }, reason = "Original zero confirmed" };
            (await f.Admin.PostAsJsonAsync(reviewPath + "/resolve", ruling)).EnsureSuccessStatusCode(); (await f.Admin.PostAsJsonAsync(reviewPath + "/resolve", ruling)).EnsureSuccessStatusCode();
            var after = await clients[0].GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap"); Assert.DoesNotContain(after.GetProperty("achievements").EnumerateArray(), a => a.GetProperty("key").GetString() == "pbe-team-v1:team-precision"); return;
        }
        await AssertReview(clients[0], f.Admin, d, input);
        var corrected = await clients[0].GetFromJsonAsync<JsonElement>(path); Assert.False(corrected.GetProperty("provisional").GetBoolean()); Assert.Equal(200, corrected.GetProperty("results")[0].GetProperty("accuracyHundredths").GetInt32());
        if (questionCount >= 30)
        {
            var bootstrap = await clients[0].GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap"); Assert.Single(bootstrap.GetProperty("achievements").EnumerateArray(), a => a.GetProperty("key").GetString() == "pbe-team-v1:team-precision");
            using var scope = f.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); Assert.Single(await db.Set<PracticeAwardRecord>().Where(a => a.UserId == ids[0] && a.Key == "pbe-team-v1:team-precision").ToListAsync());
            Assert.Empty(await db.MasteryHonorUnlocks.Where(h => h.UserId == ids[0]).ToListAsync());
        }
        using (var scope = f.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var state = PracticeJson.Read<PracticeRoom>((await db.Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == roomId)).StateJson); Assert.Equal(original, PracticeJson.Write(state.Submissions[0])); Assert.Single(await db.PbeTrainingRecords.Where(r => r.Kind == "pbe-grade-adjustment").ToListAsync()); if (questionCount == 90) { var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../..")); Directory.CreateDirectory(Path.Combine(root, ".local")); var snapshot = PracticeJson.Write(state); await File.WriteAllTextAsync(Path.Combine(root, ".local", $"c3-canonical-full90-{teamCount}.json"), snapshot); await File.WriteAllTextAsync(Path.Combine(root, ".local", $"c3-canonical-full90-size-{teamCount}.json"), JsonSerializer.Serialize(new { roster = state.Members.Count, questions = state.Questions.Count, reserves = state.Reserves.Count, finals = state.Submissions.Count, utf8Bytes = System.Text.Encoding.UTF8.GetByteCount(snapshot), phase = state.Phase, state.Status })); } }
    }
    private sealed class TestTime : TimeProvider { private long stamp; public override long TimestampFrequency => TimeSpan.TicksPerSecond; public override long GetTimestamp() => stamp; public override DateTimeOffset GetUtcNow() => new DateTimeOffset(2026, 9, 12, 12, 0, 0, TimeSpan.Zero).AddTicks(stamp); public void Advance(TimeSpan span) => stamp += span.Ticks; }
    static async Task AssertReview(HttpClient student, HttpClient coach, JsonElement dispute, object input)
    {
        Assert.Equal(1, dispute.GetProperty("revision").GetInt32()); Assert.Equal(1, dispute.GetProperty("questionVersion").GetInt32()); Assert.Equal(new[] { 1, 1 }, dispute.GetProperty("partPoints").EnumerateArray().Select(p => p.GetInt32()));
        var path = "/api/v1/pbe/disputes/" + Uri.EscapeDataString(dispute.GetProperty("id").GetString()!);
        Assert.Equal(dispute.GetRawText(), (await (await student.PostAsJsonAsync("/api/v1/pbe/disputes", input)).Content.ReadFromJsonAsync<JsonElement>()).GetRawText());
        Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync("/api/v1/pbe/disputes")).StatusCode);
        var queue = await coach.GetFromJsonAsync<JsonElement>("/api/v1/pbe/disputes"); Assert.Single(queue.GetProperty("items").EnumerateArray());
        var resolve = new { expectedRevision = 1, pointsByPart = new[] { 1, 1 }, reason = "Both labels are supported by the frozen source." };
        Assert.Equal(HttpStatusCode.Forbidden, (await student.PostAsJsonAsync(path + "/resolve", resolve)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/resolve", new { expectedRevision = 1, pointsByPart = new[] { 2, 0 }, reason = "Outside the saved cap" })).StatusCode);
        var response = await coach.PostAsJsonAsync(path + "/resolve", resolve); Assert.Equal(HttpStatusCode.OK, response.StatusCode); var final = await response.Content.ReadFromJsonAsync<JsonElement>(); Assert.Equal("Resolved", final.GetProperty("status").GetString()); Assert.Equal(2, final.GetProperty("revision").GetInt32());
        Assert.Equal(final.GetRawText(), (await (await coach.PostAsJsonAsync(path + "/resolve", resolve)).Content.ReadFromJsonAsync<JsonElement>()).GetRawText());
        Assert.Equal(HttpStatusCode.Conflict, (await coach.PostAsJsonAsync(path + "/resolve", new { expectedRevision = 2, resolve.pointsByPart, resolve.reason })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await coach.PostAsJsonAsync(path + "/resolve", new { expectedRevision = 1, resolve.pointsByPart, reason = "Changed ruling" })).StatusCode);
    }
}
