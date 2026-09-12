using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Erudoza.Api.Practice;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;
namespace Erudoza.IntegrationTests;

public sealed class PbePracticeLoadTests(ITestOutputHelper output)
{
    [PracticeLoadFact]
    [Trait("Category", "Load")]
    public async Task Ten_Pbe_rooms_preserve_six_and_twelve_student_rosters_with_current_authorized_service_commands()
    {
        foreach (var teams in new[] { 1, 2 })
        {
            var time = new PracticeEngineTime(); using var fixture = await PracticeRoomHttpTests.Setup.Create(true, time); var runtime = fixture.Factory.Services.GetRequiredService<PracticeRuntime>();
            const int roomCount = 10, teamSize = 6; var roster = teams * teamSize; var users = Enumerable.Range(0, roomCount * roster).Select(_ => Guid.NewGuid()).ToArray();
            using (var scope = fixture.Factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); (await db.Seasons.SingleAsync(s => s.Id == fixture.SeasonId)).PbeEnabled = true;
                var source = await db.SourceUnits.Include(s => s.ContentPack).SingleAsync(s => s.Id == Guid.Parse("77777777-7777-7777-7777-777777777708"));
                foreach (var user in users)
                {
                    db.Users.Add(new() { Id = user, UserName = $"pbeload{user:N}", DisplayName = "Synthetic PBE load player", Kind = UserKind.Student, PasswordHash = "unused-service-fixture" });
                    db.OrganizationMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, UserId = user, Role = OrganizationRole.Student });
                    db.CompetitionMembers.Add(new() { OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, UserId = user, Difficulty = TrainingDifficulty.Advanced });
                    db.Assignments.Add(new() { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, StudentUserId = user, Type = AssignmentType.RequiredCoverage, Scopes = [new() { Id = Guid.NewGuid(), ContentPackId = source.ContentPackId, BookKey = "DAN", StartChapter = 1, EndChapter = 1, StartVerse = 1, EndVerse = 1 }] });
                }
                var target = new PbeTarget { Id = Guid.NewGuid(), SourceUnitIds = [source.Id], Skill = RecallSkill.FactualRecall, Label = "Person" };
                db.PbeTrainingRecords.Add(new() { Kind = "pbe-target", Id = target.Id.ToString(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, OwnerId = source.Id, DataJson = JsonSerializer.Serialize(target, PbeQuestionBank.Json) });
                for (var n = 0; n < 11; n++) { var q = new PbeQuestion { SchemaVersion = 2, Id = Guid.NewGuid(), Version = 1, ContentPackId = source.ContentPackId, SourceUnitId = source.Id, SourceUnitIds = [source.Id], SourceKind = PbeSourceKind.Scripture, Reference = source.CitationLabel, Evidence = source.CanonicalText, Kind = PbeQuestionKind.ShortAnswer, Prompt = "Name the person " + n, Parts = [new() { TargetId = target.Id, AcceptedAnswers = ["Daniel"], Points = 1 }] }; db.PbeTrainingRecords.Add(new() { Kind = "pbe-question-head", Id = q.Id.ToString(), OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = fixture.SeasonId, OwnerId = source.Id, DataJson = JsonSerializer.Serialize(new PbeBankQuestionData(q.Id.ToString(), fixture.SeasonId, true, q, PbeQuestionBank.SourceProof(q, new Dictionary<Guid, SourceUnit> { { source.Id, source } })), PbeQuestionBank.Json) }); }
                await db.SaveChangesAsync();
            }
            PracticeActor Actor(Guid user) => new(user, SeedIdentifiers.OrganizationId, "Synthetic PBE load player", false);
            async Task<JsonElement> Call(Func<PracticeService, Task<object>> action) { using var scope = fixture.Factory.Services.CreateScope(); var service = new PracticeService(scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(), runtime, scope.ServiceProvider.GetRequiredService<IConfiguration>()); return JsonSerializer.SerializeToElement(await action(service), PbeQuestionBank.Json); }
            async Task<PracticeRoom> Read(Guid id) { using var scope = fixture.Factory.Services.CreateScope(); return PracticeJson.Read<PracticeRoom>((await scope.ServiceProvider.GetRequiredService<ErudozaDbContext>().Set<PracticeRoomRecord>().AsNoTracking().SingleAsync(r => r.Id == id)).StateJson); }
            async Task<JsonElement> Command(Guid id, Guid user, string action, Guid? target = null, int? team = null, string[]? answers = null, string? text = null, Guid? question = null, long revision = 0, string? delivery = null) => await Call(service => service.Command(SeedIdentifiers.OrganizationId, id, Actor(user), new(Guid.NewGuid(), revision, action, TargetUserId: target, Team: team, Answers: answers, Text: text, QuestionId: question, Delivery: delivery), runtime.Stamp(), default));
            var rooms = new List<PracticeRoom>();
            for (var i = 0; i < roomCount; i++)
            {
                var members = users.Skip(i * roster).Take(roster).ToArray(); var created = await Call(service => service.Create(SeedIdentifiers.OrganizationId, Actor(members[0]), new(fixture.SeasonId, teamSize, 10, Format: "Pbe", TeamCount: teams), default)); var id = created.GetProperty("id").GetGuid();
                for (var n = 1; n < roster; n++) { var current = await Read(id); await Command(id, members[0], "invite", members[n], n / teamSize + 1, revision: current.Revision); var invite = (await Read(id)).Invitations.Single(x => x.UserId == members[n]); await Call(service => service.Accept(SeedIdentifiers.OrganizationId, invite.Id, n / teamSize + 1, Actor(members[n]), default)); }
                foreach (var member in members) await Command(id, member, "ready"); await Command(id, members[0], "start", revision: (await Read(id)).Revision); rooms.Add(await Read(id));
            }
            foreach (var room in rooms) foreach (var scribe in room.Members.Where(m => m.Scribe)) await Command(room.Id, scribe.UserId, "present", question: room.Questions[0].Id, delivery: scribe.Team == 1 ? "TextFallback" : "Audio", revision: (await Read(room.Id)).Revision); time.Advance(TimeSpan.FromSeconds(3));
            var samples = new ConcurrentBag<double>(); var barrier = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var chat = rooms.SelectMany(room => room.Members.Select(async member => { await barrier.Task; var timer = Stopwatch.StartNew(); await Command(room.Id, member.UserId, "chat", text: "Synthetic team discussion"); samples.Add(timer.Elapsed.TotalMilliseconds); })).ToArray(); barrier.SetResult(); await Task.WhenAll(chat);
            await Task.WhenAll(rooms.SelectMany(room => room.Members.Where(m => m.Scribe).Select(async member => { var timer = Stopwatch.StartNew(); await Command(room.Id, member.UserId, "submit", answers: ["Daniel"], question: room.Questions[0].Id); samples.Add(timer.Elapsed.TotalMilliseconds); })));
            foreach (var room in rooms) { var stored = await Read(room.Id); Assert.Equal(roster, stored.Members.Count); Assert.Equal(roster, stored.Messages.Count); Assert.Equal(teams, stored.Submissions.Count); Assert.All(stored.Submissions, final => { Assert.Equal(100, final.AccuracyHundredths); Assert.Equal(0, final.SpeedHundredths); Assert.NotEqual(Guid.Empty, final.AttemptId); Assert.NotNull(final.ResponseLockedAtUtc); }); Assert.Equal("Review", stored.Phase); }
            var sorted = samples.Order().ToArray(); var p95 = sorted[(int)Math.Ceiling(sorted.Length * .95) - 1]; var report = new { format = "Pbe", rooms = roomCount, teams, teamSize, players = users.Length, samples = sorted.Length, p50Ms = sorted[sorted.Length / 2], p95Ms = p95, maxMs = sorted[^1], targetP95Ms = 500, targetMet = p95 < 500, scope = "Local SQLite authorized service commands; excludes HTTP, sockets, regional network and SQL Server" };
            output.WriteLine(JsonSerializer.Serialize(report)); var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../..")); await File.WriteAllTextAsync(Path.Combine(root, ".local", $"c3-canonical-load-{teams}.json"), JsonSerializer.Serialize(report));
        }
    }
}
