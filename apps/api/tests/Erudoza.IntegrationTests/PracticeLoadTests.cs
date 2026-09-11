using System.Collections.Concurrent;
using System.Diagnostics;
using Erudoza.Api.Practice;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace Erudoza.IntegrationTests;

public sealed class PracticeLoadTests(ITestOutputHelper output)
{
    [PracticeLoadFact]
    [Trait("Category", "Load")]
    public async Task Twenty_concurrent_5v5_rooms_preserve_200_players_and_240_commands()
    {
        using var fixture = await PracticeEngineFixture.Create(20, 5);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            await db.Database.OpenConnectionAsync();
            using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "PRAGMA journal_mode";
            var journal = await command.ExecuteScalarAsync();
            command.CommandText = "PRAGMA synchronous";
            var synchronous = await command.ExecuteScalarAsync();
            output.WriteLine($"SQLite durability: journal_mode={journal}, synchronous={synchronous} (2=FULL).");
        }
        var measurements = new ConcurrentBag<double>();
        var simultaneousStart = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var work = fixture.Rooms.SelectMany(room => room.Members.Select(async member =>
        {
            await simultaneousStart.Task;
            var timer = Stopwatch.StartNew();
            await fixture.Command(room.Id, member.UserId, "chat", text: "Team practice suggestion");
            measurements.Add(timer.Elapsed.TotalMilliseconds);
        })).ToArray();
        simultaneousStart.SetResult();
        await Task.WhenAll(work);
        await Task.WhenAll(fixture.Rooms.SelectMany(room => room.Members.Where(m => m.Scribe).Select(async member =>
        {
            var timer = Stopwatch.StartNew();
            await fixture.Command(room.Id, member.UserId, "submit", answers: ["Daniel"], questionId: room.Questions[0].Id);
            measurements.Add(timer.Elapsed.TotalMilliseconds);
        })));
        foreach (var room in fixture.Rooms)
        {
            var persisted = await fixture.Read(room.Id);
            Assert.Equal(10, persisted.Members.Count);
            Assert.Equal(5, persisted.Members.Count(m => m.Team == 1));
            Assert.Equal(5, persisted.Members.Count(m => m.Team == 2));
            Assert.Equal(10, persisted.Messages.Count);
            Assert.Equal(12, persisted.AppliedCommands.Count);
            Assert.Equal(2, persisted.Submissions.Count);
            Assert.All(persisted.Submissions, s => { Assert.Equal(100, s.AccuracyHundredths); Assert.Equal(20, s.SpeedHundredths); });
            Assert.Equal("Review", persisted.Phase);
        }
        var sorted = measurements.Order().ToArray();
        Assert.Equal(240, sorted.Length);
        var p95 = sorted[(int)Math.Ceiling(sorted.Length * .95) - 1];
        output.WriteLine($"Local SQLite service command acknowledgement: rooms=20 players=200 samples={sorted.Length}; p50={sorted[sorted.Length / 2]:F2}ms p95={p95:F2}ms max={sorted[^1]:F2}ms; 500ms target met={p95 < 500}. HTTP, sockets, regional network and Azure SQL are not included.");
    }
}

public sealed class PracticeLoadFactAttribute : FactAttribute
{
    public PracticeLoadFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ERUDOZA_RUN_PVP_LOAD") != "1")
            Skip = "Opt-in load evidence: set ERUDOZA_RUN_PVP_LOAD=1 and filter Category=Load.";
    }
}

