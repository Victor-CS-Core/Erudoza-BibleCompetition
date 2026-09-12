using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class StudyIntegrityTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Memory_purpose_is_admitted_frozen_and_used_by_real_grading()
    {
        var (student, seasonId) = await Setup(endVerse: 1);
        const string endpoint = "/api/v1/study/sessions";
        (await student.PostAsJsonAsync(endpoint, new { seasonId, memoryChallenge = "unsupported" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await student.PostAsJsonAsync(endpoint, new { seasonId, memoryChallenge = "Warmup" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var legacyRequest = new { seasonId, training = new { clientStartId = "historic-start", timeZone = "UTC" } };
        var legacy = await (await student.PostAsJsonAsync(endpoint, legacyRequest)).Content.ReadFromJsonAsync<SessionDto>();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            (await db.StudySessions.SingleAsync(s => s.Id == legacy!.Id)).RuleProfileSnapshotJson = "";
            await db.SaveChangesAsync();
        }
        (await student.PostAsJsonAsync(endpoint, legacyRequest)).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            (await db.Seasons.SingleAsync(s => s.Id == seasonId)).PbeEnabled = true;
            await db.SaveChangesAsync();
        }
        (await student.PostAsJsonAsync(endpoint, new { seasonId, memoryChallenge = "Advanced" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            (await db.CompetitionMembers.SingleAsync(s => s.SeasonId == seasonId && s.UserId == SeedIdentifiers.StudentUserId)).Difficulty = TrainingDifficulty.Advanced;
            await db.SaveChangesAsync();
        }
        var started = await (await student.PostAsJsonAsync(endpoint, new { seasonId, format = "Memory" })).Content.ReadFromJsonAsync<JsonElement>();
        started.GetProperty("memoryChallenge").GetString().Should().Be("Warmup");
        var sessionId = started.GetProperty("id").GetGuid();
        for (var i = 0; i < 6; i++)
        {
            var fresh = i == 0 ? sessionId : (await (await student.PostAsJsonAsync(endpoint, new { seasonId, format = "Memory" })).Content.ReadFromJsonAsync<SessionDto>())!.Id;
            var card = await Card(student, fresh);
            var dto = await student.GetFromJsonAsync<JsonElement>($"{endpoint}/{fresh}/next");
            dto.GetProperty("evidenceProfile").GetString().Should().Be("memory-cued-v3");
            var accepted = await (await student.PostAsJsonAsync($"{endpoint}/{fresh}/attempts", Payload(card, $"cued-{i}"))).Content.ReadFromJsonAsync<AttemptResultDto>();
            accepted!.IsCorrect.Should().BeTrue(); accepted.ExactWordingScore.Should().BeLessThanOrEqualTo(70);
        }
        var advanced = await (await student.PostAsJsonAsync(endpoint, new { seasonId, format = "Memory", memoryChallenge = "Advanced" })).Content.ReadFromJsonAsync<JsonElement>();
        advanced.GetProperty("evidenceProfile").GetString().Should().Be("memory-honor-v2");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            (await db.Seasons.SingleAsync(s => s.Id == seasonId)).PbeEnabled = false;
            await db.SaveChangesAsync();
        }
        var next = await student.GetFromJsonAsync<JsonElement>($"{endpoint}/{sessionId}/next");
        next.GetProperty("generatorVersion").GetString().Should().Be("memory-v3");
        var historic = await student.GetFromJsonAsync<JsonElement>($"{endpoint}/{legacy!.Id}/next");
        historic.GetProperty("generatorVersion").ValueKind.Should().Be(JsonValueKind.Null);
        var resumed = await student.GetFromJsonAsync<JsonElement>($"{endpoint}/{sessionId}");
        resumed.GetProperty("session").GetProperty("memoryChallenge").GetString().Should().Be("Warmup");
    }

    [Fact]
    public async Task Historic_short_answer_card_can_resume_and_score_without_a_generation_service()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var card = await Card(student, session!.Id);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var stored = await db.ChallengeCards.SingleAsync(item => item.Id == card.Id);
            stored.ActivityType = "ShortAnswer";
            stored.ProviderType = "HistoricShortAnswerProvider";
            stored.AnswerMode = AnswerMode.ShortFact;
            await db.SaveChangesAsync();
        }
        var resumed = await student.GetFromJsonAsync<ResumeSessionDto>($"/api/v1/study/sessions/{session.Id}");
        resumed!.Card!.ActivityType.Should().Be("ShortAnswer");
        var response = await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, "historic-short-answer"));
        response.EnsureSuccessStatusCode();
        var accepted = await response.Content.ReadFromJsonAsync<AttemptResultDto>();
        accepted!.IsCorrect.Should().BeTrue();
        accepted.ExactWordingScore.Should().Be(0);
        var next = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session.Id}/next");
        next!.ActivityType.Should().NotBe("ShortAnswer");
    }

    [Fact]
    public async Task Resume_restores_accepted_answer_and_summary_and_rejects_other_owners()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var card = await Card(student, session!.Id);
        var accepted = await (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, "resume"))).Content.ReadFromJsonAsync<AttemptResultDto>();
        var resumed = await student.GetFromJsonAsync<ResumeSessionDto>($"/api/v1/study/sessions/{session.Id}");
        resumed!.Card!.Id.Should().Be(card.Id);
        resumed.Attempt.Should().Be(accepted! with { AlreadyProcessed = true });
        resumed.Summary.Should().BeNull();
        var completed = await (await student.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null)).Content.ReadFromJsonAsync<SessionSummaryDto>();
        resumed = await student.GetFromJsonAsync<ResumeSessionDto>($"/api/v1/study/sessions/{session.Id}");
        resumed!.Summary.Should().BeEquivalentTo(completed);
        using var scope = factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<StudySessionService>();
        var wrongStudent = () => service.ResumeAsync(SeedIdentifiers.OrganizationId, Guid.NewGuid(), session.Id, false, CancellationToken.None);
        await wrongStudent.Should().ThrowAsync<DomainException>();
        var wrongOrganization = () => service.ResumeAsync(Guid.NewGuid(), SeedIdentifiers.StudentUserId, session.Id, false, CancellationToken.None);
        await wrongOrganization.Should().ThrowAsync<DomainException>();
    }

    [Fact]
    public async Task Concurrent_next_requests_return_one_persisted_card()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var cards = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Card(student, session!.Id)));
        cards.Select(card => card.Id).Distinct().Should().ContainSingle();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        (await db.ChallengeCards.CountAsync(card => card.SessionId == session!.Id)).Should().Be(1);
    }

    [Fact]
    public async Task Concurrent_sessions_preserve_all_updates_to_the_same_mastery_state()
    {
        var (student, seasonId) = await Setup(endVerse: 1);
        var sessions = new List<(Guid SessionId, (Guid Id, string Answer) Card)>();
        for (var i = 0; i < 4; i++)
        {
            var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
            sessions.Add((session!.Id, await Card(student, session.Id)));
        }
        var responses = await Task.WhenAll(sessions.Select(s => student.PostAsJsonAsync($"/api/v1/study/sessions/{s.SessionId}/attempts", Payload(s.Card, "parallel-session"))));
        foreach (var response in responses) response.EnsureSuccessStatusCode();
        var results = await Task.WhenAll(responses.Select(r => r.Content.ReadFromJsonAsync<AttemptResultDto>()));
        results.Select(r => r!.ExactWordingScore).Order().Should().Equal(18, 36, 54, 70);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        (await db.MasteryStates.SingleAsync(s => s.SeasonId == seasonId)).ExactWordingScore.Should().Be(70);
        (await db.Attempts.CountAsync(a => a.SeasonId == seasonId)).Should().Be(4);
        (await db.ReviewSchedules.CountAsync(r => r.SeasonId == seasonId)).Should().Be(1);
    }

    [Fact]
    public async Task Concurrent_answers_and_replays_award_once_and_completion_freezes_session()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var card = await Card(student, session!.Id);
        var url = $"/api/v1/study/sessions/{session.Id}/attempts";
        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(i => student.PostAsJsonAsync(url, Payload(card, $"parallel-{i}"))));
        foreach (var response in responses) response.EnsureSuccessStatusCode();
        var results = await Task.WhenAll(responses.Select(r => r.Content.ReadFromJsonAsync<AttemptResultDto>()));
        results.Select(r => r!.AttemptId).Distinct().Should().ContainSingle();
        results.Count(r => !r!.AlreadyProcessed).Should().Be(1);
        results.Select(r => r!.ExactWordingScore).Distinct().Should().Equal(18);
        var winner = Array.FindIndex(results, r => !r!.AlreadyProcessed);
        (await student.PostAsJsonAsync(url, new { clientSubmissionId = $"parallel-{winner}", challengeCardId = card.Id, submittedAnswer = "changed", responseTimeMs = 100, hintsUsed = false })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var next = await Card(student, session.Id);
        (await student.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null)).EnsureSuccessStatusCode();
        (await student.PostAsJsonAsync(url, Payload(next, "after-complete"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var replay = await (await student.PostAsJsonAsync(url, Payload(card, "new-retry-key"))).Content.ReadFromJsonAsync<AttemptResultDto>();
        replay!.AttemptId.Should().Be(results[0]!.AttemptId);
        replay.AlreadyProcessed.Should().BeTrue();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        (await db.Attempts.CountAsync(a => a.SessionId == session.Id)).Should().Be(1);
        (await db.StudySessions.SingleAsync(s => s.Id == session.Id)).Status.Should().Be(StudySessionStatus.Completed);
    }

    [Fact]
    public async Task Legacy_scaffold_mastery_is_rebuilt_from_evidence_on_next_answer()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var card = await Card(student, session!.Id);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var entity = await db.ChallengeCards.SingleAsync(c => c.Id == card.Id);
            db.MasteryStates.Add(new MasteryState
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                SeasonId = seasonId,
                StudentUserId = SeedIdentifiers.StudentUserId,
                KnowledgeUnitId = entity.KnowledgeUnitId,
                ExactWordingScore = 99,
                RecognitionScore = 99,
                Level = MasteryLevel.Mastered,
                AlgorithmVersion = "v1-scaffold"
            });
            await db.SaveChangesAsync(CancellationToken.None);
        }
        var before = await student.GetFromJsonAsync<ProgressDto>($"/api/v1/progress/me?seasonId={seasonId}");
        before!.MasteredCount.Should().Be(0);
        var result = await (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", Payload(card, "new-policy"))).Content.ReadFromJsonAsync<AttemptResultDto>();
        result!.ExactWordingScore.Should().Be(18);
        using var verification = factory.Services.CreateScope();
        var updated = await verification.ServiceProvider.GetRequiredService<IErudozaDbContext>().MasteryStates.SingleAsync(s => s.SeasonId == seasonId);
        updated.AlgorithmVersion.Should().Be(ScaffoldMasteryRules.AlgorithmVersion);
    }

    [Fact]
    public async Task Saved_result_does_not_change_when_later_mastery_changes()
    {
        var (student, seasonId) = await Setup();
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" })).Content.ReadFromJsonAsync<SessionDto>();
        var card = await Card(student, session!.Id);
        var url = $"/api/v1/study/sessions/{session.Id}/attempts";
        var first = await (await student.PostAsJsonAsync(url, Payload(card, "saved"))).Content.ReadFromJsonAsync<AttemptResultDto>();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var state = await db.MasteryStates.SingleAsync(s => s.SeasonId == seasonId);
            state.ExactWordingScore = 99;
            await db.SaveChangesAsync(CancellationToken.None);
        }
        var replay = await (await student.PostAsJsonAsync(url, Payload(card, "saved"))).Content.ReadFromJsonAsync<AttemptResultDto>();
        replay!.Should().Be(first! with { AlreadyProcessed = true });
    }

    [Fact]
    public async Task Removed_and_retired_content_does_not_count_as_due_review()
    {
        var (student, seasonId) = await Setup();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var unit = await db.SourceUnits.SingleAsync(s => s.ContentPackId == SeedIdentifiers.ContentPackId && s.Verse == 1);
            var knowledge = await db.KnowledgeUnits.SingleAsync(k => k.SourceUnitId == unit.Id && k.Kind == KnowledgeUnitKind.ExactVerseText);
            db.ReviewSchedules.Add(new ReviewSchedule
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                SeasonId = seasonId,
                StudentUserId = SeedIdentifiers.StudentUserId,
                KnowledgeUnitId = knowledge.Id,
                DueAtUtc = DateTimeOffset.UtcNow.AddDays(-1)
            });
            unit.IsRetired = true;
            await db.SaveChangesAsync(CancellationToken.None);
            var resolved = await scope.ServiceProvider.GetRequiredService<IStudentStudyScopeService>().GetAsync(SeedIdentifiers.StudentUserId, seasonId, CancellationToken.None);
            resolved.EligibleSourceUnitIds.Should().NotContain(unit.Id);
        }
        var progress = await student.GetFromJsonAsync<ProgressDto>($"/api/v1/progress/me?seasonId={seasonId}");
        progress!.ReviewDueCount.Should().Be(0);
        (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Review" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        // Restore shared fixture content for other tests.
        using var cleanup = factory.Services.CreateScope();
        var cleanDb = cleanup.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        foreach (var unit in await cleanDb.SourceUnits.Where(s => s.ContentPackId == SeedIdentifiers.ContentPackId).ToListAsync()) unit.IsRetired = false;
        await cleanDb.SaveChangesAsync(CancellationToken.None);
    }

    [Theory]
    [InlineData(1, 40, MasteryLevel.Review)]
    [InlineData(3, 70, MasteryLevel.Strong)]
    [InlineData(5, 100, MasteryLevel.Mastered)]
    public void Exact_mastery_requires_advanced_evidence(int difficulty, int expected, MasteryLevel level)
    {
        var scores = new MasteryScores(0, 0, 0, 0, 0, MasteryLevel.Unseen);
        for (var i = 0; i < 20; i++) scores = ScaffoldMasteryRules.Apply(scores, true, false, "MissingWords", AnswerMode.ExactText, difficulty);
        scores.ExactWording.Should().Be(expected);
        scores.Level.Should().Be(level);
    }

    [Fact]
    public void Correct_easier_answers_preserve_advanced_credit_and_hints_award_no_exact_credit()
    {
        var advanced = new MasteryScores(90, 90, 0, 0, 0, MasteryLevel.Mastered);
        ScaffoldMasteryRules.Apply(advanced, true, false, "MissingWords", AnswerMode.ExactText, 1).ExactWording.Should().Be(90);
        var learning = new MasteryScores(10, 18, 0, 0, 0, MasteryLevel.Review);
        ScaffoldMasteryRules.Apply(learning, true, true, "MissingWords", AnswerMode.ExactText, 5).ExactWording.Should().Be(18);
    }

    [Theory]
    [InlineData("TrueFalse", AnswerMode.SelectedChoice)]
    [InlineData("ReferenceMatch", AnswerMode.SelectedChoice)]
    [InlineData("VerseBuilder", AnswerMode.OrderedSequence)]
    [InlineData("WhatComesNext", AnswerMode.ExactText)]
    [InlineData("ShortAnswer", AnswerMode.ShortFact)]
    public void Recognition_and_other_skills_cannot_manufacture_exact_mastery(string activity, AnswerMode mode)
    {
        var scores = new MasteryScores(0, 0, 0, 0, 0, MasteryLevel.Unseen);
        for (var i = 0; i < 20; i++) scores = ScaffoldMasteryRules.Apply(scores, true, false, activity, mode);
        scores.ExactWording.Should().Be(0);
        scores.Level.Should().NotBe(MasteryLevel.Mastered);
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
