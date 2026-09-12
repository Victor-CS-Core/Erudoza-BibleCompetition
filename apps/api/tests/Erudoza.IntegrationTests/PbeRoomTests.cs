using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Erudoza.Api.Practice;
using Microsoft.AspNetCore.Http;
namespace Erudoza.IntegrationTests;

public sealed class PbeRoomTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task Enabled_rehearsal_creates_six_student_team_shapes_without_a_coach(int teams)
    {
        using var fixture = await PracticeRoomHttpTests.Setup.Create();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            (await db.Seasons.SingleAsync(s => s.Id == fixture.SeasonId)).PbeEnabled = true;
            db.CompetitionMembers.Add(new CompetitionMember { OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, UserId = SeedIdentifiers.StudentUserId, Difficulty = TrainingDifficulty.Advanced }); await db.SaveChangesAsync();
        }
        var response = await fixture.Owner.PostAsJsonAsync(fixture.Path + "/rooms", new { seasonId = fixture.SeasonId, teamSize = 6, teamCount = teams, questionCount = 90, format = "Pbe" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); var room = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Pbe", room.GetProperty("format").GetString()); Assert.Equal(teams, room.GetProperty("teamCount").GetInt32()); Assert.False(room.GetProperty("coached").GetBoolean());
        Assert.Equal(teams, room.GetProperty("scores").GetArrayLength());
        var coachResponse = await fixture.Admin.PostAsJsonAsync(fixture.Path + "/rooms", new { seasonId = fixture.SeasonId, teamSize = 6, teamCount = teams, questionCount = 90, format = "Pbe" });
        coachResponse.EnsureSuccessStatusCode(); var coachRoom = await coachResponse.Content.ReadFromJsonAsync<JsonElement>(); Assert.False(coachRoom.GetProperty("coached").GetBoolean()); Assert.Empty(coachRoom.GetProperty("members").EnumerateArray());

    }

    [Theory]
    [InlineData(1, 6, 90, false, false, false, true)]
    [InlineData(2, 6, 90, false, false)]
    [InlineData(2, 2, 10, true, false)]
    [InlineData(2, 2, 10, true, true)]
    [InlineData(1, 2, 10, true, false, true, true)]
    [InlineData(1, 2, 10, true, false, true, true, true)]
    [InlineData(2, 2, 10, false, false, false, true, false, true)]
    [InlineData(1, 2, 10, false, false, false, true, false, false, true)]
    public async Task Full_rehearsal_uses_authored_rubrics_active_teams_and_exactly_one_break(int teams, int size, int count, bool recover, bool trustedDraft, bool unarmed = false, bool adultOwner = false, bool invalidReserve = false, bool coached = false, bool cleanupEnd = false)
    {
        var time = new TestTime(); using var fixture = await PracticeRoomHttpTests.Setup.Create(true, time);
        var clients = new List<HttpClient> { fixture.Owner }; for (var n = 1; n < teams * size; n++) clients.Add(await fixture.Student("pbe-player"));
        var ids = new List<Guid>(); foreach (var client in clients) ids.Add((await client.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid());
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.Seasons.SingleAsync(s => s.Id == fixture.SeasonId)).PbeEnabled = true;
            foreach (var id in ids) db.CompetitionMembers.Add(new CompetitionMember { OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, UserId = id, Difficulty = TrainingDifficulty.Advanced });
            var source = await db.SourceUnits.Include(s => s.ContentPack).SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"));
            foreach (var id in ids) db.Assignments.Add(new Assignment { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, StudentUserId = id, Type = AssignmentType.RequiredCoverage, Scopes = [new AssignmentScope { Id = Guid.NewGuid(), ContentPackId = source.ContentPackId, BookKey = "DAN", StartChapter = 1, EndChapter = 1, StartVerse = 1, EndVerse = 1 }] });

            var target = new PbeTarget { Id = Guid.NewGuid(), SourceUnitIds = [source.Id], Skill = RecallSkill.FactualRecall, Label = "Person" };
            db.PbeTrainingRecords.Add(new PbeTrainingRecord { Kind = "pbe-target", Id = target.Id.ToString(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, OwnerId = source.Id, DataJson = JsonSerializer.Serialize(target, PbeQuestionBank.Json) });
            for (var n = 0; n < count + 2; n++)
            {
                var q = new PbeQuestion { SchemaVersion = 2, Id = Guid.NewGuid(), Version = 1, ContentPackId = source.ContentPackId, SourceUnitId = source.Id, SourceUnitIds = [source.Id], SourceKind = PbeSourceKind.Scripture, Reference = source.CitationLabel, Evidence = "Daniel purposed in his heart", Kind = PbeQuestionKind.ShortAnswer, Prompt = "Who purposed in his heart?", Ordered = false, Parts = [new PbeQuestionPart { TargetId = target.Id, AcceptedAnswers = ["Daniel"], Points = 2 }] };
                db.PbeTrainingRecords.Add(new PbeTrainingRecord { Kind = "pbe-question-head", Id = q.Id.ToString(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, OwnerId = source.Id, DataJson = JsonSerializer.Serialize(new PbeBankQuestionData(q.Id.ToString(), fixture.SeasonId, true, q, PbeQuestionBank.SourceProof(q, new Dictionary<Guid, SourceUnit> { { source.Id, source } })), PbeQuestionBank.Json) });
            }
            await db.SaveChangesAsync();
        }
        var response = await (adultOwner ? fixture.Admin : fixture.Owner).PostAsJsonAsync(fixture.Path + "/rooms", new { seasonId = fixture.SeasonId, teamSize = size, teamCount = teams, questionCount = count, format = "Pbe", coached }); response.EnsureSuccessStatusCode(); var room = await response.Content.ReadFromJsonAsync<JsonElement>(); var roomId = room.GetProperty("id").GetGuid(); var path = fixture.Path + "/rooms/" + roomId;
        async Task Command(int player, string action, object? payload = null) { var fields = new Dictionary<string, object?> { { "commandId", Guid.NewGuid() }, { "revision", room.GetProperty("revision").GetInt64() }, { "action", action } }; if (payload is not null) foreach (var p in JsonSerializer.SerializeToElement(payload).EnumerateObject()) fields[p.Name] = p.Value; var r = await (player == -1 || adultOwner && action == "invite" ? fixture.Admin : clients[player]).PostAsJsonAsync(path + "/commands", fields); Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync()); room = await r.Content.ReadFromJsonAsync<JsonElement>(); }
        for (var n = adultOwner ? 0 : 1; n < ids.Count; n++)
        {
            await Command(0, "invite", new { targetUserId = ids[n], team = n / size + 1 }); var inbox = await clients[n].GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap"); var invite = inbox.GetProperty("invitations")[0].GetProperty("id").GetGuid(); var r = await clients[n].PostAsJsonAsync(fixture.Path + $"/invitations/{invite}/accept", new { team = n / size + 1 }); r.EnsureSuccessStatusCode(); room = await r.Content.ReadFromJsonAsync<JsonElement>();
        }
        if (cleanupEnd)
        {
            async Task Membership(bool add) { using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); if (add) db.CompetitionMembers.Add(new CompetitionMember { OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, UserId = ids[1], Difficulty = TrainingDifficulty.Advanced }); else db.CompetitionMembers.Remove(await db.CompetitionMembers.SingleAsync(m => m.SeasonId == fixture.SeasonId && m.UserId == ids[1])); await db.SaveChangesAsync(); }
            async Task Rejoin() { await Membership(true); await Command(-1, "invite", new { targetUserId = ids[1], team = 1 }); var inbox = await clients[1].GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap"); var invite = inbox.GetProperty("invitations")[0].GetProperty("id").GetGuid(); var accepted = await clients[1].PostAsJsonAsync(fixture.Path + $"/invitations/{invite}/accept", new { team = 1 }); accepted.EnsureSuccessStatusCode(); room = await accepted.Content.ReadFromJsonAsync<JsonElement>(); }
            await Membership(false); room = await fixture.Admin.GetFromJsonAsync<JsonElement>(path); Assert.True(room.GetProperty("materialUnavailable").GetBoolean()); await Command(-1, "remove", new { targetUserId = ids[1] }); Assert.Single(room.GetProperty("members").EnumerateArray()); await Rejoin();
            await Membership(false); var left = await clients[1].PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), action = "leave" }); left.EnsureSuccessStatusCode(); Assert.True((await left.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("left").GetBoolean()); room = await fixture.Admin.GetFromJsonAsync<JsonElement>(path); await Rejoin();
        }
        for (var n = 0; n < ids.Count; n++) await Command(n, "ready"); await Command(coached ? -1 : 0, "start"); var breaks = 0;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var exposed = await db.PbeTrainingRecords.Where(r => r.SeasonId == fixture.SeasonId && r.Kind == "pbe-question-service").ToListAsync(); Assert.Equal(size * teams, exposed.Count);
            (await db.Seasons.SingleAsync(s => s.Id == fixture.SeasonId)).PbeEnabled = false; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Owner.PostAsJsonAsync(fixture.Path + "/rooms", new { seasonId = fixture.SeasonId, teamSize = size, teamCount = teams, questionCount = count, format = "Pbe" })).StatusCode);
        var interrupted = false;
        for (var q = 0; q < count; q++)
        {
            Assert.Equal("Presentation", room.GetProperty("phase").GetString()); var questionId = room.GetProperty("question").GetProperty("id").GetGuid();
            if (q == 0) { using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var row = await db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-question-head" && r.Id == questionId.ToString()); var data = JsonSerializer.Deserialize<PbeBankQuestionData>(row.DataJson, PbeQuestionBank.Json)!; data.Question.Version = 2; data.Question.Parts[0].AcceptedAnswers = ["Changed"]; row.DataJson = JsonSerializer.Serialize(data, PbeQuestionBank.Json); await db.SaveChangesAsync(); }

            if (unarmed && q == 2)
            {
                async Task ReplaceAuthority() { using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var record = await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == roomId); var saved = PracticeJson.Read<PracticeRoom>(record.StateJson); saved.ProcessId = Guid.NewGuid().ToString(); if (invalidReserve) saved.Reserves[0].Rubric!.Evidence = "No longer matches approved source"; record.StateJson = PracticeJson.Write(saved); await db.SaveChangesAsync(); }
                await ReplaceAuthority(); room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); if (invalidReserve) { Assert.Equal("Interrupted", room.GetProperty("status").GetString()); Assert.Equal("UnarmedReserveUnavailable", room.GetProperty("interruptionReason").GetString()); Assert.Equal(2, room.GetProperty("results").GetArrayLength()); interrupted = true; break; }
                Assert.Equal("Paused", room.GetProperty("phase").GetString()); Assert.Equal(JsonValueKind.Null, room.GetProperty("question").ValueKind); await Command(0, "next"); await ReplaceAuthority(); room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.Equal("Interrupted", room.GetProperty("status").GetString()); Assert.Equal("UnarmedReserveUnavailable", room.GetProperty("interruptionReason").GetString()); Assert.Equal(2, room.GetProperty("results").GetArrayLength()); interrupted = true; break;
            }
            if (coached)
            {
                if (q == 0)
                {
                    foreach (var actor in new[] { clients[0], clients[1] }) Assert.Equal(HttpStatusCode.Forbidden, (await actor.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action = "present", questionId, delivery = "Coach" })).StatusCode);
                    Assert.Equal(HttpStatusCode.Forbidden, (await clients[1].PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action = "present-ready", questionId })).StatusCode);
                    Assert.Equal(HttpStatusCode.BadRequest, (await fixture.Admin.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = -1, action = "present", questionId, delivery = "Coach" })).StatusCode);
                }
                if (q % 2 == 0) await Command(-1, "present", new { questionId, delivery = "Coach" });
                for (var team = 0; team < teams; team++) { Assert.Equal("Presentation", room.GetProperty("phase").GetString()); await Command(team * size, "present-ready", new { questionId }); }
                if (q % 2 != 0) { Assert.Equal("Presentation", room.GetProperty("phase").GetString()); await Command(-1, "present", new { questionId, delivery = "Coach" }); }
                Assert.All(room.GetProperty("presentationDelivery").EnumerateObject(), entry => Assert.Equal("Coach", entry.Value.GetString()));
                Assert.Equal(questionId, room.GetProperty("coachReading").GetProperty("questionId").GetGuid());
                foreach (var action in new[] { "draft", "submit" }) Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Admin.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action, questionId, answers = new[] { "Daniel" } })).StatusCode);
            }
            else for (var team = 0; team < teams; team++) await Command(team * size, "present", new { questionId, delivery = team == 0 ? "Audio" : "TextFallback" });
            Assert.Equal("Scheduled", room.GetProperty("phase").GetString()); var originalStart = room.GetProperty("responseStartsAt").GetString(); var originalSchedule = room.GetProperty("scheduleId").GetGuid(); time.Advance(TimeSpan.FromSeconds(3));
            if (q == 0) { await Command(0, "ack", new { scheduleId = originalSchedule }); Assert.Equal(originalStart, room.GetProperty("responseStartsAt").GetString()); Assert.Equal(originalSchedule, room.GetProperty("scheduleId").GetGuid()); }
            room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path);
            Assert.Equal("Response", room.GetProperty("phase").GetString());
            if (recover && q == 2)
            {
                await Command(0, "submit", new { questionId, answers = new[] { "Daniel" } }); if (trustedDraft) await Command(size, "draft", new { questionId, answers = new[] { "Daniel" } });
                string locked;
                using (var scope = fixture.Factory.Services.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var record = await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == roomId); var saved = Erudoza.Api.Practice.PracticeJson.Read<Erudoza.Api.Practice.PracticeRoom>(record.StateJson); locked = JsonSerializer.Serialize(saved.Submissions.Single(s => s.QuestionId == questionId && s.Team == 1)); saved.ProcessId = "replaced-process"; record.StateJson = Erudoza.Api.Practice.PracticeJson.Write(saved); await db.SaveChangesAsync();
                }
                room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.Equal(trustedDraft ? "Review" : "Interrupted", room.GetProperty("phase").GetString());
                using (var scope = fixture.Factory.Services.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var saved = Erudoza.Api.Practice.PracticeJson.Read<Erudoza.Api.Practice.PracticeRoom>((await db.Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == roomId)).StateJson);
                    Assert.Equal(locked, JsonSerializer.Serialize(saved.Submissions.Single(s => s.QuestionId == questionId && s.Team == 1))); Assert.Single(saved.Reserves); Assert.Equal(3, saved.Presentations.Count); Assert.NotNull(saved.Submissions.Last().ResponseLockedAtUtc);
                }
                if (!trustedDraft) { Assert.Equal(5, room.GetProperty("results").GetArrayLength()); Assert.Equal(400, room.GetProperty("scores")[0].GetProperty("accuracyHundredths").GetInt32()); Assert.Empty(room.GetProperty("achievements").EnumerateArray()); interrupted = true; break; }
            }
            if (q == 0)
            {
                using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); db.CompetitionMembers.Remove(await db.CompetitionMembers.SingleAsync(m => m.SeasonId == fixture.SeasonId && m.UserId == ids[1])); await db.SaveChangesAsync(); }
                var management = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.True(management.GetProperty("materialUnavailable").GetBoolean()); Assert.Equal(JsonValueKind.Null, management.GetProperty("question").ValueKind); Assert.Empty(management.GetProperty("results").EnumerateArray());
                using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); db.CompetitionMembers.Add(new CompetitionMember { OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, UserId = ids[1], Difficulty = TrainingDifficulty.Advanced }); await db.SaveChangesAsync(); }
                using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.SourceUnits.SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"))).IsActive = false; await db.SaveChangesAsync(); }
                management = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.True(management.GetProperty("materialUnavailable").GetBoolean()); Assert.Empty(management.GetProperty("draft").EnumerateArray()); Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Owner.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), action = "draft", questionId, answers = new[] { "Blocked" } })).StatusCode);
                using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.SourceUnits.SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"))).IsActive = true; await db.SaveChangesAsync(); }
                using var anonymous = fixture.Factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), action = "draft", questionId, answers = new[] { "Wrong" } })).StatusCode);
                using var malformed = new StringContent("{", System.Text.Encoding.UTF8, "application/json"); Assert.Equal(HttpStatusCode.BadRequest, (await fixture.Owner.PostAsync(path + "/commands", malformed)).StatusCode);
                var runtime = fixture.Factory.Services.GetRequiredService<PracticeRuntime>();
                using (var predecessor = await runtime.EnterIngress(roomId, CancellationToken.None))
                {
                    using var cancellation = new CancellationTokenSource(); var cancelled = fixture.Owner.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action = "draft", questionId, answers = new[] { "Cancelled" } }, cancellation.Token);
                    await Task.Delay(30); cancellation.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
                }
                for (var wait = 0; wait < 40 && runtime.HasPending(roomId); wait++) await Task.Delay(10); Assert.False(runtime.HasPending(roomId)); await Command(0, "draft", new { questionId, answers = new[] { "Wrong draft" } });
            }
            if (q == 0) { using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_room_projection BEFORE DELETE ON PbeTrainingRecords WHEN OLD.Kind='pbe-room-service-outbox' BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END"); }
            if (recover && q == 2) { } else if (q == 1) { time.Advance(TimeSpan.FromSeconds(31)); room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); } else for (var team = 0; team < teams; team++) await Command(team * size, "submit", new { questionId, answers = new[] { "Daniel" } });
            if (q == 0) { var lockedResults = room.GetProperty("results").GetRawText(); using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); Assert.True(await db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-room-service-outbox" && r.Id == roomId.ToString())); await db.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_room_projection"); } room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.Equal(lockedResults, room.GetProperty("results").GetRawText()); using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); Assert.False(await db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-room-service-outbox" && r.Id == roomId.ToString())); } }
            if (cleanupEnd && q == 0)
            {
                var revealed = room.GetProperty("results").GetRawText(); string finals, timings;
                using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var saved = PracticeJson.Read<PracticeRoom>((await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == roomId)).StateJson); finals = PracticeJson.Write(saved.Submissions); timings = PracticeJson.Write(saved.Presentations); (await db.SourceUnits.SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"))).IsActive = false; await db.SaveChangesAsync(); }
                room = await fixture.Admin.GetFromJsonAsync<JsonElement>(path); Assert.True(room.GetProperty("materialUnavailable").GetBoolean()); Assert.Equal(JsonValueKind.Null, room.GetProperty("question").ValueKind);
                Assert.Equal(HttpStatusCode.Forbidden, (await fixture.Owner.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), action = "abandon" })).StatusCode);
                await Command(-1, "abandon"); Assert.Equal("Abandoned", room.GetProperty("status").GetString()); Assert.Empty(room.GetProperty("results").EnumerateArray()); Assert.Equal(JsonValueKind.Null, room.GetProperty("question").ValueKind);
                var cleanedHistory = await fixture.Admin.GetFromJsonAsync<JsonElement>(path); Assert.Equal(revealed, cleanedHistory.GetProperty("results").GetRawText());
                using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var saved = PracticeJson.Read<PracticeRoom>((await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == roomId)).StateJson); Assert.Equal(finals, PracticeJson.Write(saved.Submissions)); Assert.Equal(timings, PracticeJson.Write(saved.Presentations)); Assert.Null(saved.CompletedAt); }
                foreach (var client in clients.Skip(1)) client.Dispose(); return;
            }
            Assert.Equal("Review", room.GetProperty("phase").GetString()); if (coached) await Command(-1, "next"); time.Advance(TimeSpan.FromSeconds(10)); room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path);
            if (room.GetProperty("phase").GetString() == "Break") { Assert.Equal(JsonValueKind.Null, room.GetProperty("question").ValueKind); breaks++; Assert.Equal(44, q); time.Advance(TimeSpan.FromMinutes(5)); room = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); }
        }
        if (!interrupted)
        {
            Assert.Equal("Completed", room.GetProperty("status").GetString()); Assert.Equal(count == 90 ? 1 : 0, breaks); Assert.Equal(count * teams, room.GetProperty("results").GetArrayLength()); Assert.Equal(teams, room.GetProperty("scores").GetArrayLength());
            foreach (var score in room.GetProperty("scores").EnumerateArray()) { Assert.Equal((count - 1) * 200, score.GetProperty("accuracyHundredths").GetInt32()); Assert.Equal(0, score.GetProperty("speedHundredths").GetInt32()); Assert.Equal(count * 200, score.GetProperty("availableHundredths").GetInt32()); }
        }
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var savedRow = await db.Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == roomId); var frozen = PracticeJson.Read<PracticeRoom>(savedRow.StateJson); if (coached) Assert.All(frozen.Presentations, entry => { Assert.Equal(entry.Key, entry.Value.CoachReading!.QuestionId); Assert.All(entry.Value.Delivery.Values, delivery => Assert.Equal("Coach", delivery)); Assert.Equal(teams, entry.Value.Delivery.Count); }); if (unarmed && !invalidReserve) { Assert.Empty(frozen.Reserves); Assert.Single(frozen.Replacements); } else Assert.Single(frozen.Reserves);
            var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../..")); await File.WriteAllTextAsync(Path.Combine(root, ".local", $"c2-canonical-size-{teams}-{count}-{trustedDraft}.json"), JsonSerializer.Serialize(new { questions = frozen.Questions.Count, reserves = frozen.Reserves.Count, roster = frozen.Members.Count, utf8Bytes = System.Text.Encoding.UTF8.GetByteCount(savedRow.StateJson), status = frozen.Status }));
            var serviceRows = await db.PbeTrainingRecords.Where(r => r.SeasonId == fixture.SeasonId && r.Kind == "pbe-question-service").ToListAsync();
            Assert.Equal((interrupted ? (unarmed && !invalidReserve ? 4 : 3) : count) * size * teams, serviceRows.Count); Assert.All(serviceRows, r => Assert.Equal(1, JsonSerializer.Deserialize<PbeServiceProjection>(r.DataJson, PbeQuestionBank.Json)!.ServedCount));
            Assert.Empty(await db.PbeTrainingRecords.Where(r => r.SeasonId == fixture.SeasonId && r.Kind == "pbe-recall-event").ToListAsync());
        }
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); db.CompetitionMembers.Remove(await db.CompetitionMembers.SingleAsync(m => m.SeasonId == fixture.SeasonId && m.UserId == ids[1])); await db.SaveChangesAsync();
        }
        var history = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.Equal(room.GetProperty("status").GetString(), history.GetProperty("status").GetString()); Assert.Equal(room.GetProperty("results").GetRawText(), history.GetProperty("results").GetRawText());
        using (var scope = fixture.Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var source = await db.SourceUnits.SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708")); source.IsActive = false; await db.SaveChangesAsync(); }
        history = await fixture.Owner.GetFromJsonAsync<JsonElement>(path); Assert.Equal(room.GetProperty("results").GetRawText(), history.GetProperty("results").GetRawText());
        foreach (var client in clients.Skip(1)) client.Dispose();
    }
    [Fact]
    public async Task Room_ingress_queues_before_authentication_and_releases_rejected_and_cancelled_work()
    {
        var time = new TestTime(); var runtime = new PracticeRuntime(time); var room = Guid.NewGuid(); runtime.Activate(room); var solo = new PbeSoloTimingAuthority(time); var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var order = new List<string>();
        var middleware = new PracticeIngressMiddleware(async context => { var name = context.Request.Headers["fixture"].ToString(); if (name == "first") { entered.SetResult(); await release.Task; } order.Add(name); if (name == "rejected") context.Response.StatusCode = 401; });
        DefaultHttpContext Context(string name) { var context = new DefaultHttpContext(); context.Request.Method = "POST"; context.Request.Path = $"/api/v1/organizations/{Guid.NewGuid()}/practice/rooms/{room}/commands"; context.Request.Body = new MemoryStream("{\"action\":\"draft\"}"u8.ToArray()); context.Request.Headers["fixture"] = name; return context; }
        var first = middleware.InvokeAsync(Context("first"), runtime, solo); await entered.Task; var second = middleware.InvokeAsync(Context("second"), runtime, solo); await Task.Delay(20); Assert.Empty(order); release.SetResult(); await Task.WhenAll(first, second); Assert.Equal(new[] { "first", "second" }, order);
        await middleware.InvokeAsync(Context("rejected"), runtime, solo); await middleware.InvokeAsync(Context("following"), runtime, solo); Assert.False(runtime.HasPending(room)); Assert.Equal("following", order.Last());
    }
    private sealed class TestTime : TimeProvider
    {
        private long stamp; public override long TimestampFrequency => TimeSpan.TicksPerSecond; public override long GetTimestamp() => stamp; public override DateTimeOffset GetUtcNow() => new DateTimeOffset(2026, 9, 12, 12, 0, 0, TimeSpan.Zero).AddTicks(stamp); public void Advance(TimeSpan span) => stamp += span.Ticks;
    }
}
