using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Api.Practice;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class PracticeRoomHttpTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public async Task Every_supported_size_creates_a_private_lobby_with_student_owner_on_first_team(int size)
    {
        using var fixture = await Setup.Create();
        var room = await fixture.CreateRoom(size);
        Assert.Equal(size, room.GetProperty("teamSize").GetInt32());
        Assert.Equal("Lobby", room.GetProperty("status").GetString());
        var member = Assert.Single(room.GetProperty("members").EnumerateArray());
        Assert.Equal(SeedIdentifiers.StudentUserId, member.GetProperty("userId").GetGuid());
        Assert.Equal(1, member.GetProperty("team").GetInt32());
        using var outsider = await fixture.Student("outsider");
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync(fixture.Path + "/rooms/" + room.GetProperty("id").GetGuid())).StatusCode);
        var bootstrap = await outsider.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        Assert.Empty(bootstrap.GetProperty("rooms").EnumerateArray());
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(6, 10)]
    [InlineData(1, 11)]
    public async Task Invalid_room_shapes_do_not_create_rooms(int size, int count)
    {
        using var fixture = await Setup.Create();
        var response = await fixture.Owner.PostAsJsonAsync(fixture.Path + "/rooms", new { seasonId = fixture.SeasonId, teamSize = size, questionCount = count, coached = false });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var bootstrap = await fixture.Owner.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        Assert.Empty(bootstrap.GetProperty("rooms").EnumerateArray());
    }

    [Fact]
    public async Task Student_cannot_create_coached_room_or_import_answer_keys()
    {
        using var fixture = await Setup.Create();
        var response = await fixture.Owner.PostAsJsonAsync(fixture.Path + "/rooms", new { seasonId = fixture.SeasonId, teamSize = 1, questionCount = 10, coached = true });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        response = await fixture.Owner.PostAsJsonAsync(fixture.Path + "/questions/import", new { seasonId = fixture.SeasonId, questions = new[] { fixture.Question() } });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Import_revisions_preserve_old_definition_and_students_never_receive_answer_keys()
    {
        using var fixture = await Setup.Create();
        var question = fixture.Question();
        (await fixture.Admin.PostAsJsonAsync(fixture.Path + "/questions/import", new { seasonId = fixture.SeasonId, questions = new[] { question } })).EnsureSuccessStatusCode();
        question.Prompt = "Revised prompt";
        (await fixture.Admin.PostAsJsonAsync(fixture.Path + "/questions/import", new { seasonId = fixture.SeasonId, questions = new[] { question } })).EnsureSuccessStatusCode();
        var coach = await fixture.Admin.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        var versions = coach.GetProperty("questions").EnumerateArray().Select(q => q.GetProperty("question")).OrderBy(q => q.GetProperty("version").GetInt32()).ToArray();
        Assert.Equal(2, versions.Length);
        Assert.Equal("Who purposed in his heart?", versions[0].GetProperty("prompt").GetString());
        Assert.Equal(1, versions[0].GetProperty("version").GetInt32());
        Assert.Equal("Revised prompt", versions[1].GetProperty("prompt").GetString());
        Assert.Equal(2, versions[1].GetProperty("version").GetInt32());
        var student = await fixture.Owner.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        Assert.Empty(student.GetProperty("questions").EnumerateArray());
    }

    [Fact]
    public async Task Team_invitation_enforces_destination_and_cannot_be_replayed_or_overfill_team()
    {
        using var fixture = await Setup.Create();
        var room = await fixture.CreateRoom(1);
        using var guest = await fixture.Student("guest");
        using var extra = await fixture.Student("extra");
        var guestId = (await guest.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        var extraId = (await extra.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        room = await fixture.Command(room, "invite", guestId, 2);
        var inbox = await guest.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        var invitation = Assert.Single(inbox.GetProperty("invitations").EnumerateArray()).GetProperty("id").GetGuid();
        var acceptPath = fixture.Path + $"/invitations/{invitation}/accept";
        var accepted = await guest.PostAsJsonAsync(acceptPath, new { team = 1 });
        accepted.EnsureSuccessStatusCode();
        var state = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, state.GetProperty("members").EnumerateArray().Single(m => m.GetProperty("userId").GetGuid() == guestId).GetProperty("team").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await guest.PostAsJsonAsync(acceptPath, new { team = 2 })).StatusCode);
        room = await fixture.Command(state, "invite", extraId, 2);
        inbox = await extra.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        invitation = Assert.Single(inbox.GetProperty("invitations").EnumerateArray()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await extra.PostAsJsonAsync(fixture.Path + $"/invitations/{invitation}/accept", new { team = 2 })).StatusCode);
        var current = await fixture.Owner.GetFromJsonAsync<JsonElement>(fixture.Path + "/rooms/" + room.GetProperty("id").GetGuid());
        Assert.Equal(2, current.GetProperty("members").GetArrayLength());
    }

    [Fact]
    public async Task Owner_move_clears_readiness_and_command_retry_does_not_toggle_it_again()
    {
        using var fixture = await Setup.Create();
        var room = await fixture.CreateRoom(2);
        var idempotency = Guid.NewGuid();
        var body = new { commandId = idempotency, revision = room.GetProperty("revision").GetInt64(), action = "ready" };
        var path = fixture.Path + "/rooms/" + room.GetProperty("id").GetGuid() + "/commands";
        var response = await fixture.Owner.PostAsJsonAsync(path, body);
        response.EnsureSuccessStatusCode();
        var first = await response.Content.ReadFromJsonAsync<JsonElement>();
        response = await fixture.Owner.PostAsJsonAsync(path, body);
        response.EnsureSuccessStatusCode();
        var retry = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(Assert.Single(retry.GetProperty("members").EnumerateArray()).GetProperty("ready").GetBoolean());
        Assert.Equal(first.GetProperty("revision").GetInt64(), retry.GetProperty("revision").GetInt64());
        room = await fixture.Command(retry, "move", SeedIdentifiers.StudentUserId, 2);
        var moved = Assert.Single(room.GetProperty("members").EnumerateArray());
        Assert.False(moved.GetProperty("ready").GetBoolean());
        Assert.Equal(2, moved.GetProperty("team").GetInt32());
    }

    [Fact]
    public async Task Premature_submit_returns_validation_error_and_owner_cannot_invite_cross_organization_user()
    {
        using var fixture = await Setup.Create();
        var room = await fixture.CreateRoom(1);
        var path = fixture.Path + "/rooms/" + room.GetProperty("id").GetGuid() + "/commands";
        var response = await fixture.Owner.PostAsJsonAsync(path, new
        {
            commandId = Guid.NewGuid(),
            revision = room.GetProperty("revision").GetInt64(),
            action = "submit",
            questionId = Guid.NewGuid(),
            answers = new[] { "Daniel" }
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        response = await fixture.Owner.PostAsJsonAsync(path, new
        {
            commandId = Guid.NewGuid(),
            revision = room.GetProperty("revision").GetInt64(),
            action = "invite",
            targetUserId = SeedIdentifiers.IsolationAdminUserId,
            team = 2
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Persisted_match_scores_ingress_time_before_queue_delay_and_preserves_it_on_retry()
    {
        using var fixture = await Setup.Create(disableTicker: true);
        using var guest = await fixture.Student("timed");
        var guestId = (await guest.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var time = new PracticeTestTime();
        var runtime = new PracticeRuntime(time);
        var service = new PracticeService(db, runtime, scope.ServiceProvider.GetRequiredService<IConfiguration>());
        var org = SeedIdentifiers.OrganizationId;
        var coach = new PracticeActor(SeedIdentifiers.AdminUserId, org, "Coach", true);
        var owner = new PracticeActor(SeedIdentifiers.StudentUserId, org, "Owner", false);
        var other = new PracticeActor(guestId, org, "Opponent", false);
        await service.Import(org, coach, new ImportPracticeQuestions(fixture.SeasonId, Enumerable.Range(0, 11).Select(_ => fixture.Question()).ToList()), default);
        foreach (var question in await db.Set<PracticeQuestionRecord>().ToListAsync())
            await service.Publish(org, question.Id, coach, default);
        var created = JsonSerializer.SerializeToElement(await service.Create(org, owner, new CreatePracticeRoom(fixture.SeasonId, 1, 10, false, "DAN"), default), PracticeJson.Options);
        var id = created.GetProperty("id").GetGuid();
        async Task<PracticeRoom> State()
        {
            var row = await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == id);
            return PracticeJson.Read<PracticeRoom>(row.StateJson);
        }
        async Task Send(PracticeActor actor, string action, Guid? target = null, int? team = null, Guid? schedule = null)
        {
            await service.Command(org, id, actor, new PracticeCommand(Guid.NewGuid(), (await State()).Revision, action, target, team, ScheduleId: schedule), runtime.Stamp(), default);
        }
        await Send(owner, "invite", guestId, 2);
        await service.Accept(org, (await State()).Invitations.Single().Id, 2, other, default);
        await Send(owner, "ready");
        await Send(other, "ready");
        await Send(owner, "start");
        time.Advance(TimeSpan.FromSeconds(15));
        await service.Snapshot(org, id, owner, default);
        var scheduled = await State();
        Assert.Equal("Scheduled", scheduled.Phase);
        await Send(owner, "ack", schedule: scheduled.ScheduleId);
        await Send(other, "ack", schedule: scheduled.ScheduleId);
        time.Advance(scheduled.ResponseStartsAt!.Value - time.GetUtcNow() + TimeSpan.FromSeconds(5));
        var ingress = runtime.Stamp();
        var current = await State();
        var command = new PracticeCommand(Guid.NewGuid(), current.Revision, "submit", Answers: ["Daniel"], QuestionId: current.Questions[current.QuestionIndex].Id);
        time.Advance(TimeSpan.FromSeconds(10));
        time.ShiftUtc(TimeSpan.FromHours(-3));
        await service.Command(org, id, owner, command, ingress, default);
        var scored = Assert.Single((await State()).Submissions, s => s.Team == 1);
        Assert.Equal(TimeSpan.FromSeconds(5).Ticks, scored.ElapsedTicks);
        Assert.Equal(100, scored.AccuracyHundredths);
        Assert.Equal(20, scored.SpeedHundredths);
        time.Advance(TimeSpan.FromSeconds(3));
        await service.Command(org, id, owner, command, runtime.Stamp(), default);
        var retry = Assert.Single((await State()).Submissions, s => s.Team == 1);
        Assert.Equal(scored.ElapsedTicks, retry.ElapsedTicks);
        Assert.Equal(20, retry.SpeedHundredths);

        async Task Submit(PracticeActor actor)
        {
            var state = await State();
            await service.Command(org, id, actor, new PracticeCommand(Guid.NewGuid(), state.Revision, "submit",
                Answers: ["Daniel"], QuestionId: state.Questions[state.QuestionIndex].Id), runtime.Stamp(), default);
        }
        await Submit(other);
        time.Advance(TimeSpan.FromSeconds(10));
        await service.Tick(default);
        for (var index = 1; index < 10; index++)
        {
            Assert.Equal(index, (await State()).QuestionIndex);
            time.Advance(TimeSpan.FromSeconds(15));
            await service.Tick(default);
            var start = await State();
            await Send(owner, "ack", schedule: start.ScheduleId);
            await Send(other, "ack", schedule: start.ScheduleId);
            time.Advance(TimeSpan.FromSeconds(8));
            await Submit(owner);
            await Submit(other);
            time.Advance(TimeSpan.FromSeconds(10));
            if (index == 9) await service.Snapshot(org, id, owner, default);
            else await service.Tick(default);
        }
        var complete = await State();
        Assert.Equal("Completed", complete.Status);
        Assert.Equal(20, complete.Submissions.Count);
        Assert.Equal(1000, complete.Submissions.Where(s => s.Team == 1).Sum(s => s.AccuracyHundredths));
        Assert.Equal(200, complete.Submissions.Where(s => s.Team == 1).Sum(s => s.SpeedHundredths));
        Assert.Contains(complete.Awards, a => a.UserId == owner.Id && a.Key == "first-fellowship");
        Assert.Contains(complete.Awards, a => a.UserId == owner.Id && a.Key == "shared-scribe");
        var mastery = await db.MasteryHonorUnlocks.SingleAsync(a => a.UserId == owner.Id && a.Key == "team:first-fellowship");
        using var masteryEvidence = JsonDocument.Parse(mastery.EvidenceJson);
        Assert.Equal(10, masteryEvidence.RootElement.GetProperty("personalQuestions").GetArrayLength());
        Assert.DoesNotContain(await db.MasteryHonorUnlocks.Where(a => a.UserId == owner.Id).ToListAsync(), a => a.Key == "team:shared-scribe");
        var frozenMastery = mastery.EvidenceJson;
        await service.Snapshot(org, id, owner, default);
        Assert.Equal(frozenMastery, (await db.MasteryHonorUnlocks.SingleAsync(a => a.Id == mastery.Id)).EvidenceJson);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Start_excludes_explicitly_excluded_passages_and_inactive_content_packs(bool inactivePack)
    {
        using var fixture = await Setup.Create(disableTicker: true);
        var questions = Enumerable.Range(0, 11).Select(_ => fixture.Question()).ToArray();
        (await fixture.Admin.PostAsJsonAsync(fixture.Path + "/questions/import", new { seasonId = fixture.SeasonId, questions })).EnsureSuccessStatusCode();
        var bank = await fixture.Admin.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        foreach (var question in bank.GetProperty("questions").EnumerateArray())
            (await fixture.Admin.PostAsJsonAsync(fixture.Path + "/questions/" + question.GetProperty("id").GetGuid() + "/publish", new { })).EnsureSuccessStatusCode();
        var room = await fixture.CreateRoom(1);
        using var guest = await fixture.Student("excluded");
        var guestId = (await guest.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        await fixture.Command(room, "invite", guestId, 2);
        var inbox = await guest.GetFromJsonAsync<JsonElement>(fixture.Path + "/bootstrap");
        var invitation = Assert.Single(inbox.GetProperty("invitations").EnumerateArray()).GetProperty("id").GetGuid();
        var accepted = await guest.PostAsJsonAsync(fixture.Path + $"/invitations/{invitation}/accept", new { team = 2 });
        accepted.EnsureSuccessStatusCode();
        room = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        room = await fixture.Command(room, "ready");
        var path = fixture.Path + "/rooms/" + room.GetProperty("id").GetGuid();
        var ready = await guest.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action = "ready" });
        ready.EnsureSuccessStatusCode();
        room = await ready.Content.ReadFromJsonAsync<JsonElement>();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            if (inactivePack) (await db.ContentPacks.SingleAsync(p => p.Id == SeedIdentifiers.ContentPackId)).IsActive = false;
            else db.ScopeEntries.Add(new CompetitionScopeEntry
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                SeasonId = fixture.SeasonId,
                ContentPackId = SeedIdentifiers.ContentPackId,
                Kind = ScopeEntryKind.Exclude,
                BookKey = "DAN",
                StartChapter = 1,
                EndChapter = 1,
                StartVerse = 8,
                EndVerse = 8
            });
            await db.SaveChangesAsync();
        }
        var start = await fixture.Owner.PostAsJsonAsync(path + "/commands", new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action = "start" });
        Assert.Equal(HttpStatusCode.BadRequest, start.StatusCode);
        var unchanged = await fixture.Owner.GetFromJsonAsync<JsonElement>(path);
        Assert.Equal("Lobby", unchanged.GetProperty("status").GetString());
    }

    private sealed class PracticeTestTime : TimeProvider
    {
        private long timestamp;
        private DateTimeOffset utc = new(2026, 9, 10, 0, 0, 0, TimeSpan.Zero);
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => timestamp;
        public override DateTimeOffset GetUtcNow() => utc;
        public void Advance(TimeSpan duration) { timestamp += duration.Ticks; utc += duration; }
        public void ShiftUtc(TimeSpan duration) => utc += duration;
    }

    internal sealed class Setup : IDisposable
    {
        public ErudozaApiFactory Factory { get; } = new();
        public HttpClient Admin { get; private set; } = null!;
        public HttpClient Owner { get; private set; } = null!;
        public Guid SeasonId { get; } = Guid.NewGuid();
        public string Path => $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/practice";

        public static async Task<Setup> Create(bool disableTicker = false, TimeProvider? time = null)
        {
            var fixture = new Setup();
            fixture.Factory.DisablePracticeTicker = disableTicker;
            fixture.Factory.TestTimeProvider = time;
            fixture.Admin = await TestHttp.LoginAsync(fixture.Factory, "admin@erudoza.local", "DevAdmin!234");
            fixture.Owner = await TestHttp.LoginAsync(fixture.Factory, "daniel.student", "DevStudent!234");
            using var scope = fixture.Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            db.Seasons.Add(new CompetitionSeason
            {
                Id = fixture.SeasonId,
                OrganizationId = SeedIdentifiers.OrganizationId,
                Name = "Practice integration season",
                YearLabel = "2026",
                RuleProfileId = SeedIdentifiers.RuleProfileId,
                Status = SeasonStatus.Active
            });
            db.ScopeEntries.Add(new CompetitionScopeEntry
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                SeasonId = fixture.SeasonId,
                ContentPackId = SeedIdentifiers.ContentPackId,
                Kind = ScopeEntryKind.Include,
                BookKey = "DAN",
                StartChapter = 1,
                EndChapter = 1,
                StartVerse = 1,
                EndVerse = 8
            });
            await db.SaveChangesAsync();
            (await fixture.Admin.PostAsJsonAsync(fixture.Path + "/enabled", new { enabled = true })).EnsureSuccessStatusCode();
            return fixture;
        }

        public async Task<HttpClient> Student(string prefix)
        {
            var userName = prefix + Guid.NewGuid().ToString("N")[..10];
            (await Admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/students",
                new { userName, displayName = prefix, password = "PracticePass!234" })).EnsureSuccessStatusCode();
            return await TestHttp.LoginAsync(Factory, userName, "PracticePass!234");
        }

        public async Task<JsonElement> CreateRoom(int size)
        {
            var response = await Owner.PostAsJsonAsync(Path + "/rooms", new { seasonId = SeasonId, teamSize = size, questionCount = 10, coached = false });
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }

        public async Task<JsonElement> Command(JsonElement room, string action, Guid? targetUserId = null, int? team = null)
        {
            var response = await Owner.PostAsJsonAsync(Path + "/rooms/" + room.GetProperty("id").GetGuid() + "/commands",
                new { commandId = Guid.NewGuid(), revision = room.GetProperty("revision").GetInt64(), action, targetUserId, team });
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }

        public PracticeQuestion Question() => new()
        {
            Id = Guid.NewGuid(),
            ContentPackId = SeedIdentifiers.ContentPackId,
            SourceUnitId = Guid.Parse("77777777-7777-7777-7777-777777777708"),
            Prompt = "Who purposed in his heart?",
            Reference = "Daniel 1:8",
            Evidence = "Daniel purposed in his heart",
            Version = 1,
            Parts = [new AnswerPart { AcceptedAnswers = ["Daniel"], Points = 1 }]
        };

        public void Dispose() { Admin?.Dispose(); Owner?.Dispose(); Factory.Dispose(); }
    }
}