public sealed class PracticeRecoveryTests
{
    [Fact]
    public async Task Concurrent_final_snapshots_preserve_season_awards_for_overlapping_players()
    {
        using var fixture = await PracticeEngineFixture.Create(2, 1);
        var sharedOwner = fixture.Rooms[0].OwnerId;
        foreach (var room in fixture.Rooms)
        {
            room.OwnerId = sharedOwner;
            room.Members[0].UserId = sharedOwner;
            room.Phase = "Review";
            room.QuestionIndex = 9;
            room.Submissions = room.Questions.SelectMany(question => room.Members.Select(member => new PracticeSubmission
            {
                QuestionId = question.Id,
                Team = member.Team,
                ScribeId = member.UserId,
                Answers = ["Daniel"],
                AccuracyHundredths = 100,
                SpeedHundredths = 20,
                ElapsedTicks = TimeSpan.FromSeconds(5).Ticks
            })).ToList();
            await fixture.Write(room);
        }
        fixture.Time.Advance(TimeSpan.FromSeconds(10));
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var snapshots = fixture.Rooms.Select(room => Task.Run(async () =>
        {
            await start.Task;
            await fixture.Snapshot(room.Id, sharedOwner);
        })).ToArray();
        start.SetResult();
        await Task.WhenAll(snapshots);
        foreach (var room in fixture.Rooms) Assert.Equal("Completed", (await fixture.Read(room.Id)).Status);
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var awards = await db.Set<PracticeAwardRecord>().Where(a => a.SeasonId == fixture.Rooms[0].SeasonId).ToListAsync();
        var participants = fixture.Rooms.SelectMany(r => r.Members).Select(m => m.UserId).Distinct().ToArray();
        Assert.Equal(3, participants.Length);
        Assert.Equal(6, awards.Count);
        foreach (var player in participants)
        {
            Assert.Single(awards, a => a.UserId == player && a.Key == "first-fellowship");
            Assert.Single(awards, a => a.UserId == player && a.Key == "shared-scribe");
        }
    }

    [Fact]
    public async Task Stale_question_draft_cannot_overwrite_the_current_answer()
    {
        using var fixture = await PracticeEngineFixture.Create(1, 1);
        var room = fixture.Rooms[0];
        await fixture.Command(room.Id, room.OwnerId, "draft", answers: ["Daniel"], questionId: room.Questions[0].Id);
        await Assert.ThrowsAsync<DomainException>(() => fixture.Command(room.Id, room.OwnerId, "draft", answers: ["Wrong"], questionId: room.Questions[1].Id));
        Assert.Equal("Daniel", Assert.Single((await fixture.Read(room.Id)).Drafts[1]));
    }

    [Fact]
    public async Task Owner_cannot_abandon_a_completed_match()
    {
        using var fixture = await PracticeEngineFixture.Create(1, 1);
        var room = fixture.Rooms[0];
        room.Status = "Completed";
        room.CompletedAt = fixture.Time.GetUtcNow();
        await fixture.Write(room);
        await Assert.ThrowsAsync<DomainException>(() => fixture.Command(room.Id, room.OwnerId, "abandon"));
        Assert.Equal("Completed", (await fixture.Read(room.Id)).Status);
    }

