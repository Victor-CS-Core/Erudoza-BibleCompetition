using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Erudoza.Api.Practice;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

// These are complete, separate source databases. Their manifests are private importer inputs,
// not a claim that producing a canonical backup proves native restore.
public sealed class PbeRestoreSourceTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly string Output = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../..", ".local/d3-canonical-source", $"run-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}"));

    [Fact]
    public async Task Solo_source_preserves_real_acceptance_pending_and_unfinished_resolved_correction()
    {
        using var f = await PbeStudyTests.Fixture.Create(useBuiltInRule: true);
        var bank = await Bank(f.Db, f.Season);
        // Accepted D1 historical-evidence fixture seam; never insert stamps or edited attempts.
        for (var i = 0; i < 321; i++) await Historical(f, bank[0].Question, DateTimeOffset.UtcNow.AddDays(-400 + i).ToUnixTimeMilliseconds());
        var startBody = new { seasonId = f.Season, format = "Pbe", mode = "Practice", training = new { clientStartId = Guid.NewGuid().ToString(), timeZone = "UTC", step = "Practice" } };
        var start = await Post(f.Student, "/api/v1/study/sessions", startBody);
        Assert.Equal(start.GetProperty("id").GetGuid(), (await Post(f.Student, "/api/v1/study/sessions", startBody)).GetProperty("id").GetGuid());
        var sessionId = start.GetProperty("id").GetGuid(); var path = $"/api/v1/study/sessions/{sessionId}";
        var accepted = new List<object>(); var disputes = new List<JsonElement>();
        for (var i = 0; i < 2; i++)
        {
            var card = await f.Student.GetFromJsonAsync<JsonElement>(path + "/next");
            var body = new { clientSubmissionId = Guid.NewGuid().ToString(), challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { " Alpha ", i == 0 ? "" : "wrong" }, hintsUsed = false };
            var result = await Post(f.Student, path + "/attempts", body);
            var retry = await Post(f.Student, path + "/attempts", body);
            Assert.False(result.GetProperty("alreadyProcessed").GetBoolean());
            Assert.True(retry.GetProperty("alreadyProcessed").GetBoolean());
            var expectedRetry = System.Text.Json.Nodes.JsonNode.Parse(result.GetRawText())!;
            expectedRetry["alreadyProcessed"] = true;
            Assert.True(System.Text.Json.Nodes.JsonNode.DeepEquals(expectedRetry, System.Text.Json.Nodes.JsonNode.Parse(retry.GetRawText())));
            accepted.Add(new { body, result, retry });
            disputes.Add(await Post(f.Student, "/api/v1/pbe/disputes", new { activity = "Solo", sessionId, attemptId = result.GetProperty("attemptId").GetGuid(), reason = "Fixture review of the second label." }));
        }
        (await f.Student.PostAsJsonAsync(path + "/complete", new { })).EnsureSuccessStatusCode();
        var resolvedId = disputes[1].GetProperty("id").GetString()!;
        var resolve = new { expectedRevision = 1, pointsByPart = new[] { 1, 1 }, reason = "Both frozen labels are supported." };
        var resolved = await Post(f.Coach, "/api/v1/pbe/disputes/" + Uri.EscapeDataString(resolvedId) + "/resolve", resolve);
        Assert.Equal("Resolved", resolved.GetProperty("status").GetString());
        var replay = await Post(f.Coach, "/api/v1/pbe/disputes/" + Uri.EscapeDataString(resolvedId) + "/replay", new { });
        Assert.Equal("Provisional", replay.GetProperty("status").GetString());
        Assert.True(await f.Db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-evidence-replay"));
        Assert.Single(await f.Db.PbeTrainingRecords.Where(r => r.Kind == "pbe-dispute-pending").ToListAsync());
        Assert.Single(await f.Db.PbeTrainingRecords.Where(r => r.Kind == "pbe-dispute-correction").ToListAsync());
        Assert.Single(await f.Db.PbeTrainingRecords.Where(r => r.Kind == "pbe-grade-adjustment").ToListAsync());
        var recap = await f.Student.GetFromJsonAsync<JsonElement>(path + "/recap");
        await f.Factory.StopFixtureHostAsync();
        await Export(f.Factory.FixtureDatabasePath, "solo-correction", new
        {
            f.Org,
            f.Season,
            f.StudentId,
            sessionId,
            startBody,
            accepted,
            pending = disputes[0],
            resolved,
            resolve,
            replay,
            recap,
            provenance = "Coach introduction/question routes and student acceptance/dispute routes; 321 historical events through accepted PrepareRecallEvidenceAsync fixture seam."
        });
    }

    [Fact]
    public async Task Chapter_source_preserves_actual_partial_proof_then_earned_stamp_and_contiguous_two_chapter_assignment()
    {
        using var f = await PbeStudyTests.Fixture.Create(useBuiltInRule: true);
        // The reusable fixture owns an Active introduction season. Preserve it and create
        // a new Draft season through the real lifecycle before defining Scripture scope.
        var ruleProfileKey = (await f.Db.RuleProfiles.AsNoTracking().SingleAsync(r => r.Id == SeedIdentifiers.RuleProfileId)).Key;
        Assert.Equal("PBE_STYLE_V1", ruleProfileKey);
        var draft = await Post(f.Coach, $"/api/v1/organizations/{f.Org}/seasons", new { name = "D3 two chapters", yearLabel = "2026", ruleProfileKey });
        f.Season = draft.GetProperty("id").GetGuid();
        // Initial test content uses the existing internal content fixture seam; authoring,
        // assignment and all chapter execution below use their published routes.
        var imported = await f.Coach.ImportFixtureAsync($"/api/v1/organizations/{f.Org}/content-packs/import", new
        {
            packKey = "d3-two-chapters-" + Guid.NewGuid().ToString("N"),
            version = 1,
            locale = "en",
            sourceType = "Scripture",
            licensingStatus = "development-sample",
            documents = new[] { new { name = "Daniel", units = new[] {
                new { citation = "DAN 1:1", bookKey = "DAN", chapter = 1, verse = 1, ordinal = 1, text = "Alpha and Beta" },
                new { citation = "DAN 2:1", bookKey = "DAN", chapter = 2, verse = 1, ordinal = 2, text = "Alpha and Beta" } } } }
        });
        Assert.True(imported.IsSuccessStatusCode, await imported.Content.ReadAsStringAsync()); var packId = (await imported.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 2, endVerse = 1 };
        (await f.Coach.PostAsJsonAsync($"/api/v1/organizations/{f.Org}/seasons/{f.Season}/scope", new { contentPackId = packId, includes = new[] { range } })).EnsureSuccessStatusCode();
        var assignment = await Post(f.Coach, $"/api/v1/organizations/{f.Org}/seasons/{f.Season}/assignments", new { studentUserId = f.StudentId, type = "RequiredCoverage", contentPackId = packId, range });
        var sources = await f.Db.SourceUnits.AsNoTracking().Where(s => s.ContentPackId == packId).OrderBy(s => s.Chapter).ToArrayAsync();
        var activation = await Post(f.Coach, $"/api/v1/organizations/{f.Org}/seasons/{f.Season}/activate", new { });
        Assert.True(activation.GetProperty("activated").GetBoolean());
        foreach (var source in sources) await Publish(f.Coach, f.Org, f.Season, source, 2);
        (await f.Coach.PostAsJsonAsync($"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var heads = await Bank(f.Db, f.Season);
        var families = heads.GroupBy(h => h.Question.SourceUnitId).Select(family => family.OrderBy(h => h.Question.Id).Select(h => h.Question).ToArray()).ToArray();
        // Acceptance chronology is global per owner/season, not per target family.
        foreach (var questions in families) await Historical(f, questions[0], now - 172800000);
        foreach (var questions in families) await Historical(f, questions[1], now);
        string? workId = null; bool partial = false; JsonElement page = default;
        for (var i = 0; i < 160; i++)
        {
            var step = await Post(f.Student, "/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId });
            var workRow = await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-work");
            var work = JsonSerializer.Deserialize<PbeChapterProgressService.Work>(workRow.DataJson, PbeQuestionBank.Json)!; workId = work.Id;
            if (!partial && work.CapturePhase == "aggregate" && work.Aggregate is not null && work.ProofPages > 0 && work.State != "Complete")
            {
                // Stop this source host before consistent capture. Reopen the complete backup
                // under a new normal host to finish, retaining its original work/proof cursor.
                await f.Factory.StopFixtureHostAsync();
                var backup = await Export(f.Factory.FixtureDatabasePath, "chapter-aggregate", new
                {
                    f.Org,
                    f.Season,
                    f.StudentId,
                    assignment,
                    work = JsonSerializer.SerializeToElement(work, PbeQuestionBank.Json),
                    step,
                    provenance = "Actual chapter continuation; source content fixture import and historical evidence through accepted D1 seam, never direct stamp insertion."
                });
                partial = true;
                var continuationPath = Path.Combine(Output, "chapter-continuation-working.db");
                await CopyDatabase(backup, continuationPath);
                using var reopened = new ErudozaApiFactory(continuationPath) { DisablePracticeTicker = true };
                using var student = await TestHttp.LoginAsync(reopened, "daniel.student", "DevStudent!234");
                using var scope = reopened.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
                for (var n = 0; n < 100; n++)
                {
                    var resumed = await Post(student, "/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId });
                    if (resumed.GetProperty("next").GetString() == "Reload") { page = await student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}"); break; }
                }
                Assert.NotEqual(JsonValueKind.Undefined, page.ValueKind);
                Assert.Equal(2, await db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-chapter-stamp"));
                Assert.All(page.GetProperty("items").EnumerateArray(), item => Assert.Equal("Retained", item.GetProperty("currentReadiness").GetString()));
                var spans = await db.Assignments.AsNoTracking().Include(a => a.Scopes).SingleAsync(a => a.Id == assignment.GetProperty("id").GetGuid());
                Assert.Equal(1, Assert.Single(spans.Scopes).StartChapter); Assert.Equal(2, Assert.Single(spans.Scopes).EndChapter);
                await reopened.StopFixtureHostAsync();
                await Export(reopened.FixtureDatabasePath, "chapter-complete", new { f.Org, f.Season, f.StudentId, assignment, page, workId, provenance = "Real projector-earned stamps after normal stopped-source restart and continuation; no inserted stamps." });
                break;
            }
        }
        Assert.True(partial, "The actual projector must expose a supported pending proof continuation.");
    }

    [Fact]
    public async Task Room_source_has_full90_completed_and_real_restart_interrupted_authority()
    {
        var time = new FixtureTime();
        using var f = await PracticeRoomHttpTests.Setup.Create(true, time);
        var clients = new List<HttpClient> { f.Owner };
        var auth = new List<object> { new { identifier = "daniel.student", password = "DevStudent!234" } };
        for (var i = 1; i < 6; i++)
        {
            var userName = "restore-player-" + Guid.NewGuid().ToString("N")[..10];
            (await f.Admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students", new { userName, displayName = "Restore player " + i, password = "PracticePass!234" })).EnsureSuccessStatusCode();
            clients.Add(await TestHttp.LoginAsync(f.Factory, userName, "PracticePass!234"));
            auth.Add(new { identifier = userName, password = "PracticePass!234" });
        }
        var ids = new List<Guid>(); foreach (var client in clients) ids.Add((await client.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid());
        using var scope = f.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var source = await db.SourceUnits.AsNoTracking().SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"));
        foreach (var studentUserId in ids)
            await Post(f.Admin, $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{f.SeasonId}/assignments", new { studentUserId, type = "RequiredCoverage", contentPackId = source.ContentPackId, range = new { bookKey = "DAN", startChapter = 1, endChapter = 1, startVerse = 8, endVerse = 8 }, difficulty = "Advanced" });
        await Publish(f.Admin, SeedIdentifiers.OrganizationId, f.SeasonId, source, 91);
        (await f.Admin.PostAsJsonAsync(f.Path + $"/pbe/seasons/{f.SeasonId}/enabled", new { enabled = true })).EnsureSuccessStatusCode();
        var commands = new List<object>();
        async Task<JsonElement> RunRoom(int questionCount, int teamCount, int teamSize, bool finish)
        {
            var room = await Post(f.Admin, f.Path + "/rooms", new { seasonId = f.SeasonId, format = "Pbe", questionCount, teamCount, teamSize, coached = false });
            var roomId = room.GetProperty("id").GetGuid(); var path = f.Path + "/rooms/" + roomId;
            async Task Command(HttpClient actor, string action, object? extra = null)
            {
                var actorId = (await actor.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
                var body = new Dictionary<string, object?> { ["commandId"] = Guid.NewGuid(), ["revision"] = room.GetProperty("revision").GetInt64(), ["action"] = action };
                if (extra is not null) foreach (var p in JsonSerializer.SerializeToElement(extra).EnumerateObject()) body[p.Name] = p.Value;
                room = await Post(actor, path + "/commands", body); commands.Add(new { roomId, actorId, body });
            }
            for (var n = 0; n < teamCount * teamSize; n++)
            {
                await Command(f.Admin, "invite", new { targetUserId = ids[n], team = n / teamSize + 1 });
                var inbox = await clients[n].GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap");
                room = await Post(clients[n], f.Path + "/invitations/" + inbox.GetProperty("invitations")[0].GetProperty("id").GetGuid() + "/accept", new { team = n / teamSize + 1 });
            }
            foreach (var client in clients.Take(teamCount * teamSize)) await Command(client, "ready");
            await Command(clients[0], "start");
            for (var q = 0; q < (finish ? questionCount : 1); q++)
            {
                var questionId = room.GetProperty("question").GetProperty("id").GetGuid();
                for (var team = 0; team < teamCount; team++) await Command(clients[team * teamSize], "present", new { questionId, delivery = team == 0 ? "TextFallback" : "Audio" });
                time.Advance(TimeSpan.FromSeconds(3));
                for (var team = 0; team < (finish ? teamCount : 1); team++) await Command(clients[team * teamSize], "submit", new { questionId, answers = new[] { "Alpha", q == 0 ? "wrong" : "Beta" } });
                if (!finish) break;
                time.Advance(TimeSpan.FromSeconds(10)); room = await clients[0].GetFromJsonAsync<JsonElement>(path);
                if (room.GetProperty("phase").GetString() == "Break") { time.Advance(TimeSpan.FromMinutes(5)); room = await clients[0].GetFromJsonAsync<JsonElement>(path); }
            }
            return room;
        }
        var completed = await RunRoom(90, 1, 6, true); Assert.Equal("Completed", completed.GetProperty("status").GetString());
        var completedId = completed.GetProperty("id").GetGuid();
        var completedState = PracticeJson.Read<PracticeRoom>((await db.Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == completedId)).StateJson);
        Assert.Equal(90, completedState.Submissions.Count); Assert.Equal(6, completedState.Members.Count);
        var completedDispute = await Post(clients[0], "/api/v1/pbe/disputes", new { activity = "Team", sessionId = completedId, attemptId = completedState.Submissions[0].AttemptId, reason = "Check this saved final." });
        var resolve = new { expectedRevision = 1, pointsByPart = new[] { 1, 1 }, reason = "Frozen labels support both parts." };
        var resolved = await Post(f.Admin, "/api/v1/pbe/disputes/" + Uri.EscapeDataString(completedDispute.GetProperty("id").GetString()!) + "/resolve", resolve);
        var interruptedBefore = await RunRoom(10, 2, 2, false); var interruptedId = interruptedBefore.GetProperty("id").GetGuid();
        var originalProcess = f.Factory.Services.GetRequiredService<PracticeRuntime>().ProcessId;
        await f.Factory.StopFixtureHostAsync();
        Directory.CreateDirectory(Output); var restartPath = Path.Combine(Output, "rooms-restart-working.db");
        await CopyDatabase(f.Factory.FixtureDatabasePath, restartPath);
        using var reopened = new ErudozaApiFactory(restartPath) { DisablePracticeTicker = true, TestTimeProvider = time };
        using var owner = await TestHttp.LoginAsync(reopened, "daniel.student", "DevStudent!234");
        using var coach = await TestHttp.LoginAsync(reopened, "admin@erudoza.local", "DevAdmin!234");
        Assert.NotEqual(originalProcess, reopened.Services.GetRequiredService<PracticeRuntime>().ProcessId);
        var interrupted = await owner.GetFromJsonAsync<JsonElement>(f.Path + "/rooms/" + interruptedId); Assert.Equal("Interrupted", interrupted.GetProperty("status").GetString());
        using var reopenedScope = reopened.Services.CreateScope(); var restoredDb = reopenedScope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var interruptedState = PracticeJson.Read<PracticeRoom>((await restoredDb.Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == interruptedId)).StateJson);
        var pending = await Post(owner, "/api/v1/pbe/disputes", new { activity = "Team", sessionId = interruptedId, attemptId = Assert.Single(interruptedState.Submissions).AttemptId, reason = "Check this interrupted final." });
        var recap = await owner.GetFromJsonAsync<JsonElement>(f.Path + "/rooms/" + completedId);
        var bootstrap = await owner.GetFromJsonAsync<JsonElement>(f.Path + "/bootstrap");
        Assert.NotEmpty(await restoredDb.Set<PracticeAwardRecord>().AsNoTracking().ToListAsync());
        var terminal = await restoredDb.Set<PracticeRoomRecord>().AsNoTracking().ToListAsync();
        Assert.Equal(2, terminal.Count); Assert.All(terminal, r => Assert.Contains(PracticeJson.Read<PracticeRoom>(r.StateJson).Status, new[] { "Completed", "Interrupted" }));
        await reopened.StopFixtureHostAsync();
        await Export(reopened.FixtureDatabasePath, "rooms-terminal", new
        {
            org = SeedIdentifiers.OrganizationId,
            season = f.SeasonId,
            ids,
            authentication = auth,
            completedId,
            interruptedId,
            commands,
            resolved,
            resolve,
            pending,
            recap,
            interrupted,
            bootstrap,
            rooms = terminal.Select(r => new { r.Id, state = JsonSerializer.Deserialize<JsonElement>(r.StateJson) }),
            provenance = "Actual published coach bank/assignment and six-student full90 routes; second room interrupted by real stopped-host/new-runtime restart. No authority edits."
        });
        foreach (var client in clients.Skip(1)) client.Dispose();
    }

    [Fact]
    public async Task Existing_database_factory_preserves_stopped_backup_and_default_factory_cleans_up()
    {
        var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var original = db.Database.GetDbConnection().DataSource; var count = await db.Users.CountAsync();
        await factory.StopFixtureHostAsync(); Directory.CreateDirectory(Output); var backup = Path.Combine(Output, "factory-lifecycle-working.db");
        await CopyDatabase(original, backup); scope.Dispose(); factory.Dispose(); Assert.False(File.Exists(original));
        using (var reopened = new ErudozaApiFactory(backup) { DisablePracticeTicker = true })
        {
            using var client = await TestHttp.LoginAsync(reopened, "admin@erudoza.local", "DevAdmin!234");
            using var services = reopened.Services.CreateScope(); Assert.Equal(count, await services.ServiceProvider.GetRequiredService<ErudozaDbContext>().Users.CountAsync());
            await reopened.StopFixtureHostAsync();
        }
        Assert.True(File.Exists(backup));
        Assert.Throws<FileNotFoundException>(() => new ErudozaApiFactory(Path.Combine(Output, "does-not-exist.db")));
    }

    private sealed class FixtureTime : TimeProvider
    {
        private long stamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => stamp;
        public override DateTimeOffset GetUtcNow() => new DateTimeOffset(2026, 9, 12, 12, 0, 0, TimeSpan.Zero).AddTicks(stamp);
        public void Advance(TimeSpan elapsed) => stamp += elapsed.Ticks;
    }

    private static async Task CopyDatabase(string source, string target)
    {
        Assert.False(File.Exists(target));
        await using var from = new SqliteConnection($"Data Source={source};Mode=ReadOnly"); await from.OpenAsync();
        await using var to = new SqliteConnection($"Data Source={target}"); await to.OpenAsync(); from.BackupDatabase(to);
    }

    private static async Task<PbeBankQuestionData[]> Bank(ErudozaDbContext db, Guid season) => (await db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == season && r.Kind == "pbe-question-head").OrderBy(r => r.Id).ToListAsync()).Select(r => JsonSerializer.Deserialize<PbeBankQuestionData>(r.DataJson, PbeQuestionBank.Json)!).ToArray();

    private static async Task Historical(PbeStudyTests.Fixture f, PbeQuestion q, long at)
    {
        using var scope = f.Factory.Services.CreateScope(); var progress = scope.ServiceProvider.GetRequiredService<PbeProgressService>();
        var attempt = Guid.NewGuid(); var evidence = q.Parts.Select(p => new PbeRecallEvidence(attempt, p.TargetId, q.Id, at, p.Points, p.Points, true, true)).ToArray();
        await progress.ExecuteAsync(ct => progress.PrepareRecallEvidenceAsync(f.Org, f.Season, f.StudentId, "d3-historical-fixture", evidence, ct, q.Kind.ToString(), q.Version, at));
    }

    private static async Task Publish(HttpClient coach, Guid org, Guid season, SourceUnit source, int count)
    {
        var targets = new[] { Guid.NewGuid(), Guid.NewGuid() }; var path = $"/api/v1/organizations/{org}/practice/pbe/seasons/{season}";
        for (var i = 0; i < count; i++)
        {
            var questionId = Guid.NewGuid();
            var input = new
            {
                targets = targets.Select(id => new { id, sourceUnitIds = new[] { source.Id }, skill = "FactualRecall", label = "Source labels" }),
                questions = new[] {
                new { schemaVersion = 2, id = questionId, version = 1, contentPackId = source.ContentPackId, sourceUnitId = source.Id, sourceUnitIds = new[] { source.Id }, sourceKind = "Scripture", reference = source.CitationLabel, evidence = source.CanonicalText, kind = "List", prompt = "Name the labels " + i, ordered = false, parts = targets.Select((targetId, n) => new { targetId, acceptedAnswers = new[] { n == 0 ? "Alpha" : "Beta" }, points = 1 }) } }
            };
            using var imported = await coach.PostAsJsonAsync(path + "/questions/import", input);
            Assert.True(imported.IsSuccessStatusCode, await imported.Content.ReadAsStringAsync());
            using var published = await coach.PostAsJsonAsync(path + $"/questions/{questionId}/1/publish", new { });
            Assert.True(published.IsSuccessStatusCode, await published.Content.ReadAsStringAsync());
        }
    }

    private static async Task<JsonElement> Post(HttpClient client, string path, object body)
    {
        using var response = await client.PostAsJsonAsync(path, body);
        Assert.True(response.IsSuccessStatusCode, $"{path}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<string> Export(string sourcePath, string name, object expected)
    {
        await using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite($"Data Source={sourcePath};Mode=ReadOnly").Options);
        Directory.CreateDirectory(Output); var path = Path.Combine(Output, name + ".db");
        Assert.False(File.Exists(path), "Keep prior source snapshots immutable; use a fresh ignored output directory for a new run.");
        await db.Database.OpenConnectionAsync();
        await using (var target = new SqliteConnection($"Data Source={path}")) { await target.OpenAsync(); ((SqliteConnection)db.Database.GetDbConnection()).BackupDatabase(target); }
        await using var check = new SqliteConnection($"Data Source={path};Mode=ReadOnly"); await check.OpenAsync();
        var tableNames = new List<string>(); await using (var query = check.CreateCommand()) { query.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"; await using var rows = await query.ExecuteReaderAsync(); while (await rows.ReadAsync()) tableNames.Add(rows.GetString(0)); }
        var tables = new Dictionary<string, long>(); foreach (var nameInDb in tableNames) { await using var q = check.CreateCommand(); q.CommandText = "SELECT COUNT(*) FROM \"" + nameInDb.Replace("\"", "\"\"", StringComparison.Ordinal) + "\""; tables[nameInDb] = (long)(await q.ExecuteScalarAsync())!; }
        await using (var q = check.CreateCommand()) { q.CommandText = "PRAGMA integrity_check"; Assert.Equal("ok", await q.ExecuteScalarAsync()); }
        var records = await db.PbeTrainingRecords.AsNoTracking().OrderBy(r => r.Kind).ThenBy(r => r.Id).ToListAsync();
        Assert.DoesNotContain(records, r => r.Kind.Contains("outbox", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(records, r => r.Kind.StartsWith("pbe-cooperation-", StringComparison.Ordinal));
        await using var sourceFile = File.OpenRead(path);
        var sha256 = Convert.ToHexStringLower(await SHA256.HashDataAsync(sourceFile));
        var manifest = new
        {
            schemaVersion = 1,
            declaredScope = "complete canonical source database",
            source = path,
            sha256,
            bytes = new FileInfo(path).Length,
            tables,
            kinds = records.GroupBy(r => r.Kind).ToDictionary(g => g.Key, g => g.Count()),
            records = records.Select(r => new { r.OrganizationId, r.SeasonId, r.OwnerId, r.Kind, r.Id, r.Revision, dataSha256 = Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(r.DataJson))) }),
            expected,
            authentication = new[] { new { identifier = "admin@erudoza.local", password = "DevAdmin!234" }, new { identifier = "daniel.student", password = "DevStudent!234" } }
        };
        await File.WriteAllTextAsync(Path.Combine(Output, name + ".manifest.json"), JsonSerializer.Serialize(manifest, Json));
        return path;
    }
}
