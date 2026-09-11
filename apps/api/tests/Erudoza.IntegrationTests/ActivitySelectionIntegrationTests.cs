using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Mapping;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class ActivitySelectionIntegrationTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Passage_cycles_are_fair_and_normal_reference_and_next_feedback_are_safe()
    {
        var (student, season) = await Setup();
        var session = await Start(student, season);
        var sourceIds = new List<Guid>();
        var sawReference = false;
        var sawNext = false;
        for (var index = 0; index < 8; index++)
        {
            var dto = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session.Id}/next");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var card = await db.ChallengeCards.SingleAsync(c => c.Id == dto!.Id);
            sourceIds.Add(card.SourceUnitId);
            var source = await db.SourceUnits.SingleAsync(s => s.Id == card.SourceUnitId);
            if (card.ActivityType == ReferenceMatchGenerator.ActivityType)
            {
                sawReference = true;
                // Explicit production-shaped mapping: normal payload with debug answer disabled.
                var normal = DtoMapper.ToChallengeCardDto(card, source, 8, exposeDebug: false);
                normal.Citation.Should().Be("Assigned passage");
                normal.DebugAnswer.Should().BeNull();
                normal.Prompt.Should().Be(source.CanonicalText);
                dto!.Citation.Should().Be("Assigned passage");
            }
            var result = await Answer(student, session.Id, card);
            result.IsCorrect.Should().BeTrue();
            if (card.ActivityType == WhatComesNextGenerator.ActivityType)
            {
                sawNext = true;
                card.AnswerSourceUnitId.Should().NotBeNull().And.NotBe(card.SourceUnitId);
                var answerSource = await db.SourceUnits.SingleAsync(s => s.Id == card.AnswerSourceUnitId);
                var knowledge = await db.KnowledgeUnits.SingleAsync(k => k.Id == card.KnowledgeUnitId);
                knowledge.SourceUnitId.Should().Be(answerSource.Id);
                result.Citation.Should().Be(answerSource.CitationLabel);
                result.SourceText.Should().Be(answerSource.CanonicalText);
                result.ExactWordingScore.Should().BeLessThan(80);
            }
        }
        sourceIds.Take(4).Distinct().Should().HaveCount(4);
        sourceIds.Skip(4).Distinct().Should().HaveCount(4);
        sawReference.Should().BeTrue();
        sawNext.Should().BeTrue();
    }

    [Fact]
    public async Task New_session_uses_a_less_exposed_passage()
    {
        var (student, season) = await Setup();
        var first = await Start(student, season);
        var firstDto = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{first.Id}/next");
        var second = await Start(student, season);
        var secondDto = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{second.Id}/next");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        var firstCard = await db.ChallengeCards.SingleAsync(c => c.Id == firstDto!.Id);
        var secondCard = await db.ChallengeCards.SingleAsync(c => c.Id == secondDto!.Id);
        secondCard.SourceUnitId.Should().NotBe(firstCard.SourceUnitId);
    }

    [Fact]
    public async Task Review_excludes_next_verse_format_so_each_due_target_is_answered()
    {
        var (student, season) = await Setup();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var units = await db.KnowledgeUnits.Where(k => k.Kind == KnowledgeUnitKind.ExactVerseText
                && k.SourceUnit!.ContentPackId == SeedIdentifiers.ContentPackId && k.SourceUnit.Verse <= 4).ToListAsync();
            foreach (var unit in units)
                db.ReviewSchedules.Add(new ReviewSchedule
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = SeedIdentifiers.OrganizationId,
                    StudentUserId = SeedIdentifiers.StudentUserId,
                    SeasonId = season,
                    KnowledgeUnitId = unit.Id,
                    DueAtUtc = DateTimeOffset.UtcNow.AddDays(-1)
                });
            await db.SaveChangesAsync(default);
        }
        var session = await Start(student, season, "Review");
        session.TargetCardCount.Should().Be(4);
        var targets = new List<Guid>();
        for (var i = 0; i < 4; i++)
        {
            var dto = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session.Id}/next");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
            var card = await db.ChallengeCards.SingleAsync(c => c.Id == dto!.Id);
            card.ActivityType.Should().NotBe(WhatComesNextGenerator.ActivityType);
            targets.Add(card.KnowledgeUnitId);
            await Answer(student, session.Id, card);
        }
        targets.Distinct().Should().HaveCount(4);
    }

    [Fact]
    public async Task Coach_coverage_counts_only_eligible_current_mastery_and_nonduplicate_attempts()
    {
        var (student, season) = await Setup();
        var session = await Start(student, season);
        var dto = await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session.Id}/next");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        var card = await db.ChallengeCards.SingleAsync(c => c.Id == dto!.Id);
        var units = await db.KnowledgeUnits.Where(k => k.Kind == KnowledgeUnitKind.ExactVerseText
            && k.SourceUnit!.ContentPackId == SeedIdentifiers.ContentPackId)
            .OrderBy(k => k.SourceUnit!.Ordinal).Take(5).ToListAsync();
        for (var i = 0; i < units.Count; i++)
        {
            db.MasteryStates.Add(new MasteryState
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                StudentUserId = SeedIdentifiers.StudentUserId,
                SeasonId = season,
                KnowledgeUnitId = units[i].Id,
                Level = i == 0 ? MasteryLevel.Strong : i == 3 ? MasteryLevel.Learning : MasteryLevel.Mastered,
                AlgorithmVersion = i == 1 ? "v1-scaffold" : ScaffoldMasteryRules.AlgorithmVersion
            });
            db.ReviewSchedules.Add(new ReviewSchedule
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                StudentUserId = SeedIdentifiers.StudentUserId,
                SeasonId = season,
                KnowledgeUnitId = units[i].Id,
                DueAtUtc = DateTimeOffset.UtcNow.AddDays(-1)
            });
        }
        foreach (var duplicate in new[] { false, true })
            db.Attempts.Add(new Attempt
            {
                Id = Guid.NewGuid(),
                OrganizationId = SeedIdentifiers.OrganizationId,
                StudentUserId = SeedIdentifiers.StudentUserId,
                SeasonId = season,
                SessionId = session.Id,
                KnowledgeUnitId = card.KnowledgeUnitId,
                ChallengeCardId = card.Id,
                ClientSubmissionId = Guid.NewGuid().ToString(),
                IsLegacyDuplicate = duplicate
            });
        await db.SaveChangesAsync(default);
        var service = new SeasonCoverageService(db, scope.ServiceProvider.GetRequiredService<ICompetitionScopeResolver>());
        var coverage = await service.GetAsync(SeedIdentifiers.OrganizationId, season, default);
        var row = coverage.Students.Single(item => item.StudentUserId == SeedIdentifiers.StudentUserId);
        row.MasteredCount.Should().Be(1);
        row.EligibleUnitCount.Should().Be(4);
        row.ReviewDueCount.Should().Be(4);
        row.AttemptCount.Should().Be(1);
    }

    private static async Task<AttemptResultDto> Answer(HttpClient student, Guid session, ChallengeCard card)
    {
        var response = await student.PostAsJsonAsync($"/api/v1/study/sessions/{session}/attempts", new
        {
            clientSubmissionId = Guid.NewGuid().ToString(),
            challengeCardId = card.Id,
            submittedAnswer = ActivitySerialization.ReadAnswerKey(card.AnswerKeyJson).CanonicalAnswer,
            responseTimeMs = 100,
            hintsUsed = false
        });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AttemptResultDto>())!;
    }
    private static async Task<SessionDto> Start(HttpClient student, Guid seasonId, string mode = "Practice")
    {
        var response = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SessionDto>())!;
    }
    private async Task<(HttpClient, Guid)> Setup()
    {
        var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons";
        var created = await coach.PostAsJsonAsync(root, new { name = $"Selection {Guid.NewGuid():N}", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 4 };
        (await coach.PostAsJsonAsync($"{root}/{season.Id}/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { range } })).EnsureSuccessStatusCode();
        (await coach.PostAsJsonAsync($"{root}/{season.Id}/assignments", new
        {
            studentUserId = SeedIdentifiers.StudentUserId,
            type = "PrimarySpecialist",
            contentPackId = SeedIdentifiers.ContentPackId,
            range,
            difficulty = "Standard"
        })).EnsureSuccessStatusCode();
        (await coach.PostAsync($"{root}/{season.Id}/activate", null)).EnsureSuccessStatusCode();
        return (await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234"), season.Id);
    }
}