    [Fact]
    public async Task Coach_cannot_advance_review_while_on_time_ingress_is_pending()
    {
        using var fixture = await PracticeEngineFixture.Create(1, 1);
        var room = fixture.Rooms[0];
        room.Coached = true;
        room.OwnerId = SeedIdentifiers.AdminUserId;
        room.CoachId = SeedIdentifiers.AdminUserId;
        room.Phase = "Review";
        await fixture.Write(room);
        fixture.Runtime.Activate(room.Id);
        using (fixture.Runtime.Admit(room.Id))
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var service = new PracticeService(scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(), fixture.Runtime, scope.ServiceProvider.GetRequiredService<IConfiguration>());
            await Assert.ThrowsAsync<DomainException>(() => service.Command(SeedIdentifiers.OrganizationId, room.Id,
                new PracticeActor(SeedIdentifiers.AdminUserId, SeedIdentifiers.OrganizationId, "Coach", true),
                new PracticeCommand(Guid.NewGuid(), 0, "next"), fixture.Runtime.Stamp(), default));
        }
        var unchanged = await fixture.Read(room.Id);
        Assert.Equal("Review", unchanged.Phase);
        Assert.Equal(0, unchanged.QuestionIndex);
    }

    [Theory]
    [InlineData(true, "Playing", "Paused")]
    [InlineData(false, "Abandoned", "Response")]
    public async Task Restart_voids_interrupted_question_and_requires_fresh_clock_or_abandons_without_reserve(bool reserve, string status, string phase)
    {
        using var fixture = await PracticeEngineFixture.Create(1, 1, reserve);
        var room = fixture.Rooms[0];
        await fixture.Command(room.Id, room.OwnerId, "submit", answers: ["Daniel"], questionId: room.Questions[0].Id);
        fixture.RestartRuntime();
        await fixture.Snapshot(room.Id, room.OwnerId);
        var recovered = await fixture.Read(room.Id);
        Assert.Equal(status, recovered.Status);
        Assert.Equal(phase, recovered.Phase);
        Assert.Empty(recovered.Submissions);
        Assert.Empty(recovered.Contributions);
        Assert.Empty(recovered.Awards);
        Assert.Equal(fixture.Runtime.ProcessId, recovered.ProcessId);
        if (reserve)
        {
            Assert.NotEqual(room.Questions[0].Id, recovered.Questions[0].Id);
            Assert.Empty(recovered.Reserves);
            Assert.Empty(recovered.Acknowledged);
        }
    }

    [Fact]
    public async Task Deadline_locks_last_acknowledged_draft_without_bonus_and_rejects_later_improvement()
    {
        using var fixture = await PracticeEngineFixture.Create(1, 1);
        var room = fixture.Rooms[0];
        await fixture.Command(room.Id, room.OwnerId, "draft", answers: ["Daniel"], questionId: room.Questions[0].Id);
        fixture.Time.Advance(TimeSpan.FromSeconds(20));
        await fixture.Snapshot(room.Id, room.OwnerId);
        var deadline = await fixture.Read(room.Id);
        Assert.Equal("Review", deadline.Phase);
        var correct = Assert.Single(deadline.Submissions, s => s.Team == 1);
        Assert.True(correct.DeadlineDraft);
        Assert.Equal(100, correct.AccuracyHundredths);
        Assert.Equal(0, correct.SpeedHundredths);
        var unanswered = Assert.Single(deadline.Submissions, s => s.Team == 2);
        Assert.Equal(0, unanswered.AccuracyHundredths);
        fixture.Time.Advance(TimeSpan.FromTicks(1));
        await fixture.Command(room.Id, room.Members.Single(m => m.Team == 2).UserId, "submit", answers: ["Daniel"], questionId: room.Questions[0].Id);
        var after = await fixture.Read(room.Id);
        Assert.Equal(0, Assert.Single(after.Submissions, s => s.Team == 2).AccuracyHundredths);
        Assert.Equal(2, after.Submissions.Count);
    }

    [Fact]
    public async Task Pending_on_time_ingress_prevents_deadline_review_until_queue_is_drained()
    {
        using var fixture = await PracticeEngineFixture.Create(1, 1);
        var room = fixture.Rooms[0];
        fixture.Runtime.Activate(room.Id);
        var ingress = fixture.Runtime.Stamp();
        using (fixture.Runtime.Admit(room.Id))
        {
            fixture.Time.Advance(TimeSpan.FromSeconds(30));
            await fixture.Snapshot(room.Id, room.OwnerId);
            Assert.Equal("Response", (await fixture.Read(room.Id)).Phase);
            await fixture.Command(room.Id, room.OwnerId, "submit", answers: ["Daniel"], questionId: room.Questions[0].Id, ingress: ingress);
            var onTime = Assert.Single((await fixture.Read(room.Id)).Submissions);
            Assert.Equal(20, onTime.SpeedHundredths);
            Assert.False(onTime.DeadlineDraft);
        }
        await fixture.Snapshot(room.Id, room.OwnerId);
        var reviewed = await fixture.Read(room.Id);
        Assert.Equal("Review", reviewed.Phase);
        Assert.Equal(2, reviewed.Submissions.Count);
    }
}

internal sealed class PracticeEngineFixture : IDisposable
{
    public ErudozaApiFactory Factory { get; } = new() { DisablePracticeTicker = true };
    public PracticeEngineTime Time { get; } = new();
    public PracticeRuntime Runtime { get; private set; }
    public List<PracticeRoom> Rooms { get; } = [];
    private static readonly Guid Org = SeedIdentifiers.OrganizationId;
    private PracticeEngineFixture() => Runtime = new(Time);

