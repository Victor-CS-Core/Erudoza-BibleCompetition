using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class TrainingProgressionTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Read_preview_does_not_create_records_and_start_replays_one_intent()
    {
        var (student, seasonId) = await Setup();
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        var before = await db.TrainingPreferences.CountAsync(); var missions = await db.DailyMissions.CountAsync();
        var today = await student.GetFromJsonAsync<TrainingTodayDto>($"/api/v1/progress/me/today?seasonId={seasonId}");
        today!.Mission.Status.Should().Be("Suggested"); (await db.TrainingPreferences.CountAsync()).Should().Be(before); (await db.DailyMissions.CountAsync()).Should().Be(missions);
        var input = new { seasonId, mode = "Practice", training = new { clientStartId = Guid.NewGuid().ToString(), timeZone = "America/New_York", step = "Practice" } };
        var starts = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => student.PostAsJsonAsync("/api/v1/study/sessions", input)));
        foreach (var r in starts) r.EnsureSuccessStatusCode(); var sessions = await Task.WhenAll(starts.Select(r => r.Content.ReadFromJsonAsync<SessionDto>())); sessions.Select(s => s!.Id).Distinct().Should().ContainSingle();
        (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Simulation", input.training })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await student.GetAsync($"/api/v1/study/sessions/{sessions[0]!.Id}/recap")).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }
    [Fact]
    public async Task Partial_full_and_duplicate_attempts_credit_only_one_day_and_freeze_recap()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice", training = new { clientStartId = Guid.NewGuid().ToString(), step = "Practice" } })).Content.ReadFromJsonAsync<SessionDto>();
        for (var i = 0; i < 8; i++)
        {
            var card = await Card(student, session!.Id); var response = await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, $"card-{i}")); response.EnsureSuccessStatusCode();
            if (i == 0) { var today = await student.GetFromJsonAsync<TrainingTodayDto>($"/api/v1/progress/me/today?seasonId={seasonId}"); today!.Mission.Steps.Single(x => x.Kind == "Practice").Completed.Should().Be(1); }
            (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, $"replay-{i}"))).EnsureSuccessStatusCode();
        }
        var completed = await student.PostAsync($"/api/v1/study/sessions/{session!.Id}/complete", null); completed.EnsureSuccessStatusCode(); var summary = await completed.Content.ReadFromJsonAsync<SessionSummaryDto>();
        summary!.Status.Should().Be("Completed"); summary.Recap!.FullTargetReached.Should().BeTrue(); summary.Recap.PassageChanges.Should().NotBeEmpty();
        var frozen = await student.GetStringAsync($"/api/v1/study/sessions/{session.Id}/recap");
        var another = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var next = await Card(student, another!.Id); (await student.PostAsJsonAsync($"/api/v1/study/sessions/{another.Id}/attempts", Payload(next, "later"))).EnsureSuccessStatusCode();
        var partial = await (await student.PostAsync($"/api/v1/study/sessions/{another.Id}/complete", null)).Content.ReadFromJsonAsync<SessionSummaryDto>(); partial!.Recap!.FullTargetReached.Should().BeFalse(); partial.Recap.NewlyCreditedDay.Should().BeFalse();
        (await student.GetStringAsync($"/api/v1/study/sessions/{session.Id}/recap")).Should().Be(frozen);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>(); (await db.TrainingDays.Where(x => x.SessionId == session.Id).CountAsync()).Should().BeLessThanOrEqualTo(1);
    }
    [Fact]
    public async Task Preferences_validate_and_defer_changes()
    {
        var (student, _) = await Setup();
        (await student.PutAsJsonAsync("/api/v1/progress/me/preferences", new { weeklyTarget = 2, timeZone = "UTC" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await student.PutAsJsonAsync("/api/v1/progress/me/preferences", new { weeklyTarget = 5, timeZone = "Invalid/Nowhere" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await student.PutAsJsonAsync("/api/v1/progress/me/preferences", new { weeklyTarget = 3, timeZone = "UTC" })).EnsureSuccessStatusCode();
        var result = await (await student.PutAsJsonAsync("/api/v1/progress/me/preferences", new { weeklyTarget = 4, timeZone = "America/New_York" })).Content.ReadFromJsonAsync<TrainingPreferencesDto>(); result!.Pending.Should().NotBeNull(); result.Pending!.WeeklyTarget.Should().Be(4);
    }
    [Fact]
    public async Task Concurrent_sessions_credit_one_day_and_recap_does_not_attribute_interleaved_skills()
    {
        var (student, seasonId) = await Setup(1); var sessions = new List<SessionDto>();
        for (var n = 0; n < 2; n++) { var response = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" }); response.EnsureSuccessStatusCode(); sessions.Add((await response.Content.ReadFromJsonAsync<SessionDto>())!); }
        for (var i = 0; i < 8; i++)
        {
            var cards = await Task.WhenAll(sessions.Select(x => Card(student, x.Id)));
            var results = await Task.WhenAll(sessions.Select((x, n) => student.PostAsJsonAsync($"/api/v1/study/sessions/{x.Id}/attempts", Payload(cards[n], $"{n}-{i}")))); foreach (var result in results) result.EnsureSuccessStatusCode();
        }
        var summaries = await Task.WhenAll(sessions.Select(async s => await (await student.PostAsync($"/api/v1/study/sessions/{s.Id}/complete", null)).Content.ReadFromJsonAsync<SessionSummaryDto>()));
        summaries.Count(s => s!.Recap!.NewlyCreditedDay).Should().BeLessThanOrEqualTo(1); summaries[0]!.Recap!.PassageChanges.Single().Before.Should().BeNull(); summaries[0]!.Recap!.PassageChanges.Single().Events.Should().HaveCount(8);
    }
    [Fact]
    public async Task Assignment_change_after_draw_invalidates_without_accepting_the_last_card()
    {
        var (student, seasonId) = await Setup(); var response = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice", training = new { clientStartId = Guid.NewGuid().ToString(), step = "Practice" } }); response.EnsureSuccessStatusCode(); var session = (await response.Content.ReadFromJsonAsync<SessionDto>())!;
        var card = await Card(student, session.Id);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>(); var assignment = await db.Assignments.Include(x => x.Scopes).SingleAsync(x => x.SeasonId == seasonId); assignment.Scopes.Single().EndVerse = 3; await db.SaveChangesAsync(); }
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, "stale"))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        using var verify = factory.Services.CreateScope(); var context = verify.ServiceProvider.GetRequiredService<IErudozaDbContext>(); (await context.Attempts.CountAsync(x => x.SessionId == session.Id)).Should().Be(0); (await context.DailyMissions.SingleAsync(x => x.SeasonId == seasonId)).Invalidated.Should().BeTrue();
    }
    [Fact]
    public async Task Frozen_review_keeps_passage_when_another_session_moves_its_due_date()
    {
        var (student, seasonId) = await Setup(2);
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>(); var ids = await db.KnowledgeUnits.Where(x => x.ContentPackId == SeedIdentifiers.ContentPackId && x.SourceUnit!.Verse <= 2 && x.Kind == KnowledgeUnitKind.ExactVerseText).Select(x => x.Id).ToListAsync(); foreach (var id in ids) db.ReviewSchedules.Add(new() { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, StudentUserId = SeedIdentifiers.StudentUserId, SeasonId = seasonId, KnowledgeUnitId = id, DueAtUtc = DateTimeOffset.UtcNow.AddDays(-1) }); await db.SaveChangesAsync(); }
        var r = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Review", training = new { clientStartId = Guid.NewGuid().ToString(), step = "Review" } }); r.EnsureSuccessStatusCode(); var session = (await r.Content.ReadFromJsonAsync<SessionDto>())!;
        var first = await Card(student, session.Id); (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new { clientSubmissionId = "wrong", challengeCardId = first.Id, submittedAnswer = "wrong", responseTimeMs = 100, hintsUsed = false })).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>(); foreach (var review in await db.ReviewSchedules.Where(x => x.SeasonId == seasonId).ToListAsync()) review.DueAtUtc = DateTimeOffset.UtcNow.AddDays(20); await db.SaveChangesAsync(); }
        var next = await Card(student, session.Id); (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(next, "second"))).EnsureSuccessStatusCode(); var summary = await (await student.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null)).Content.ReadFromJsonAsync<SessionSummaryDto>(); summary!.Recap!.MissionSteps.Single(x => x.Kind == "Review").Status.Should().Be("Complete"); summary.Correct.Should().Be(1);
    }
    [Theory]
    [InlineData(StudySessionStatus.Completed)]
    [InlineData(StudySessionStatus.Abandoned)]
    public async Task Review_fix_today_starts_new_drill_after_terminal_partial_session(StudySessionStatus status)
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice", training = new { clientStartId = Guid.NewGuid().ToString(), step = "Practice" } })).Content.ReadFromJsonAsync<SessionDto>();
        var card = await Card(student, session!.Id); (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, "partial"))).EnsureSuccessStatusCode();
        if (status == StudySessionStatus.Completed) (await student.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null)).EnsureSuccessStatusCode();
        else { using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>(); (await db.StudySessions.SingleAsync(x => x.Id == session.Id)).Status = status; await db.SaveChangesAsync(); }
        var today = await student.GetFromJsonAsync<TrainingTodayDto>($"/api/v1/progress/me/today?seasonId={seasonId}");
        today!.NextAction!.SessionId.Should().BeNull(); today.NextAction.Mode.Should().Be("Practice");
        today.Mission.Steps.Single(x => x.Kind == "Practice").Completed.Should().Be(1);
    }
    [Fact]
    public async Task Review_fix_oversized_scope_is_rejected_instead_of_truncated()
    {
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        var pack = new ContentPack { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, PackKey = Guid.NewGuid().ToString(), Version = 1 }; var doc = new SourceDocument { Id = Guid.NewGuid(), ContentPackId = pack.Id, Name = "Bounded scope fixture" }; db.ContentPacks.Add(pack); db.SourceDocuments.Add(doc);
        var sources = Enumerable.Range(0, 5001).Select(i => new SourceUnit { Id = Guid.NewGuid(), ContentPackId = pack.Id, SourceDocumentId = doc.Id, OrganizationId = SeedIdentifiers.OrganizationId, BookKey = "DAN", Chapter = i / 100 + 1, Verse = i % 100 + 1, Ordinal = i, CanonicalText = "Fixture", ContentHash = $"fixture-{i}" }).ToArray();
        db.SourceUnits.AddRange(sources); db.KnowledgeUnits.AddRange(sources.Select(x => new KnowledgeUnit { Id = Guid.NewGuid(), OrganizationId = x.OrganizationId, ContentPackId = pack.Id, SourceUnitId = x.Id })); await db.SaveChangesAsync();
        var service = new Erudoza.Application.Study.TrainingProgressService(db, new OversizedScope(sources.Select(x => x.Id).ToHashSet()), scope.ServiceProvider.GetRequiredService<IClock>());
        var before = await db.SoloBadgeAwards.CountAsync();
        var act = () => service.EligibleAsync(SeedIdentifiers.OrganizationId, SeedIdentifiers.StudentUserId, Guid.NewGuid(), CancellationToken.None);
        await act.Should().ThrowAsync<DomainException>().WithMessage("*5,000*"); (await db.SoloBadgeAwards.CountAsync()).Should().Be(before);
    }
    private sealed class OversizedScope(HashSet<Guid> ids) : IStudentStudyScopeService
    {
        public Task<StudentStudyScope> GetAsync(Guid studentId, Guid seasonId, CancellationToken ct) => Task.FromResult(new StudentStudyScope(studentId, seasonId, ids, new HashSet<Guid>(), new HashSet<Guid>()));
    }
    [Fact]
    public async Task Review_fix_chapter_award_freezes_only_winning_chapter()
    {
        var (student, seasonId) = await Setup(); var changed = new List<Guid>();
        try
        {
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
                var units = await db.KnowledgeUnits.Include(x => x.SourceUnit).Where(x => x.ContentPackId == SeedIdentifiers.ContentPackId && x.Kind == KnowledgeUnitKind.ExactVerseText).ToListAsync();
                foreach (var unit in units) { if (unit.SourceUnit!.Verse > 2) { unit.SourceUnit.Chapter = 2; changed.Add(unit.SourceUnit.Id); } else db.MasteryStates.Add(new() { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, StudentUserId = SeedIdentifiers.StudentUserId, SeasonId = seasonId, KnowledgeUnitId = unit.Id, AlgorithmVersion = "v2-skill-evidence", ExactWordingScore = 70, RecognitionScore = 70, Level = MasteryLevel.Strong }); }
                foreach (var entry in await db.ScopeEntries.Where(x => x.SeasonId == seasonId).ToListAsync()) entry.EndChapter = 2;
                var assignment = await db.Assignments.Include(x => x.Scopes).SingleAsync(x => x.SeasonId == seasonId); assignment.Scopes.Single().EndChapter = 2; await db.SaveChangesAsync();
            }
            var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>(); var card = await Card(student, session!.Id); (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, "award"))).EnsureSuccessStatusCode();
            using var verify = factory.Services.CreateScope(); var context = verify.ServiceProvider.GetRequiredService<IErudozaDbContext>(); var award = await context.SoloBadgeAwards.SingleAsync(x => x.SeasonId == seasonId && x.Key == "chapter-strong"); using var json = JsonDocument.Parse(award.EvidenceJson);
            json.RootElement.GetProperty("eligibleKnowledgeUnitIds").GetArrayLength().Should().Be(2); json.RootElement.GetProperty("badge").GetProperty("scopeLabel").GetString().Should().Be("Assigned scope · DAN 1 (2 passages)");
        }
        finally { using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>(); foreach (var source in await db.SourceUnits.Where(x => changed.Contains(x.Id)).ToListAsync()) source.Chapter = 1; await db.SaveChangesAsync(); }
    }
    private static object Payload((Guid Id, string Answer) card, string key) => new { clientSubmissionId = key, challengeCardId = card.Id, submittedAnswer = card.Answer, responseTimeMs = 100, hintsUsed = false };
    private static async Task<(Guid Id, string Answer)> Card(HttpClient student, Guid sessionId)
    {
        var response = await student.GetAsync($"/api/v1/study/sessions/{sessionId}/next");
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return (json.RootElement.GetProperty("id").GetGuid(), json.RootElement.GetProperty("debugAnswer").GetString()!);
    }
    private async Task<(HttpClient Student, Guid SeasonId)> Setup(int endVerse = 4)
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons", new { name = $"Integrity {Guid.NewGuid():N}", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = await created.Content.ReadFromJsonAsync<SeasonDto>();
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season!.Id}";
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse };
        (await admin.PostAsJsonAsync(root + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { range }, excludes = Array.Empty<object>() })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync(root + "/assignments", new { studentUserId = SeedIdentifiers.StudentUserId, type = "PrimarySpecialist", contentPackId = SeedIdentifiers.ContentPackId, range })).EnsureSuccessStatusCode();
        (await admin.PostAsync(root + "/activate", null)).EnsureSuccessStatusCode();
        return (await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234"), season.Id);
    }
}
