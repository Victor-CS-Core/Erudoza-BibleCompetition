using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class PbeStudyTests
{
    [Fact]
    public async Task Armed_simulation_without_live_authority_resumes_as_restartable_interruption()
    {
        using var f = await Fixture.Create();
        var started = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).Content.ReadFromJsonAsync<JsonElement>();
        var id = started.GetProperty("id").GetGuid();
        var card = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}/next");
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString());
        var snapshot = JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!;
        snapshot.Mode = "Simulation"; snapshot.TimingStatus = "Armed"; snapshot.TimingQuestionId = card.GetProperty("id").GetGuid();
        row.DataJson = JsonSerializer.Serialize(snapshot, PbeQuestionBank.Json); await f.Db.SaveChangesAsync();

        var resumed = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}");
        Assert.Equal("Interrupted", resumed.GetProperty("session").GetProperty("status").GetString());
        Assert.True(resumed.GetProperty("interruption").GetProperty("restartAllowed").GetBoolean());
        Assert.Equal(JsonValueKind.Null, resumed.GetProperty("card").ValueKind);
        Assert.Equal("Interrupted", (await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}")).GetProperty("session").GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.GetAsync($"/api/v1/study/sessions/{id}/next")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "present", delivery = "TextFallback" })).StatusCode);
        var recap = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}/recap");
        Assert.Equal(0, recap.GetProperty("attempted").GetInt32());
        Assert.False(recap.GetProperty("fullTargetReached").GetBoolean());
    }

    [Fact]
    public async Task Persisted_timed_draft_survives_authority_loss_and_projects_without_a_client_request()
    {
        using var f = await Fixture.Create();
        var started = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).Content.ReadFromJsonAsync<JsonElement>();
        var id = started.GetProperty("id").GetGuid(); var card = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}/next");
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString());
        var snapshot = JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!; snapshot.Mode = "Simulation";
        snapshot.Timing = new() { QuestionId = card.GetProperty("id").GetGuid(), Revision = 1, Delivery = "TextFallback", Status = "Armed", DraftAnswers = ["Alpha", "Beta"], DraftElapsedMs = 1000, DraftLockedAtUtc = DateTimeOffset.UnixEpoch.AddSeconds(1) };
        row.DataJson = JsonSerializer.Serialize(snapshot, PbeQuestionBank.Json);
        f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.StudentId, Kind = "pbe-solo-outbox", Id = id.ToString(), DataJson = JsonSerializer.Serialize(new PbeSoloOutbox(id), PbeQuestionBank.Json) }); await f.Db.SaveChangesAsync();
        using (var processorScope = f.Factory.Services.CreateScope()) await processorScope.ServiceProvider.GetRequiredService<PbeSoloExpiryProcessor>().RunOnceAsync(null);
        var accepted = Assert.Single((JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString())).DataJson, PbeQuestionBank.Json)!).Attempts);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-solo-outbox" && r.Id == id.ToString()));
        await f.Student.GetAsync($"/api/v1/study/sessions/{id}/next");
        (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "present", delivery = "TextFallback" })).EnsureSuccessStatusCode();
        var retry = await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "submit", questionId = accepted.CardId, revision = 1, answers = accepted.OriginalTimedAnswers, clientSubmissionId = accepted.ClientSubmissionId });
        retry.EnsureSuccessStatusCode();
        Assert.True((await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("alreadyProcessed").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "submit", questionId = accepted.CardId, revision = 1, answers = new[] { "changed", "answer" }, clientSubmissionId = accepted.ClientSubmissionId })).StatusCode);
    }

    [Fact]
    public async Task Live_authority_expiry_projects_the_durable_draft_without_a_client_request()
    {
        var time = new ManualTime();
        using var f = await Fixture.Create(time);
        var started = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).Content.ReadFromJsonAsync<JsonElement>();
        var id = started.GetProperty("id").GetGuid();
        var card = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}/next");
        var cardId = card.GetProperty("id").GetGuid();
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString());
        var snapshot = JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!;
        snapshot.Mode = "Simulation";
        row.DataJson = JsonSerializer.Serialize(snapshot, PbeQuestionBank.Json);
        await f.Db.SaveChangesAsync();

        var presented = await (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "present", delivery = "TextFallback" })).Content.ReadFromJsonAsync<JsonElement>();
        var revision = presented.GetProperty("revision").GetInt32();
        (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "ack", questionId = cardId, revision, delivery = "TextFallback" })).EnsureSuccessStatusCode();
        time.Advance(TimeSpan.FromSeconds(4));
        (await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{id}/timed", new { action = "draft", questionId = cardId, revision, answers = new[] { "Alpha", "Beta" } })).EnsureSuccessStatusCode();
        time.Advance(TimeSpan.FromSeconds(30));

        using (var processorScope = f.Factory.Services.CreateScope())
            await processorScope.ServiceProvider.GetRequiredService<PbeSoloExpiryProcessor>().RunOnceAsync(null);

        var saved = JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString())).DataJson, PbeQuestionBank.Json)!;
        Assert.Equal(["Alpha", "Beta"], Assert.Single(saved.Attempts).Answers);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-solo-outbox" && r.Id == id.ToString()));
    }

    [Fact]
    public async Task Persisted_frozen_outbox_retries_original_envelope_after_projection_guard_failure()
    {
        using var f = await Fixture.Create();
        var started = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).Content.ReadFromJsonAsync<JsonElement>();
        var id = started.GetProperty("id").GetGuid(); var card = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{id}/next"); var cardId = card.GetProperty("id").GetGuid();
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString()); var snapshot = JsonSerializer.Deserialize<PbeSessionSnapshot>(row.DataJson, PbeQuestionBank.Json)!; snapshot.Mode = "Simulation";
        snapshot.Timing = new() { QuestionId = cardId, Revision = 1, Delivery = "TextFallback", Status = "Frozen", ClientSubmissionId = "durable-final", Answers = ["Alpha", "Beta"], RetryAnswers = ["Alpha", "Beta"], ElapsedMs = 1000, LockedAtUtc = DateTimeOffset.UnixEpoch.AddSeconds(1) };
        row.DataJson = JsonSerializer.Serialize(snapshot, PbeQuestionBank.Json); f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.StudentId, Kind = "pbe-solo-outbox", Id = id.ToString(), DataJson = JsonSerializer.Serialize(new PbeSoloOutbox(id), PbeQuestionBank.Json) });
        var membership = await f.Db.CompetitionMembers.SingleAsync(m => m.SeasonId == f.Season && m.UserId == f.StudentId); f.Db.CompetitionMembers.Remove(membership); await f.Db.SaveChangesAsync(); using (var failedScope = f.Factory.Services.CreateScope()) await failedScope.ServiceProvider.GetRequiredService<PbeSoloExpiryProcessor>().RunOnceAsync(null);
        Assert.True(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-solo-outbox" && r.Id == id.ToString()));
        f.Db.CompetitionMembers.Add(membership); await f.Db.SaveChangesAsync(); using (var retryScope = f.Factory.Services.CreateScope()) await retryScope.ServiceProvider.GetRequiredService<PbeSoloExpiryProcessor>().RunOnceAsync(null);
        var saved = JsonSerializer.Deserialize<PbeSessionSnapshot>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-session" && r.Id == id.ToString())).DataJson, PbeQuestionBank.Json)!;
        Assert.Equal("durable-final", Assert.Single(saved.Attempts).ClientSubmissionId);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-solo-outbox" && r.Id == id.ToString()));
    }

    [Fact]
    public async Task Introduction_only_daily_Pbe_grades_partial_answers_and_preserves_original_retry_and_effort()
    {
        using var f = await Fixture.Create();
        var today = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/today?seasonId={f.Season}");
        Assert.Equal("Pbe", today.GetProperty("format").GetString());
        var start = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" });
        Assert.Equal(HttpStatusCode.OK, start.StatusCode);
        var s = await start.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Pbe", s.GetProperty("format").GetString());
        Assert.Equal(2, s.GetProperty("targetCardCount").GetInt32());
        var path = $"/api/v1/study/sessions/{s.GetProperty("id").GetGuid()}";
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.GetAsync(path + "/recap")).StatusCode);
        var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        Assert.DoesNotContain("Alpha", card.GetRawText());
        Assert.DoesNotContain("acceptedAnswers", card.GetRawText());
        var input = new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "wrong" }, hintsUsed = false };
        var result = await (await f.Student.PostAsJsonAsync(path + "/attempts", input)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, result.GetProperty("earnedPoints").GetInt32());
        var resumed = await f.Student.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal(result.GetProperty("attemptId").GetGuid(), resumed.GetProperty("attempt").GetProperty("attemptId").GetGuid());
        var retry = await (await f.Student.PostAsJsonAsync(path + "/attempts", input)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(result.GetProperty("acceptedAtUtc").GetString(), retry.GetProperty("acceptedAtUtc").GetString());
        Assert.True(retry.GetProperty("alreadyProcessed").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync(path + "/attempts", new { input.clientSubmissionId, input.challengeCardId, answers = new[] { "Beta", "Alpha" }, hintsUsed = false })).StatusCode);
        card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), input.answers, input.hintsUsed })).StatusCode);
        var done = await (await f.Student.PostAsJsonAsync(path + "/complete", new { })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(done.GetProperty("recap").GetProperty("fullTargetReached").GetBoolean());
        Assert.True(done.GetProperty("recap").GetProperty("newlyCreditedDay").GetBoolean());
        Assert.Equal(2, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-target-review"));
        Assert.Single(await f.Db.TrainingDays.Where(d => d.StudentUserId == f.StudentId).ToListAsync());
        Assert.False(await f.Db.SourceUnits.AnyAsync(u => u.Id == f.Unit));
        var recap = await f.Student.GetFromJsonAsync<JsonElement>(path + "/recap");
        Assert.Equal("pbe-daily-v2", recap.GetProperty("version").GetString());
    }

    [Fact]
    public async Task Saved_aid_survives_false_flags_and_unrelated_introduction_assignment_changes_and_disabled_admission()
    {
        using var f = await Fixture.Create();
        var session = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe" })).Content.ReadFromJsonAsync<JsonElement>();
        var path = $"/api/v1/study/sessions/{session.GetProperty("id").GetGuid()}";
        var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/source", new { challengeCardId = card.GetProperty("id").GetGuid() })).StatusCode);
        Assert.True((await f.Student.GetFromJsonAsync<JsonElement>(path)).GetProperty("card").GetProperty("assisted").GetBoolean());
        var otherResponse = await f.Coach.PostAsJsonAsync($"/api/v1/organizations/{f.Org}/students", new { userName = "pbe.other", displayName = "Other learner", password = "OtherFixture!234" });
        Assert.Equal(HttpStatusCode.Created, otherResponse.StatusCode);
        var otherId = (await otherResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid();
        f.Db.CompetitionMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, UserId = otherId });
        await f.Db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.OK, (await f.Coach.PostAsJsonAsync($"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}/introductions/{f.Intro}/assignments", new { revision = 3, studentIds = new[] { f.StudentId, otherId } })).StatusCode);
        await f.Db.Seasons.Where(s => s.Id == f.Season).ExecuteUpdateAsync(s => s.SetProperty(x => x.PbeEnabled, false));
        Assert.Equal(HttpStatusCode.Forbidden, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await f.Student.GetAsync($"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}/bank")).StatusCode);
        var input = new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "Beta" }, hintsUsed = false };
        var accepted = await (await f.Student.PostAsJsonAsync(path + "/attempts", input)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(accepted.GetProperty("unaided").GetBoolean());
        var replay = await (await f.Student.PostAsJsonAsync(path + "/attempts", input)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(accepted.GetProperty("acceptedAtUtc").GetString(), replay.GetProperty("acceptedAtUtc").GetString());
        card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), input.answers, input.hintsUsed })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/complete", new { })).StatusCode);
        var frozen = await f.Student.GetStringAsync(path + "/recap");
        await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction-assignment").ExecuteDeleteAsync();
        Assert.Equal(frozen, await f.Student.GetStringAsync(path + "/recap"));
    }
    [Theory]
    [InlineData("assignment")]
    [InlineData("membership")]
    [InlineData("season")]
    [InlineData("book")]
    [InlineData("review")]
    [InlineData("license")]
    public async Task Fresh_revocation_blocks_saved_delivery_and_accepted_retries(string revocation)
    {
        using var f = await Fixture.Create();
        var session = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" })).Content.ReadFromJsonAsync<JsonElement>();
        var path = $"/api/v1/study/sessions/{session.GetProperty("id").GetGuid()}";
        var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        var input = new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "wrong" }, hintsUsed = false };
        Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/attempts", input)).StatusCode);
        Assert.Contains((await f.Student.GetFromJsonAsync<JsonElement>("/api/v1/progress/me/seasons")).EnumerateArray(), s => s.GetProperty("id").GetGuid() == f.Season);
        if (revocation == "assignment") await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction-assignment").ExecuteDeleteAsync();
        else if (revocation == "membership") await f.Db.CompetitionMembers.Where(m => m.SeasonId == f.Season).ExecuteDeleteAsync();
        else if (revocation == "season") await f.Db.Seasons.Where(s => s.Id == f.Season).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, SeasonStatus.Archived));
        else if (revocation == "book") await f.Db.ScopeEntries.Where(s => s.SeasonId == f.Season).ExecuteDeleteAsync();
        else
        {
            var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction");
            var data = System.Text.Json.Nodes.JsonNode.Parse(row.DataJson)!;
            if (revocation == "review") data["reviewed"] = false;
            else data["licensingStatus"] = "pending";
            row.DataJson = data.ToJsonString();
            row.Revision++;
            await f.Db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.GetAsync(path + "/recap")).StatusCode);
        Assert.False((await f.Student.GetAsync(path + "/next")).IsSuccessStatusCode);
        Assert.False((await f.Student.PostAsJsonAsync(path + "/attempts", input)).IsSuccessStatusCode);
        Assert.False((await f.Student.PostAsJsonAsync(path + "/complete", new { })).IsSuccessStatusCode);
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-recall-event"));
        Assert.DoesNotContain((await f.Student.GetFromJsonAsync<JsonElement>("/api/v1/progress/me/seasons")).EnumerateArray(), s => s.GetProperty("id").GetGuid() == f.Season);
    }
    [Fact]
    public async Task Strict_format_mode_boundaries_and_idempotent_start_preserve_missing_format_Memory()
    {
        using var f = await Fixture.Create();
        foreach (var format in new object?[] { "pbe", "Unknown", 2, null }) Assert.Equal(HttpStatusCode.BadRequest, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format, mode = "Practice" })).StatusCode);
        foreach (var mode in new object?[] { "practice", "Unknown", 2, null }) Assert.Equal(HttpStatusCode.BadRequest, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Simulation" })).StatusCode);
        var input = new { seasonId = f.Season, format = "Pbe", mode = "Practice", training = new { clientStartId = new string('x', 200) } };
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", training = new { clientStartId = "stale", missionId = Guid.NewGuid().ToString(), missionRevision = 1, step = "Practice" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", training = new { clientStartId = "bad", missionRevision = 1 } })).StatusCode);
        var first = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", input)).Content.ReadAsStringAsync();
        Assert.Equal(first, await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", input)).Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { input.seasonId, input.format, mode = "Review", input.training })).StatusCode);
        // An introduction-only learner has no Memory range: omitted format keeps that legacy rejection.
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, mode = "Practice" })).StatusCode);
    }

    [Theory]
    [InlineData("Memory")]
    [InlineData("Pbe")]
    public async Task Memory_and_Pbe_share_one_day_credit_through_actual_HTTP(string first)
    {
        using var f = await Fixture.Create();
        var created = await f.Coach.PostAsJsonAsync($"/api/v1/organizations/{f.Org}/seasons", new { name = "Memory effort fixture", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var memorySeason = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var root = $"/api/v1/organizations/{f.Org}/seasons/{memorySeason}";
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 4 };
        (await f.Coach.PostAsJsonAsync(root + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { range }, excludes = Array.Empty<object>() })).EnsureSuccessStatusCode();
        (await f.Coach.PostAsJsonAsync(root + "/assignments", new { studentUserId = f.StudentId, type = "PrimarySpecialist", contentPackId = SeedIdentifiers.ContentPackId, range })).EnsureSuccessStatusCode();
        (await f.Coach.PostAsync(root + "/activate", null)).EnsureSuccessStatusCode();
        foreach (var format in new[] { first, first == "Memory" ? "Pbe" : "Memory" })
        {
            var started = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = format == "Pbe" ? f.Season : memorySeason, format, mode = "Practice" });
            Assert.True(started.IsSuccessStatusCode, await started.Content.ReadAsStringAsync());
            var s = await started.Content.ReadFromJsonAsync<JsonElement>();
            var path = $"/api/v1/study/sessions/{s.GetProperty("id").GetGuid()}";
            for (var i = 0;
i < s.GetProperty("targetCardCount").GetInt32();
i++)
            {
                var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
                var body = new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "Beta" }, submittedAnswer = "A saved practice attempt", responseTimeMs = 100, hintsUsed = false };
                Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/attempts", body)).StatusCode);
            }
            Assert.Equal(HttpStatusCode.OK, (await f.Student.PostAsJsonAsync(path + "/complete", new { })).StatusCode);
        }
        Assert.Single(await f.Db.TrainingDays.Where(d => d.StudentUserId == f.StudentId).ToListAsync());
        Assert.Equal(1, (await f.Db.TrainingWeeks.SingleAsync(w => w.StudentUserId == f.StudentId)).CompletedDays);
    }
    [Fact]
    public async Task Competing_submissions_commit_one_attempt_with_its_evidence_and_no_partial_effort()
    {
        using var f = await Fixture.Create();
        var s = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe" })).Content.ReadFromJsonAsync<JsonElement>();
        var path = $"/api/v1/study/sessions/{s.GetProperty("id").GetGuid()}";
        var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => f.Student.PostAsJsonAsync(path + "/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "Beta" }, hintsUsed = false })));
        Assert.Equal(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, results.Select(r => r.StatusCode).Order().ToArray());
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-attempt"));
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-recall-event"));
        var mission = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-daily-mission");
        Assert.Equal(1, JsonDocument.Parse(mission.DataJson).RootElement.GetProperty("completed").GetInt32());
        Assert.False(await f.Db.TrainingDays.AnyAsync(d => d.StudentUserId == f.StudentId));
    }
    [Fact]
    public async Task Review_selects_due_targets_and_refuses_source_assistance()
    {
        using var f = await Fixture.Create();
        var empty = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Review" });
        Assert.Equal(HttpStatusCode.Conflict, empty.StatusCode);
        Assert.Contains("PBE_NOTHING_DUE", await empty.Content.ReadAsStringAsync());
        var session = await (await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe" })).Content.ReadFromJsonAsync<JsonElement>();
        var path = $"/api/v1/study/sessions/{session.GetProperty("id").GetGuid()}";
        var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        (await f.Student.PostAsJsonAsync(path + "/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "wrong" }, hintsUsed = false })).EnsureSuccessStatusCode();
        var review = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Review" });
        review.EnsureSuccessStatusCode();
        var r = await review.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Review", r.GetProperty("mode").GetString());
        path = $"/api/v1/study/sessions/{r.GetProperty("id").GetGuid()}";
        card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        Assert.Equal(HttpStatusCode.BadRequest, (await f.Student.PostAsJsonAsync(path + "/source", new { challengeCardId = card.GetProperty("id").GetGuid() })).StatusCode);
        (await f.Student.PostAsJsonAsync(path + "/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "Beta" }, hintsUsed = false })).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task Frozen_daily_mission_remains_discoverable_after_publication_moves_outside_personal_scope()
    {
        using var f = await Fixture.Create();
        var started = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe" });
        started.EnsureSuccessStatusCode();
        var session = await started.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = session.GetProperty("id").GetGuid();
        var path = $"/api/v1/study/sessions/{sessionId}";
        var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
        var todayPath = $"/api/v1/progress/me/today?seasonId={f.Season}";
        var before = await f.Student.GetFromJsonAsync<JsonElement>(todayPath);
        var prefix = $"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}";
        var book = (await f.Db.ScopeEntries.SingleAsync(s => s.SeasonId == f.Season)).BookKey;
        var created = await f.Coach.PostAsJsonAsync(prefix + "/introductions", new { bookKey = book, sourceEdition = "Test", title = "Unassigned labels", citation = "Other intro", licensingStatus = "approved", units = new[] { new { citation = "Other intro §1", canonicalText = "Gamma" } } });
        created.EnsureSuccessStatusCode();
        var intro = await created.Content.ReadFromJsonAsync<JsonElement>();
        var pack = intro.GetProperty("id").GetGuid();
        var unit = intro.GetProperty("units")[0].GetProperty("id").GetGuid();
        (await f.Coach.PostAsJsonAsync(prefix + $"/introductions/{pack}/review", new { revision = 1, reviewed = true })).EnsureSuccessStatusCode();
        var target = Guid.NewGuid();
        var heads = await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head").ToListAsync();
        foreach (var head in heads)
        {
            var id = JsonDocument.Parse(head.DataJson).RootElement.GetProperty("question").GetProperty("id").GetGuid();
            var input = new { targets = new[] { new { id = target, sourceUnitIds = new[] { unit }, skill = "FactualRecall", label = "Gamma" } }, questions = new[] { new { schemaVersion = 2, id, version = 2, contentPackId = pack, sourceUnitId = unit, sourceUnitIds = new[] { unit }, sourceKind = "Commentary", reference = "Other intro §1", evidence = "Gamma", kind = "ShortAnswer", prompt = "Name the label.", ordered = false, parts = new[] { new { targetId = target, acceptedAnswers = new[] { "Gamma" }, points = 1 } } } } };
            (await f.Coach.PostAsJsonAsync(prefix + "/questions/import", input)).EnsureSuccessStatusCode();
            (await f.Coach.PostAsJsonAsync(prefix + $"/questions/{id}/2/publish", new { })).EnsureSuccessStatusCode();
        }
        var today = await f.Student.GetFromJsonAsync<JsonElement>(todayPath);
        Assert.Equal("Active", today.GetProperty("mission").GetProperty("status").GetString());
        Assert.Equal(sessionId, today.GetProperty("mission").GetProperty("id").GetGuid());
        Assert.Equal(before.GetProperty("mission").GetProperty("scopeVersion").GetString(), today.GetProperty("mission").GetProperty("scopeVersion").GetString());
        Assert.Equal(2, today.GetProperty("mission").GetProperty("steps")[0].GetProperty("target").GetInt32());
        Assert.Equal(sessionId, today.GetProperty("nextAction").GetProperty("sessionId").GetGuid());
        var newStart = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe" });
        Assert.Equal(HttpStatusCode.Conflict, newStart.StatusCode);
        Assert.Contains("PBE_COVERAGE_UNAVAILABLE", await newStart.Content.ReadAsStringAsync());
        Assert.Equal(card.GetProperty("id").GetGuid(), (await f.Student.GetFromJsonAsync<JsonElement>(path + "/next")).GetProperty("id").GetGuid());
        var accepted = await f.Student.PostAsJsonAsync(path + "/attempts", new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "Beta" }, hintsUsed = false });
        accepted.EnsureSuccessStatusCode();
        Assert.Equal(2, (await accepted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("earnedPoints").GetInt32());
        await f.Db.CompetitionMembers.Where(m => m.SeasonId == f.Season && m.UserId == f.StudentId).ExecuteDeleteAsync();
        var revoked = await f.Student.GetFromJsonAsync<JsonElement>(todayPath);
        Assert.Equal("Unavailable", revoked.GetProperty("mission").GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, revoked.GetProperty("nextAction").ValueKind);
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync(path + "/complete", new { })).StatusCode);
    }
    private sealed class Fixture : IDisposable
    {
        public ErudozaApiFactory Factory = null!;
        public HttpClient Coach = null!, Student = null!;
        public IServiceScope Scope = null!;
        public ErudozaDbContext Db = null!;
        public Guid Org, Season, StudentId, Intro, Unit;
        public void Dispose()
        {
            Student.Dispose();
            Coach.Dispose();
            Scope.Dispose();
            Factory.Dispose();
        }
        public static async Task<Fixture> Create(TimeProvider? timeProvider = null)
        {
            var f = new Fixture { Factory = new ErudozaApiFactory { DisablePracticeTicker = true, TestTimeProvider = timeProvider } };
            f.Coach = await TestHttp.LoginAsync(f.Factory, "admin@erudoza.local", "DevAdmin!234");
            f.Student = await TestHttp.LoginAsync(f.Factory, "daniel.student", "DevStudent!234");
            f.Org = (await f.Coach.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("organizationId").GetGuid();
            f.StudentId = (await f.Student.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
            f.Scope = f.Factory.Services.CreateScope();
            f.Db = f.Scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var scripture = await f.Db.SourceUnits.FirstAsync(s => s.OrganizationId == f.Org);
            var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "pbe-session", Version = 1 };
            f.Season = Guid.NewGuid();
            f.Db.RuleProfiles.Add(rule);
            f.Db.Seasons.Add(new() { Id = f.Season, OrganizationId = f.Org, Name = "PBE session", RuleProfileId = rule.Id, Status = SeasonStatus.Active, PbeEnabled = true });
            f.Db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, ContentPackId = scripture.ContentPackId, Kind = ScopeEntryKind.Include, BookKey = scripture.BookKey, StartChapter = scripture.Chapter, EndChapter = scripture.Chapter, StartVerse = scripture.Verse, EndVerse = scripture.Verse });
            f.Db.CompetitionMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, UserId = f.StudentId });
            await f.Db.SaveChangesAsync();
            var p = $"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}";
            var intro = await (await f.Coach.PostAsJsonAsync(p + "/introductions", new { bookKey = scripture.BookKey, sourceEdition = "Test", title = "Labels", citation = "Intro", licensingStatus = "approved", units = new[] { new { citation = "Intro §1", canonicalText = "Alpha and Beta" } } })).Content.ReadFromJsonAsync<JsonElement>();
            f.Intro = intro.GetProperty("id").GetGuid();
            f.Unit = intro.GetProperty("units")[0].GetProperty("id").GetGuid();
            Assert.Equal(HttpStatusCode.OK, (await f.Coach.PostAsJsonAsync(p + $"/introductions/{f.Intro}/review", new { revision = 1, reviewed = true })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await f.Coach.PostAsJsonAsync(p + $"/introductions/{f.Intro}/assignments", new { revision = 2, studentIds = new[] { f.StudentId } })).StatusCode);
            var targetIds = new[] { Guid.NewGuid(), Guid.NewGuid() };
            for (var i = 0;
i < 2;
i++)
            {
                var q = Guid.NewGuid();
                var input = new { targets = targetIds.Select(t => new { id = t, sourceUnitIds = new[] { f.Unit }, skill = "FactualRecall", label = "Labels" }), questions = new[] { new { schemaVersion = 2, id = q, version = 1, contentPackId = f.Intro, sourceUnitId = f.Unit, sourceUnitIds = new[] { f.Unit }, sourceKind = "Commentary", reference = "Intro §1", evidence = "Alpha and Beta", kind = "List", prompt = "Name the labels.", ordered = false, parts = targetIds.Select((t, n) => new { targetId = t, acceptedAnswers = new[] { n == 0 ? "Alpha" : "Beta" }, points = 1 }) } } };
                Assert.Equal(HttpStatusCode.NoContent, (await f.Coach.PostAsJsonAsync(p + "/questions/import", input)).StatusCode);
                Assert.Equal(HttpStatusCode.NoContent, (await f.Coach.PostAsJsonAsync(p + $"/questions/{q}/1/publish", new { })).StatusCode);
            }
            return f;
        }
    }

    private sealed class ManualTime : TimeProvider
    {
        private readonly DateTimeOffset origin = DateTimeOffset.UtcNow;
        private long timestamp;
        public override long TimestampFrequency => 1000;
        public override long GetTimestamp() => timestamp;
        public override DateTimeOffset GetUtcNow() => origin.AddMilliseconds(timestamp);
        public void Advance(TimeSpan elapsed) => timestamp += (long)elapsed.TotalMilliseconds;
    }
}