    public static async Task<PracticeEngineFixture> Create(int rooms, int teamSize, bool reserve = true)
    {
        var fixture = new PracticeEngineFixture();
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = Org, Name = "Engine test", YearLabel = "2026", RuleProfileId = SeedIdentifiers.RuleProfileId, Status = SeasonStatus.Active };
        db.Seasons.Add(season);
        db.Add(new PracticeSetting { OrganizationId = Org, Enabled = true });
        for (var index = 0; index < rooms; index++)
        {
            var room = new PracticeRoom
            {
                SeasonId = season.Id,
                TeamSize = teamSize,
                QuestionCount = 10,
                Status = "Playing",
                Phase = "Response",
                ProcessId = fixture.Runtime.ProcessId,
                ResponseTimestamp = 0,
                PhaseTimestamp = 0,
                ResponseStartsAt = fixture.Time.GetUtcNow().AddSeconds(-5),
                PhaseEndsAt = fixture.Time.GetUtcNow().AddSeconds(20),
                Questions = Enumerable.Range(0, 10).Select(_ => Question()).ToList(),
                Reserves = reserve ? [Question()] : []
            };
            for (var player = 0; player < teamSize * 2; player++)
            {
                var id = Guid.NewGuid();
                db.Users.Add(new ApplicationUser { Id = id, UserName = $"load{id:N}", DisplayName = "Practice player", Kind = UserKind.Student, PasswordHash = "unused-service-fixture" });
                db.OrganizationMembers.Add(new OrganizationMember { Id = Guid.NewGuid(), OrganizationId = Org, UserId = id, Role = OrganizationRole.Student });
                room.Members.Add(new PracticeMember { UserId = id, DisplayName = "Practice player", Team = player < teamSize ? 1 : 2, Captain = player % teamSize == 0, Scribe = player % teamSize == 0, Ready = true });
            }
            room.OwnerId = room.Members[0].UserId;
            room.Acknowledged = room.Members.Where(m => m.Scribe).Select(m => m.UserId).ToList();
            db.Add(new PracticeRoomRecord { Id = room.Id, OrganizationId = Org, SeasonId = season.Id, Status = room.Status, StateJson = PracticeJson.Write(room) });
            fixture.Rooms.Add(room);
        }
        await db.SaveChangesAsync();
        return fixture;
    }

    public async Task Command(Guid room, Guid actor, string action, string? text = null, string[]? answers = null, Guid? questionId = null, long? ingress = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var service = new PracticeService(db, Runtime, scope.ServiceProvider.GetRequiredService<IConfiguration>());
        await service.Command(Org, room, new(actor, Org, "Practice player", false), new(Guid.NewGuid(), 0, action, Text: text, Answers: answers, QuestionId: questionId), ingress ?? Runtime.Stamp(), default);
    }
    public async Task Snapshot(Guid room, Guid actor)
    {
        using var scope = Factory.Services.CreateScope();
        var service = new PracticeService(scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(), Runtime, scope.ServiceProvider.GetRequiredService<IConfiguration>());
        await service.Snapshot(Org, room, new(actor, Org, "Practice player", false), default);
    }
    public async Task<PracticeRoom> Read(Guid room)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        return PracticeJson.Read<PracticeRoom>((await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == room)).StateJson);
    }
    public async Task Write(PracticeRoom room)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var record = await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == room.Id);
        record.StateJson = PracticeJson.Write(room);
        record.Status = room.Status;
        await db.SaveChangesAsync();
    }
    public void RestartRuntime() => Runtime = new(Time);
    public void Dispose() => Factory.Dispose();
    private static PracticeQuestion Question() => new()
    {
        Id = Guid.NewGuid(),
        ContentPackId = SeedIdentifiers.ContentPackId,
        SourceUnitId = Guid.Parse("77777777-7777-7777-7777-777777777708"),
        Prompt = "Who purposed in his heart?",
        Reference = "Daniel 1:8",
        Evidence = "Daniel purposed in his heart",
        Parts = [new AnswerPart { AcceptedAnswers = ["Daniel"] }]
    };
}

internal sealed class PracticeEngineTime : TimeProvider
{
    private long timestamp = TimeSpan.FromSeconds(5).Ticks;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() => Interlocked.Read(ref timestamp);
    public override DateTimeOffset GetUtcNow() => new DateTimeOffset(2026, 9, 10, 0, 0, 0, TimeSpan.Zero).AddTicks(GetTimestamp());
    public void Advance(TimeSpan duration) => Interlocked.Add(ref timestamp, duration.Ticks);
}
