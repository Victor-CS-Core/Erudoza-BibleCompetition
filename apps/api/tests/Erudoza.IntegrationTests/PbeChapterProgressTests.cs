using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

[Collection("Pbe chapter resource isolation")]
public sealed class PbeChapterProgressTests
{
    [Fact]
    public async Task Get_is_read_only_and_discovers_not_started_work()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var me = await student.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var org = me.GetProperty("organizationId").GetGuid();
        var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "chapter", Version = 1 };
        var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = org, Name = "Chapters", RuleProfileId = rule.Id, Status = SeasonStatus.Active, PbeEnabled = true };
        db.RuleProfiles.Add(rule); db.Seasons.Add(season); await db.SaveChangesAsync();
        var response = await student.GetAsync($"/api/v1/progress/me/chapters?seasonId={season.Id}");
        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var page = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("NotStarted", page.GetProperty("work").GetProperty("state").GetString());
        Assert.Empty(page.GetProperty("items").EnumerateArray());
        Assert.False(await db.PbeTrainingRecords.AnyAsync(r => r.Kind == "pbe-chapter-work" || r.Kind == "pbe-chapter-stamp"));
    }

    static async Task<JsonElement> Finish(PbeStudyTests.Fixture f, string? workId = null)
    {
        for (var n = 0; n < 80; n++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId });
            Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            var step = await response.Content.ReadFromJsonAsync<JsonElement>();
            if (step.GetProperty("next").GetString() == "Reload") return await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}");
            Assert.Equal("Continue", step.GetProperty("next").GetString());
            workId = step.GetProperty("work").GetProperty("id").GetString();
        }
        throw new Exception("Chapter work did not finish within the fixture bound.");
    }

    static async Task Accept(PbeStudyTests.Fixture f, int questionIndex, long atMs, long? lockMs = null, bool correct = true)
    {
        using var scope = f.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var bank = (await db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head").OrderBy(r => r.Id).ToListAsync())
            .Select(r => JsonSerializer.Deserialize<PbeBankQuestionData>(r.DataJson, PbeQuestionBank.Json)!).ToArray();
        var q = bank[questionIndex].Question; var id = Guid.NewGuid();
        var evidence = q.Parts.Select(p => new PbeRecallEvidence(id, p.TargetId, q.Id, atMs, correct ? p.Points : 0, p.Points, true, true)).ToArray();
        var progress = scope.ServiceProvider.GetRequiredService<PbeProgressService>();
        await progress.ExecuteAsync(ct => progress.PrepareRecallEvidenceAsync(f.Org, f.Season, f.StudentId, "fixture-frozen", evidence, ct, q.Kind.ToString(), q.Version, lockMs));
    }

    [Fact]
    public async Task Untouched_introduction_finishes_without_missing_reference_repair_or_stamps()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var page = await Finish(f); var item = Assert.Single(page.GetProperty("items").EnumerateArray());
        Assert.Equal("Introduction", item.GetProperty("kind").GetString());
        Assert.Equal($"intro:{f.Intro}", item.GetProperty("key").GetString());
        Assert.Equal(1, item.GetProperty("counts").GetProperty("assignedPassages").GetInt32());
        Assert.Equal(2, item.GetProperty("counts").GetProperty("totalTargets").GetInt32());
        Assert.Equal("Incomplete", item.GetProperty("currentReadiness").GetString());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("stamp").ValueKind);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-recall-event"));
        var repeated = await Finish(f); Assert.Equal(page.GetProperty("snapshotId").GetString(), repeated.GetProperty("snapshotId").GetString());
    }

    [Fact]
    public async Task Original_locks_prevent_delayed_projection_credit_and_a_later_different_response_earns_one_immutable_stamp()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await Accept(f, 0, now - 172800000, now - 172800000);
        await Accept(f, 1, now, now - 172799000);
        var early = await Finish(f); Assert.Equal(0, early.GetProperty("items")[0].GetProperty("counts").GetProperty("retainedTargets").GetInt32());
        await Accept(f, 1, now + 1, now + 1);
        var retained = await Finish(f); var item = retained.GetProperty("items")[0]; Assert.Equal("Retained", item.GetProperty("currentReadiness").GetString());
        var stamp = item.GetProperty("stamp"); Assert.Equal("Introduction", stamp.GetProperty("kind").GetString());
        Assert.Equal(1, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp"));
        var stampJson = (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp")).DataJson;
        await Accept(f, 0, now + 2, correct: false);
        var stale = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}");
        Assert.Equal("Updating", stale.GetProperty("items")[0].GetProperty("currentReadiness").GetString());
        var current = await Finish(f); Assert.Equal("Incomplete", current.GetProperty("items")[0].GetProperty("currentReadiness").GetString());
        Assert.Equal(stamp.GetProperty("stampId").GetString(), current.GetProperty("items")[0].GetProperty("stamp").GetProperty("stampId").GetString());
        Assert.Equal(stampJson, (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp")).DataJson);
        var season = await f.Db.Seasons.SingleAsync(s => s.Id == f.Season); season.PbeEnabled = false; await f.Db.SaveChangesAsync();
        var history = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}&view=Stamps");
        Assert.Single(history.GetProperty("items").EnumerateArray()); Assert.Equal(JsonValueKind.Null, history.GetProperty("items")[0].GetProperty("matchesCurrentScope").ValueKind);
        Assert.False(history.GetProperty("currentAvailable").GetBoolean()); Assert.Equal("PbeDisabled", history.GetProperty("work").GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Bootstrap_race_converges_and_stale_work_is_rejected_after_assignment_change()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season })));
        var steps = new List<JsonElement>(); foreach (var response in responses) { Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync()); steps.Add(await response.Content.ReadFromJsonAsync<JsonElement>()); }
        Assert.Equal(steps[0].GetProperty("work").GetProperty("id").GetString(), steps[1].GetProperty("work").GetProperty("id").GetString());
        var old = steps[0].GetProperty("work").GetProperty("id").GetString();
        await Finish(f, old);
        var intro = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction");
        intro.Revision++; var data = JsonSerializer.Deserialize<PbeIntroduction>(intro.DataJson, PbeQuestionBank.Json)!;
        intro.DataJson = JsonSerializer.Serialize(data with { Reviewed = false }, PbeQuestionBank.Json); await f.Db.SaveChangesAsync();
        var stale = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId = old });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("PBE_CHAPTER_WORK_STALE", (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Real_http_acceptance_and_legacy_replay_use_frozen_question_provenance()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var started = await f.Student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = f.Season, format = "Pbe", mode = "Practice" });
        started.EnsureSuccessStatusCode(); var session = (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var card = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/study/sessions/{session}/next");
        var answer = await f.Student.PostAsJsonAsync($"/api/v1/study/sessions/{session}/attempts", new { clientSubmissionId = "chapter-original", challengeCardId = card.GetProperty("id").GetGuid(), answers = new[] { "Alpha", "Beta" }, hintsUsed = false });
        Assert.True(answer.IsSuccessStatusCode, await answer.Content.ReadAsStringAsync());
        var references = await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-evidence-ref").ToListAsync();
        Assert.Equal(2, references.Count);
        Assert.All(references, row => Assert.Equal(1, JsonSerializer.Deserialize<PbeEvidenceRef>(row.DataJson, PbeQuestionBank.Json)!.QuestionVersion));
        var before = (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-attempt")).DataJson;
        foreach (var row in references) row.DataJson = JsonSerializer.Serialize(JsonSerializer.Deserialize<PbeEvidenceRef>(row.DataJson, PbeQuestionBank.Json)! with { QuestionVersion = null, ResponseLockedAtMs = null }, PbeQuestionBank.Json);
        foreach (var row in await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-target-review").ToListAsync()) row.DataJson = JsonSerializer.Serialize(JsonSerializer.Deserialize<PbeReviewProjection>(row.DataJson, PbeQuestionBank.Json)! with { Retention = null }, PbeQuestionBank.Json);
        // A changed current head cannot supply the legacy provenance; only the owning frozen card can.
        var question = card.GetProperty("question").GetProperty("id").GetGuid();
        var head = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head" && r.Id == question.ToString());
        var bank = JsonSerializer.Deserialize<PbeBankQuestionData>(head.DataJson, PbeQuestionBank.Json)!; bank.Question.Version = 7;
        head.DataJson = JsonSerializer.Serialize(bank, PbeQuestionBank.Json); head.Revision++;
        await f.Db.SaveChangesAsync();
        var page = await Finish(f); Assert.True(page.GetProperty("currentAvailable").GetBoolean());
        var proofs = (await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && r.Kind == "pbe-target-review").ToListAsync()).Select(r => JsonSerializer.Deserialize<PbeReviewProjection>(r.DataJson, PbeQuestionBank.Json)!).ToArray();
        Assert.All(proofs, proof => { Assert.False(proof.Retention!.DataGap); Assert.Equal(1, Assert.Single(proof.Retention.Earliest).QuestionVersion); });
        Assert.Equal(before, (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-attempt")).DataJson);
    }

    [Fact]
    public async Task A_130_target_stamp_seals_multiple_bounded_witness_pages_and_measures_actual_requests()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var template = JsonSerializer.Deserialize<PbeBankQuestionData>((await f.Db.PbeTrainingRecords.AsNoTracking().FirstAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-question-head")).DataJson, PbeQuestionBank.Json)!;
        await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && (r.Kind == "pbe-target" || r.Kind == "pbe-question-head")).ExecuteDeleteAsync();
        var source = new PbeSourceUnit(f.Unit, f.Intro, Erudoza.Domain.Practice.PbeSourceKind.Commentary, "GEN", null, null, 1, "Intro §1", "Alpha and Beta");
        var sources = new Dictionary<Guid, PbeSourceUnit> { [source.Id] = source };
        var targets = Enumerable.Range(0, 130).Select(_ => Guid.NewGuid()).ToArray();
        var questions = new List<Erudoza.Domain.Practice.PbeQuestion>();
        foreach (var target in targets)
        {
            f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.Unit, Kind = "pbe-target", Id = target.ToString(), DataJson = JsonSerializer.Serialize(new Erudoza.Domain.Practice.PbeTarget { Id = target, SourceUnitIds = [f.Unit], Skill = Erudoza.Domain.Practice.RecallSkill.FactualRecall, Label = "Label" }, PbeQuestionBank.Json) });
            for (var variant = 0; variant < 2; variant++)
            {
                var q = JsonSerializer.Deserialize<Erudoza.Domain.Practice.PbeQuestion>(JsonSerializer.Serialize(template.Question, PbeQuestionBank.Json), PbeQuestionBank.Json)!;
                q.Id = Guid.NewGuid(); q.Parts = [new() { TargetId = target, Points = 1, AcceptedAnswers = ["Alpha"] }]; questions.Add(q);
                f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.Unit, Kind = "pbe-question-head", Id = q.Id.ToString(), DataJson = JsonSerializer.Serialize(new PbeBankQuestionData(q.Id.ToString(), f.Season, true, q, PbeQuestionBank.SourceProof(q, sources)), PbeQuestionBank.Json) });
            }
        }
        await f.Db.SaveChangesAsync();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        for (var variant = 0; variant < 2; variant++) foreach (var q in questions.Where((_, index) => index % 2 == variant))
        {
            using var acceptedScope = f.Factory.Services.CreateScope(); var progress = acceptedScope.ServiceProvider.GetRequiredService<PbeProgressService>();
            await progress.ExecuteAsync(ct => progress.PrepareRecallEvidenceAsync(f.Org, f.Season, f.StudentId, "frozen-fixture", [new(Guid.NewGuid(), q.Parts[0].TargetId, q.Id, now - (1 - variant) * 172800000L, 1, 1, true, true)], ct, q.Kind.ToString(), q.Version));
        }
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter;
        var measurements = new List<object>(); string? workId = null; var finished = false;
        for (var n = 0; n < 150; n++)
        {
            var before = await f.Db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-work");
            var prior = before is null ? null : JsonSerializer.Deserialize<PbeChapterProgressService.Work>(before.DataJson, PbeQuestionBank.Json);
            meter.Reset(); meter.Active = true; var watch = System.Diagnostics.Stopwatch.StartNew();
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId });
            meter.Active = false; watch.Stop(); Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            var step = await response.Content.ReadFromJsonAsync<JsonElement>(); workId = step.GetProperty("work").GetProperty("id").GetString();
            var after = JsonSerializer.Deserialize<PbeChapterProgressService.Work>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-work")).DataJson, PbeQuestionBank.Json)!;
            var publication = after.RowOffset > (prior?.RowOffset ?? 0) || after.State == "Complete";
            measurements.Add(new { phase = prior?.CapturePhase ?? "bootstrap", publication, meter.Statements, meter.Rows, meter.ValueBytes, meter.MaxQueryValueBytes, meter.MaxBoundBytes, elapsedMs = watch.ElapsedMilliseconds });
            Assert.InRange(meter.Statements, 1, 50); Assert.InRange(meter.MaxBoundBytes, 0, 65536);
            if (!publication) Assert.InRange(meter.MaxQueryValueBytes, 0, 65536);
            if (step.GetProperty("next").GetString() == "Reload") { finished = true; break; }
            if (step.GetProperty("next").GetString() != "Continue") { Directory.CreateDirectory(".local"); await File.WriteAllTextAsync(".local/d1-canonical-resource-failure.json", JsonSerializer.Serialize(new { prior, step, measurements })); }
            Assert.True(step.GetProperty("next").GetString() == "Continue", JsonSerializer.Serialize(new { priorPhase = prior?.CapturePhase, step }));
        }
        Directory.CreateDirectory(".local"); await File.WriteAllTextAsync(".local/d1-canonical-resource.json", JsonSerializer.Serialize(measurements));
        Assert.True(finished);
        var stamp = JsonSerializer.Deserialize<PbeChapterProgressService.Stamp>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp")).DataJson, PbeQuestionBank.Json)!;
        Assert.Equal(130, stamp.TargetCount); Assert.Equal(260, stamp.QualifyingAttemptCount); Assert.True(stamp.ProofPageCount >= 3);
        var pages = await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp-proof").ToListAsync();
        Assert.Equal(stamp.ProofPageCount, pages.Count);
        Assert.All(pages, row => { Assert.InRange(System.Text.Encoding.UTF8.GetByteCount(row.DataJson), 1, 65536); Assert.InRange(JsonSerializer.Deserialize<PbeChapterProgressService.WitnessPage>(row.DataJson, PbeQuestionBank.Json)!.Entries.Count, 1, 64); });
        Assert.All(await f.Db.PbeTrainingRecords.AsNoTracking().Where(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-manifest").ToListAsync(), row => { Assert.InRange(System.Text.Encoding.UTF8.GetByteCount(row.DataJson), 1, 65536); Assert.InRange(JsonSerializer.Deserialize<string[]>(row.DataJson)!.Length, 0, 128); });
        var stampBefore = (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp")).DataJson;
        await Accept(f, 0, now + 1, correct: false); await Finish(f);
        Assert.Equal(stampBefore, (await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp")).DataJson);
        Assert.Equal(pages.Count, await f.Db.PbeTrainingRecords.CountAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp-proof" && r.Id.StartsWith(stamp.ProofGenerationId + ":")));
    }

    [Fact]
    public async Task Repaired_blocked_bank_requires_a_fresh_bootstrap_and_rejects_the_old_work_id()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var badId = Guid.NewGuid().ToString();
        f.Db.PbeTrainingRecords.Add(new()
        {
            OrganizationId = f.Org,
            SeasonId = f.Season,
            OwnerId = f.Unit,
            Kind = "pbe-target",
            Id = badId,
            DataJson = JsonSerializer.Serialize(new Erudoza.Domain.Practice.PbeTarget { Id = Guid.Parse(badId), SourceUnitIds = [f.Unit], Label = new string('雪', 12000) }, PbeQuestionBank.Json)
        });
        await f.Db.SaveChangesAsync(); string? workId = null; JsonElement step = default;
        for (var n = 0; n < 30; n++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId }); response.EnsureSuccessStatusCode(); step = await response.Content.ReadFromJsonAsync<JsonElement>();
            workId = step.GetProperty("work").GetProperty("id").GetString(); if (step.GetProperty("next").GetString() == "None") break;
        }
        Assert.Equal("InputTooLarge", step.GetProperty("work").GetProperty("reason").GetString());
        await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-target" && r.Id == badId).ExecuteDeleteAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId })).StatusCode);
        var current = await Finish(f); Assert.True(current.GetProperty("currentAvailable").GetBoolean()); Assert.NotEqual(workId, current.GetProperty("snapshotId").GetString());
    }

    [Fact]
    public async Task Ten_thousand_untouched_targets_finish_with_bounded_requests_and_cap_plus_one_blocks()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && (r.Kind == "pbe-target" || r.Kind == "pbe-question-head")).ExecuteDeleteAsync();
        PbeTrainingRecord TargetRecord() { var id = Guid.NewGuid(); return new() { OrganizationId = f.Org, SeasonId = f.Season, OwnerId = f.Unit, Kind = "pbe-target", Id = id.ToString(), DataJson = JsonSerializer.Serialize(new Erudoza.Domain.Practice.PbeTarget { Id = id, SourceUnitIds = [f.Unit], Label = "Label", Skill = Erudoza.Domain.Practice.RecallSkill.FactualRecall }, PbeQuestionBank.Json) }; }
        f.Db.PbeTrainingRecords.AddRange(Enumerable.Range(0, 10000).Select(_ => TargetRecord())); await f.Db.SaveChangesAsync(); f.Db.ChangeTracker.Clear();
        using var meter = new PbeChapterResourceMeter(); f.Factory.CommandInterceptor = meter; var measurements = new List<object>();
        string? workId = null; PbeChapterProgressService.Work? prior = null; var timer = System.Diagnostics.Stopwatch.StartNew(); var complete = false;
        for (var n = 0; n < 1400; n++)
        {
            meter.Reset(); meter.Active = true; var watch = System.Diagnostics.Stopwatch.StartNew();
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId });
            meter.Active = false; watch.Stop(); Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            var step = await response.Content.ReadFromJsonAsync<JsonElement>(); workId = step.GetProperty("work").GetProperty("id").GetString();
            var after = JsonSerializer.Deserialize<PbeChapterProgressService.Work>((await f.Db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-work")).DataJson, PbeQuestionBank.Json)!;
            var publication = after.RowOffset > (prior?.RowOffset ?? 0) || after.State == "Complete";
            measurements.Add(new { phase = prior?.CapturePhase ?? "bootstrap", publication, meter.Statements, meter.Rows, meter.ValueBytes, meter.MaxQueryValueBytes, meter.MaxBoundBytes, elapsedMs = watch.ElapsedMilliseconds });
            Assert.InRange(meter.Statements, 1, 50); Assert.InRange(meter.MaxBoundBytes, 0, 65536); if (!publication) Assert.InRange(meter.MaxQueryValueBytes, 0, 65536);
            prior = after;
            if (after.State == "Complete") { complete = true; break; }
            Assert.True(step.GetProperty("next").GetString() == "Continue", JsonSerializer.Serialize(step));
        }
        Directory.CreateDirectory(".local"); await File.WriteAllTextAsync(".local/d1-canonical-10000-resource.json", JsonSerializer.Serialize(new { requests = measurements.Count, elapsedMs = timer.ElapsedMilliseconds, stagedBytes = prior?.StagedBytes, measurements }));
        Assert.True(complete); Assert.InRange(prior!.StagedBytes, 1, 16 * 1024 * 1024);
        var page = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}");
        Assert.Equal(10000, Assert.Single(page.GetProperty("items").EnumerateArray()).GetProperty("counts").GetProperty("totalTargets").GetInt32()); Assert.False(page.GetProperty("historyAvailable").GetBoolean());
        f.Db.PbeTrainingRecords.Add(TargetRecord()); await f.Db.SaveChangesAsync(); workId = null; var blocked = false;
        for (var n = 0; n < 220; n++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId }); response.EnsureSuccessStatusCode();
            var step = await response.Content.ReadFromJsonAsync<JsonElement>(); workId = step.GetProperty("work").GetProperty("id").GetString();
            if (step.GetProperty("next").GetString() == "None") { Assert.Equal("ScopeTooLarge", step.GetProperty("work").GetProperty("reason").GetString()); blocked = true; break; }
        }
        Assert.True(blocked); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp"));
    }

    [Fact]
    public async Task A_source_text_change_after_witness_staging_prevents_publication_even_without_revision_change()
    {
        using var f = await PbeStudyTests.Fixture.Create(); var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await Accept(f, 0, now - 172800000); await Accept(f, 1, now);
        string? workId = null; var staged = false;
        for (var n = 0; n < 60; n++)
        {
            var response = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId }); response.EnsureSuccessStatusCode();
            workId = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("work").GetProperty("id").GetString();
            if (await f.Db.PbeTrainingRecords.AnyAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp-proof")) { staged = true; break; }
        }
        Assert.True(staged); Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-chapter-stamp"));
        var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction");
        var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
        row.DataJson = JsonSerializer.Serialize(intro with { Units = intro.Units.Select(u => u with { CanonicalText = "Changed canonical text" }).ToArray() }, PbeQuestionBank.Json); await f.Db.SaveChangesAsync();
        var publication = await f.Student.PostAsJsonAsync("/api/v1/progress/me/chapters/continue", new { seasonId = f.Season, workId }); Assert.Equal(HttpStatusCode.Conflict, publication.StatusCode);
        Assert.False(await f.Db.PbeTrainingRecords.AnyAsync(r => r.SeasonId == f.Season && (r.Kind == "pbe-chapter-stamp" || r.Kind == "pbe-chapter-projection")));
        var recovered = await Finish(f); Assert.True(recovered.GetProperty("currentAvailable").GetBoolean()); Assert.False(recovered.GetProperty("historyAvailable").GetBoolean());
    }

    [Fact]
    public async Task Legacy_supplemental_pack_chapters_share_one_introduction_parent()
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var pack = new ContentPack { Id = Guid.NewGuid(), OrganizationId = f.Org, PackKey = "supplemental", SourceType = SourceType.Supplemental, LicensingStatus = "approved" };
        var document = new SourceDocument { Id = Guid.NewGuid(), ContentPackId = pack.Id, Name = "Supplemental" };
        f.Db.ContentPacks.Add(pack); f.Db.SourceDocuments.Add(document);
        f.Db.SourceUnits.AddRange(Enumerable.Range(1, 2).Select(n => new SourceUnit { Id = Guid.NewGuid(), OrganizationId = f.Org, ContentPackId = pack.Id, SourceDocumentId = document.Id, SourceType = SourceType.Supplemental, BookKey = "GEN", Chapter = n, Verse = 1, Ordinal = n, CitationLabel = $"Supplement {n}", CanonicalText = "Alpha" }));
        f.Db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, ContentPackId = pack.Id, Kind = ScopeEntryKind.Include, BookKey = "GEN", StartChapter = 1, EndChapter = 2, StartVerse = 1, EndVerse = 1 });
        f.Db.Assignments.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, StudentUserId = f.StudentId, Type = AssignmentType.RequiredCoverage, Scopes = [new() { Id = Guid.NewGuid(), ContentPackId = pack.Id, BookKey = "GEN", StartChapter = 1, EndChapter = 2, StartVerse = 1, EndVerse = 1 }] });
        await f.Db.SaveChangesAsync(); var page = await Finish(f);
        var parent = Assert.Single(page.GetProperty("items").EnumerateArray(), item => item.GetProperty("contentPackId").GetGuid() == pack.Id);
        Assert.Equal("Introduction", parent.GetProperty("kind").GetString()); Assert.Equal(JsonValueKind.Null, parent.GetProperty("chapter").ValueKind); Assert.Equal(2, parent.GetProperty("counts").GetProperty("assignedPassages").GetInt32());
    }

    [Theory]
    [InlineData(1, "1")]
    [InlineData(2, "2")]
    [InlineData(6, "3,3")]
    [InlineData(11, "4,4,3")]
    public async Task True_parent_and_balanced_children_have_direct_nonadditive_counts(int verses, string expected)
    {
        using var f = await PbeStudyTests.Fixture.Create();
        var pack = new ContentPack { Id = Guid.NewGuid(), OrganizationId = f.Org, PackKey = "chapter-fixture", LicensingStatus = "approved" };
        var document = new SourceDocument { Id = Guid.NewGuid(), ContentPackId = pack.Id, Name = "Chapter fixture" };
        var sources = Enumerable.Range(1, verses + 1).Select(n => new SourceUnit { Id = Guid.NewGuid(), ContentPackId = pack.Id, SourceDocumentId = document.Id, OrganizationId = f.Org, BookKey = "GEN", Chapter = 1, Verse = n, Ordinal = n, CitationLabel = $"Genesis 1:{n}", CanonicalText = "Alpha" }).ToArray();
        f.Db.ContentPacks.Add(pack); f.Db.SourceDocuments.Add(document); f.Db.SourceUnits.AddRange(sources);
        f.Db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, ContentPackId = pack.Id, Kind = ScopeEntryKind.Include, BookKey = "GEN", StartChapter = 1, EndChapter = 1, StartVerse = 1, EndVerse = verses });
        f.Db.Assignments.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, StudentUserId = f.StudentId, Type = AssignmentType.RequiredCoverage, Scopes = [new() { Id = Guid.NewGuid(), ContentPackId = pack.Id, BookKey = "GEN", StartChapter = 1, EndChapter = 1, StartVerse = 1, EndVerse = verses }] });
        var target = new Erudoza.Domain.Practice.PbeTarget { Id = Guid.NewGuid(), SourceUnitIds = sources.Take(verses).Select(x => x.Id).ToList(), Label = "Spanning target", Skill = Erudoza.Domain.Practice.RecallSkill.FactualRecall };
        f.Db.PbeTrainingRecords.Add(new() { OrganizationId = f.Org, SeasonId = f.Season, Kind = "pbe-target", Id = target.Id.ToString(), OwnerId = sources[0].Id, DataJson = JsonSerializer.Serialize(target, PbeQuestionBank.Json) });
        await f.Db.SaveChangesAsync();
        var page = await Finish(f); var parent = Assert.Single(page.GetProperty("items").EnumerateArray(), x => x.GetProperty("kind").GetString() == "Chapter");
        Assert.False(parent.GetProperty("wholeChapterAssigned").GetBoolean());
        Assert.Equal(verses, parent.GetProperty("counts").GetProperty("assignedPassages").GetInt32());
        Assert.Equal(1, parent.GetProperty("counts").GetProperty("totalTargets").GetInt32());
        var key = parent.GetProperty("key").GetString();
        var children = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}&view=Groups&chapterKey={Uri.EscapeDataString(key!)}");
        Assert.Equal(expected, string.Join(',', children.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("counts").GetProperty("assignedPassages").GetInt32())));
        Assert.All(children.GetProperty("items").EnumerateArray(), child => { Assert.Equal(1, child.GetProperty("counts").GetProperty("totalTargets").GetInt32()); Assert.Equal(JsonValueKind.Null, child.GetProperty("stamp").ValueKind); Assert.Equal(JsonValueKind.Null, child.GetProperty("wholeChapterAssigned").ValueKind); });
        var gathered = new List<string>(); string? cursor = null;
        do
        {
            var one = await f.Student.GetFromJsonAsync<JsonElement>($"/api/v1/progress/me/chapters?seasonId={f.Season}&view=Groups&chapterKey={Uri.EscapeDataString(key!)}&limit=1" + (cursor is null ? "" : "&after=" + Uri.EscapeDataString(cursor)));
            gathered.AddRange(one.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("key").GetString()!)); cursor = one.GetProperty("nextCursor").GetString();
        } while (cursor is not null);
        Assert.Equal(children.GetProperty("items").EnumerateArray().Select(x => x.GetProperty("key").GetString()), gathered);

    }
}

[CollectionDefinition("Pbe chapter resource isolation", DisableParallelization = true)]
public sealed class PbeChapterResourceCollection { }
