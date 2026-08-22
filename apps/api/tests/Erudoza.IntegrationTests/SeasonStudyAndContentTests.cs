using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
using Erudoza.Application.Contracts;
using Erudoza.Application.Generation;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class SeasonStudyAndContentTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Activation_fails_without_scope_and_succeeds_with_valid_setup()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Empty Scope Season", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var season = await created.Content.ReadFromJsonAsync<SeasonDto>();
        season.Should().NotBeNull();

        var failed = await admin.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season!.Id}/activate",
            null);
        failed.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await DefineAndAssign(admin, season.Id, SeedIdentifiers.StudentUserId);
        var activated = await admin.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}/activate",
            null);
        activated.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Student_cannot_start_a_session_against_a_draft_season()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = "Draft Season", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        var season = await created.Content.ReadFromJsonAsync<SeasonDto>();

        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var response = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season!.Id, mode = "Practice" });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Duplicate_attempt_is_idempotent_and_mastery_changes()
    {
        var (admin, seasonId) = await ActivateFreshSeason();
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var sessionResponse = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" });
        sessionResponse.EnsureSuccessStatusCode();
        var session = await sessionResponse.Content.ReadFromJsonAsync<SessionDto>();

        var cardResponse = await student.GetAsync($"/api/v1/study/sessions/{session!.Id}/next");
        if (!cardResponse.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Next card failed ({(int)cardResponse.StatusCode}): {await cardResponse.Content.ReadAsStringAsync()}");
        }
        using var cardDoc = JsonDocument.Parse(await cardResponse.Content.ReadAsStringAsync());
        var cardId = cardDoc.RootElement.GetProperty("id").GetGuid();
        var debugAnswer = cardDoc.RootElement.GetProperty("debugAnswer").GetString();
        debugAnswer.Should().NotBeNullOrWhiteSpace();

        var payload = new
        {
            clientSubmissionId = "sub-1",
            challengeCardId = cardId,
            submittedAnswer = debugAnswer,
            responseTimeMs = 1200,
            hintsUsed = false
        };
        var first = await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", payload);
        first.EnsureSuccessStatusCode();
        var second = await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", payload);
        second.EnsureSuccessStatusCode();

        var firstResult = await first.Content.ReadFromJsonAsync<AttemptResultDto>();
        var secondResult = await second.Content.ReadFromJsonAsync<AttemptResultDto>();
        firstResult!.IsCorrect.Should().BeTrue();
        secondResult!.AlreadyProcessed.Should().BeTrue();
        secondResult.AttemptId.Should().Be(firstResult.AttemptId);
        firstResult.ExactWordingScore.Should().BeGreaterThan(0);
        firstResult.Citation.Should().Contain("Daniel");

        await student.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null);
        var progress = await student.GetFromJsonAsync<ProgressDto>("/api/v1/progress/me");
        progress!.AttemptCount.Should().BeGreaterThan(0);
        progress.Mastery.Should().NotBeEmpty();
        _ = admin;
    }

    [Fact]
    public async Task Wrong_word_remains_wrong_and_cross_session_card_is_rejected()
    {
        var (_, seasonId) = await ActivateFreshSeason("Cross Session");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var firstSession = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        var secondSession = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        using var cardDoc = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{firstSession!.Id}/next")).Content.ReadAsStringAsync());
        var cardId = cardDoc.RootElement.GetProperty("id").GetGuid();

        var wrong = await student.PostAsJsonAsync($"/api/v1/study/sessions/{firstSession.Id}/attempts", new
        {
            clientSubmissionId = "wrong-1",
            challengeCardId = cardId,
            submittedAnswer = "not the hidden phrase",
            responseTimeMs = 900,
            hintsUsed = false
        });
        var wrongResult = await wrong.Content.ReadFromJsonAsync<AttemptResultDto>();
        wrongResult!.IsCorrect.Should().BeFalse();

        var cross = await student.PostAsJsonAsync($"/api/v1/study/sessions/{secondSession!.Id}/attempts", new
        {
            clientSubmissionId = "cross-1",
            challengeCardId = cardId,
            submittedAnswer = "anything",
            responseTimeMs = 400,
            hintsUsed = false
        });
        cross.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Import_hash_locators_and_scope_exclusions_are_deterministic()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IErudozaDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<ContentImportService>();
        var request = new ImportContentPackRequest(
            "dev-joshua",
            1,
            "en",
            "Scripture",
            [
                new ImportDocumentDto("Joshua",
                [
                    new ImportUnitDto("Joshua 1:1", "JOS", 1, 1, 1, "Development sample: Joshua rose early."),
                    new ImportUnitDto("Joshua 1:2", "JOS", 1, 2, 2, "Development sample: Moses is mentioned as servant."),
                    new ImportUnitDto("Joshua 1:3", "JOS", 1, 3, 3, "Development sample: Every place your foot treads.")
                ])
            ]);

        var pack = await importer.ImportAsync(SeedIdentifiers.OrganizationId, request, CancellationToken.None);
        var again = await importer.ImportAsync(SeedIdentifiers.OrganizationId, request, CancellationToken.None);
        again.Id.Should().Be(pack.Id);

        var units = db.SourceUnits.Where(item => item.ContentPackId == pack.Id).OrderBy(item => item.Ordinal).ToList();
        units.Should().HaveCount(3);
        units[0].CanonicalText.Should().Be("Development sample: Joshua rose early.");
        units[0].BookKey.Should().Be("JOS");
        units[0].ContentHash.Should().Be(ContentHashing.Compute(units[0].CanonicalText, "JOS", 1, 1, 1));
        db.KnowledgeUnits.Count(item => item.ContentPackId == pack.Id && item.Kind == KnowledgeUnitKind.ExactVerseText).Should().Be(3);

        var season = new CompetitionSeason
        {
            Id = Guid.NewGuid(),
            OrganizationId = SeedIdentifiers.OrganizationId,
            Name = "Joshua Scope",
            YearLabel = "2026",
            Status = SeasonStatus.Draft,
            RuleProfileId = SeedIdentifiers.RuleProfileId,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };
        db.Seasons.Add(season);
        db.ScopeEntries.Add(new CompetitionScopeEntry
        {
            Id = Guid.NewGuid(),
            OrganizationId = SeedIdentifiers.OrganizationId,
            SeasonId = season.Id,
            ContentPackId = pack.Id,
            Kind = ScopeEntryKind.Include,
            BookKey = "JOS",
            StartChapter = 1,
            StartVerse = 1,
            EndChapter = 1,
            EndVerse = 3
        });
        var excludeSeason = season.Id;
        db.ScopeEntries.Add(new CompetitionScopeEntry
        {
            Id = Guid.NewGuid(),
            OrganizationId = SeedIdentifiers.OrganizationId,
            SeasonId = excludeSeason,
            ContentPackId = pack.Id,
            Kind = ScopeEntryKind.Exclude,
            BookKey = "JOS",
            StartChapter = 1,
            StartVerse = 2,
            EndChapter = 1,
            EndVerse = 2
        });
        await db.SaveChangesAsync();

        var resolver = scope.ServiceProvider.GetRequiredService<ICompetitionScopeResolver>();
        var resolved = await resolver.ResolveAsync(SeedIdentifiers.OrganizationId, excludeSeason, CancellationToken.None);
        resolved.Should().HaveCount(2);
        resolved.Should().NotContain(units[1].Id);
    }

    [Fact]
    public async Task Out_of_scope_or_mismatched_evidence_cannot_become_playable()
    {
        using var scope = factory.Services.CreateScope();
        var validator = scope.ServiceProvider.GetRequiredService<IQuestionCandidateValidator>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IQuestionLifecycleService>();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var unit = db.SourceUnits.First(item => item.OrganizationId == SeedIdentifiers.OrganizationId);
        var context = new QuestionValidationContext(
            SeedIdentifiers.OrganizationId,
            Guid.NewGuid(),
            new HashSet<Guid> { unit.Id });

        var outside = new QuestionCandidateData(
            "1",
            "ShortFact",
            "Who?",
            "ShortFact",
            "Daniel",
            ["Daniel"],
            [new QuestionEvidenceItem(Guid.NewGuid(), unit.CanonicalText)],
            1,
            null,
            "fake");
        (await validator.ValidateAsync(outside, context, CancellationToken.None)).IsValid.Should().BeFalse();

        var mismatch = outside with
        {
            SourceEvidence = [new QuestionEvidenceItem(unit.Id, "This text is not in the stored source.")]
        };
        (await validator.ValidateAsync(mismatch, context, CancellationToken.None)).IsValid.Should().BeFalse();

        var promote = async () => await lifecycle.PromoteValidatedCandidateAsync(outside, context, CancellationToken.None);
        await promote.Should().ThrowAsync<DomainException>();

        unit.IsRetired = true;
        await db.SaveChangesAsync();
        var stale = outside with
        {
            SourceEvidence = [new QuestionEvidenceItem(unit.Id, unit.CanonicalText)]
        };
        (await validator.ValidateAsync(stale, context, CancellationToken.None)).IsValid.Should().BeFalse();
        unit.IsRetired = false;
        await db.SaveChangesAsync();
        await ContentImportService.MarkDependentQuestionsStaleAsync(db, unit.OrganizationId, unit.Id, CancellationToken.None);
    }

    [Fact]
    public async Task Simulation_session_uses_stored_mode_and_never_returns_choices()
    {
        var (_, seasonId) = await ActivateFreshSeason("Simulation Meet");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var started = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Simulation" });
        started.EnsureSuccessStatusCode();
        var session = await started.Content.ReadFromJsonAsync<SessionDto>();
        session!.Mode.Should().Be("Simulation");
        session.TargetCardCount.Should().Be(10);

        using var firstDoc = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{session.Id}/next")).Content.ReadAsStringAsync());
        firstDoc.RootElement.GetProperty("activityType").GetString().Should().Be("MissingWords");
        if (firstDoc.RootElement.TryGetProperty("choices", out var firstChoices)
            && firstChoices.ValueKind == JsonValueKind.Array)
        {
            firstChoices.GetArrayLength().Should().Be(0);
        }

        var firstAnswer = firstDoc.RootElement.GetProperty("debugAnswer").GetString();
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new
        {
            clientSubmissionId = "sim-1",
            challengeCardId = firstDoc.RootElement.GetProperty("id").GetGuid(),
            submittedAnswer = firstAnswer,
            responseTimeMs = 800,
            hintsUsed = false
        })).EnsureSuccessStatusCode();

        using var secondDoc = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{session.Id}/next")).Content.ReadAsStringAsync());
        if (secondDoc.RootElement.TryGetProperty("choices", out var secondChoices) && secondChoices.ValueKind == JsonValueKind.Array)
        {
            secondChoices.GetArrayLength().Should().Be(0);
        }

        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new
        {
            clientSubmissionId = "sim-2",
            challengeCardId = secondDoc.RootElement.GetProperty("id").GetGuid(),
            submittedAnswer = secondDoc.RootElement.GetProperty("debugAnswer").GetString(),
            responseTimeMs = 700,
            hintsUsed = false
        })).EnsureSuccessStatusCode();

        var completed = await student.PostAsync($"/api/v1/study/sessions/{session.Id}/complete", null);
        completed.EnsureSuccessStatusCode();
        var summary = await completed.Content.ReadFromJsonAsync<SessionSummaryDto>();
        summary!.Mode.Should().Be("Simulation");
        summary.Attempted.Should().Be(2);
        summary.Status.Should().Be("Completed");
    }

    [Fact]
    public async Task Coach_coverage_lists_assigned_student_progress()
    {
        var (admin, seasonId) = await ActivateFreshSeason("Coverage Season");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        using var cardDoc = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{session!.Id}/next")).Content.ReadAsStringAsync());
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new
        {
            clientSubmissionId = "cov-1",
            challengeCardId = cardDoc.RootElement.GetProperty("id").GetGuid(),
            submittedAnswer = cardDoc.RootElement.GetProperty("debugAnswer").GetString(),
            responseTimeMs = 500,
            hintsUsed = false
        })).EnsureSuccessStatusCode();

        var coverage = await admin.GetFromJsonAsync<SeasonCoverageDto>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/coverage");
        coverage.Should().NotBeNull();
        coverage!.Students.Should().ContainSingle(item => item.UserName == "daniel.student" && item.AttemptCount >= 1);
        coverage.Students[0].EligibleUnitCount.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Generation_job_stores_validated_candidates_and_only_admin_can_approve()
    {
        var (admin, seasonId) = await ActivateFreshSeason("Generation Review");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var forbidden = await student.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/generation-jobs",
            null);
        forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var job = await admin.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/generation-jobs",
            null);
        job.EnsureSuccessStatusCode();
        var created = await job.Content.ReadFromJsonAsync<GenerationJobDto>();
        created!.Status.Should().Be("Completed");
        created.CandidateCount.Should().BeGreaterThan(0);

        var questions = await admin.GetFromJsonAsync<List<QuestionReviewDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/questions");
        questions.Should().NotBeEmpty();
        var validated = questions!.First(item => item.Status == "Validated");
        validated.Evidence.Should().NotBeEmpty();

        var approveForbidden = await student.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/questions/{validated.Id}/approve",
            null);
        approveForbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var approved = await admin.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/questions/{validated.Id}/approve",
            null);
        approved.EnsureSuccessStatusCode();

        var after = await admin.GetFromJsonAsync<List<QuestionReviewDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/questions");
        after!.Single(item => item.Id == validated.Id).Status.Should().Be("Playable");
    }

    [Fact]
    public async Task Rejected_or_invalid_candidates_cannot_become_playable()
    {
        var (admin, seasonId) = await ActivateFreshSeason("Reject Review");
        (await admin.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/generation-jobs",
            null)).EnsureSuccessStatusCode();
        var questions = await admin.GetFromJsonAsync<List<QuestionReviewDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/questions");
        var candidateId = questions![0].Id;

        (await admin.PostAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/questions/{candidateId}/reject",
            null)).EnsureSuccessStatusCode();
        var rejected = await admin.GetFromJsonAsync<List<QuestionReviewDto>>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/questions");
        rejected!.Single(item => item.Id == candidateId).Status.Should().Be("Rejected");

        using var scope = factory.Services.CreateScope();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IQuestionLifecycleService>();
        var unit = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>().SourceUnits
            .First(item => item.OrganizationId == SeedIdentifiers.OrganizationId);
        var invalid = new QuestionCandidateData(
            "1",
            "ShortFact",
            "Who?",
            "ShortFact",
            "Daniel",
            ["Daniel"],
            [new QuestionEvidenceItem(Guid.NewGuid(), unit.CanonicalText)],
            1,
            null,
            "fake");
        var promote = async () => await lifecycle.PromoteValidatedCandidateAsync(
            invalid,
            new QuestionValidationContext(SeedIdentifiers.OrganizationId, seasonId, new HashSet<Guid> { unit.Id }),
            CancellationToken.None);
        await promote.Should().ThrowAsync<DomainException>();
    }

    [Fact]
    public async Task Review_session_requires_due_passages_and_then_draws_from_them()
    {
        var (_, seasonId) = await ActivateFreshSeason("Review Due");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var empty = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Review" });
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var practice = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        using var cardDoc = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{practice!.Id}/next")).Content.ReadAsStringAsync());
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{practice.Id}/attempts", new
        {
            clientSubmissionId = "miss-1",
            challengeCardId = cardDoc.RootElement.GetProperty("id").GetGuid(),
            submittedAnswer = "not the hidden phrase",
            responseTimeMs = 400,
            hintsUsed = false
        })).EnsureSuccessStatusCode();

        var review = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Review" });
        review.EnsureSuccessStatusCode();
        var session = await review.Content.ReadFromJsonAsync<SessionDto>();
        session!.Mode.Should().Be("Review");
        session.TargetCardCount.Should().BeGreaterThan(0);

        using var reviewCard = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{session.Id}/next")).Content.ReadAsStringAsync());
        reviewCard.RootElement.GetProperty("activityType").GetString().Should().Be("MissingWords");
        reviewCard.RootElement.GetProperty("citation").GetString().Should().Be(cardDoc.RootElement.GetProperty("citation").GetString());
    }

    [Fact]
    public async Task Simulation_true_false_stays_within_pbe_ratio()
    {
        var (_, seasonId) = await ActivateFreshSeason("True False Cap");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Simulation" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        var types = new List<string>();
        for (var index = 0; index < session!.TargetCardCount; index++)
        {
            var next = await student.GetAsync($"/api/v1/study/sessions/{session.Id}/next");
            if (!next.IsSuccessStatusCode)
            {
                break;
            }

            using var card = JsonDocument.Parse(await next.Content.ReadAsStringAsync());
            types.Add(card.RootElement.GetProperty("activityType").GetString() ?? string.Empty);
            if (card.RootElement.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array)
            {
                choices.GetArrayLength().Should().Be(0);
            }

            (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new
            {
                clientSubmissionId = $"tf-{index}",
                challengeCardId = card.RootElement.GetProperty("id").GetGuid(),
                submittedAnswer = card.RootElement.GetProperty("debugAnswer").GetString(),
                responseTimeMs = 300,
                hintsUsed = false
            })).EnsureSuccessStatusCode();
        }

        types[0].Should().Be("MissingWords");
        types.Count(item => item == "TrueFalse").Should().BeLessThanOrEqualTo(1);
    }

    [Fact]
    public async Task Coach_can_read_student_progress_and_student_cannot()
    {
        var (admin, seasonId) = await ActivateFreshSeason("Coach Progress");
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var session = await (await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId, mode = "Practice" }))
            .Content.ReadFromJsonAsync<SessionDto>();
        using var cardDoc = JsonDocument.Parse(await (await student.GetAsync($"/api/v1/study/sessions/{session!.Id}/next")).Content.ReadAsStringAsync());
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new
        {
            clientSubmissionId = "coach-1",
            challengeCardId = cardDoc.RootElement.GetProperty("id").GetGuid(),
            submittedAnswer = cardDoc.RootElement.GetProperty("debugAnswer").GetString(),
            responseTimeMs = 500,
            hintsUsed = false
        })).EnsureSuccessStatusCode();

        var progress = await admin.GetFromJsonAsync<ProgressDto>(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/students/{SeedIdentifiers.StudentUserId}/progress");
        progress!.AttemptCount.Should().BeGreaterThan(0);
        progress.StudentDisplayName.Should().NotBeNullOrWhiteSpace();
        progress.StudentUserId.Should().Be(SeedIdentifiers.StudentUserId);
        progress.RecentAttempts.Should().NotBeNull();
        progress.RecentAttempts!.Should().Contain(item => item.ActivityType == "MissingWords" && item.IsCorrect);

        var own = await student.GetFromJsonAsync<ProgressDto>("/api/v1/progress/me");
        own!.RecentAttempts.Should().Contain(item => item.ActivityType == "MissingWords");

        var forbidden = await student.GetAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/students/{SeedIdentifiers.StudentUserId}/progress");
        forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Assignment_of_another_student_does_not_leak()
    {
        var (_, seasonId) = await ActivateFreshSeason("Isolation Assign");
        using var scope = factory.Services.CreateScope();
        var studyScope = scope.ServiceProvider.GetRequiredService<IStudentStudyScopeService>();
        var empty = await studyScope.GetAsync(Guid.NewGuid(), seasonId, CancellationToken.None);
        empty.EligibleSourceUnitIds.Should().BeEmpty();
    }

    private async Task<(HttpClient Admin, Guid SeasonId)> ActivateFreshSeason(string? name = null)
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
            new { name = name ?? $"Season {Guid.NewGuid():N}"[..18], yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        created.EnsureSuccessStatusCode();
        var season = await created.Content.ReadFromJsonAsync<SeasonDto>();
        await DefineAndAssign(admin, season!.Id, SeedIdentifiers.StudentUserId);
        (await admin.PostAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}/activate", null)).EnsureSuccessStatusCode();
        return (admin, season.Id);
    }

    private static async Task DefineAndAssign(HttpClient admin, Guid seasonId, Guid studentId)
    {
        var scope = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/scope",
            new
            {
                contentPackId = SeedIdentifiers.ContentPackId,
                includes = new[]
                {
                    new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 8 }
                },
                excludes = new[]
                {
                    new { bookKey = "DAN", startChapter = 1, startVerse = 5, endChapter = 1, endVerse = 5 }
                }
            });
        if (!scope.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Scope failed ({(int)scope.StatusCode}): {await scope.Content.ReadAsStringAsync()}");
        }

        var assignment = await admin.PostAsJsonAsync(
            $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{seasonId}/assignments",
            new
            {
                studentUserId = studentId,
                type = "PrimarySpecialist",
                contentPackId = SeedIdentifiers.ContentPackId,
                range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 4 }
            });
        assignment.EnsureSuccessStatusCode();
    }
}
