using System.Text.Json;
using Erudoza.Application.Study;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class PbeEvidenceReplayTests
{
    [Fact]
    public async Task Legacy_backfill_and_target_replay_preserve_original_order_concurrent_acceptance_and_pending_failure()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var progress = new PbeProgressService(db); var replay = new PbeEvidenceReplayService(db, progress);
        var org = Guid.NewGuid(); var owner = Guid.NewGuid(); var season = Guid.NewGuid(); var target = Guid.NewGuid(); var question = Guid.NewGuid();
        var events = Enumerable.Range(0, 34).Select(n => new PbeRecallEvidence(n == 33 ? Guid.Parse("00000001-0000-4000-8000-000000000001") : Guid.NewGuid(), target, question, n / 2 * 86400000L, n == 32 ? 0 : 1, 1, true, true)).ToList();
        async Task Accept(PbeRecallEvidence e) { await progress.ExecuteAsync(ct => progress.PrepareRecallEvidenceAsync(org, season, owner, "frozen-scope", [e], ct, "ShortAnswer")); db.ChangeTracker.Clear(); }
        foreach (var e in events.Take(33)) await Accept(e);
        await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && (r.Kind == "pbe-evidence-index" || r.Kind == "pbe-evidence-ref")).ExecuteDeleteAsync();
        var q = new PbeQuestion { SchemaVersion = 2, Id = question, Version = 1, ContentPackId = Guid.NewGuid(), SourceUnitId = Guid.NewGuid(), SourceKind = PbeSourceKind.Scripture, Reference = "Synthetic 1:1", Evidence = "Daniel", Kind = PbeQuestionKind.ShortAnswer, Prompt = "Who?", Parts = [new() { TargetId = target, Points = 1, AcceptedAnswers = ["Daniel"] }] };
        var session = Guid.NewGuid().ToString(); var d = new PbeDispute($"Solo:{session}:{events[32].AttemptId}", org, season, "Solo", session, events[32].AttemptId.ToString(), question, 1, null, "Pending", "Check the label", 1, [1], "Daniel", q, ["wrong"], [0], DateTimeOffset.FromUnixTimeMilliseconds(events[32].AtMs), [owner], [owner], null);
        async Task Stage(PbeDispute value) { await progress.ExecuteAsync(async ct => { await replay.StageDispute(value, ct); return true; }); db.ChangeTracker.Clear(); }
        async Task<JsonElement> Continue(PbeDispute value) { var result = JsonSerializer.SerializeToElement(await replay.Continue(value, default), PbeQuestionBank.Json); db.ChangeTracker.Clear(); return result; }
        await Stage(d); var first = await Continue(d); Assert.Equal("Indexing", first.GetProperty("stage").GetString()); Assert.Equal(25, await db.PbeTrainingRecords.CountAsync(r => r.OrganizationId == org && r.Kind == "pbe-evidence-ref"));
        await Accept(events[33]); var original = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.Kind == "pbe-recall-event").OrderBy(r => r.Id).Select(r => r.DataJson).ToListAsync();
        var page32 = false; var ready = false;
        for (var n = 0; n < 12 && !ready; n++) { var result = await Continue(d); ready = result.GetProperty("status").GetString() == "Ready"; if (result.TryGetProperty("processed", out var processed) && processed.GetInt32() == 32) page32 = true; }
        Assert.True(ready); Assert.True(page32);
        async Task<PbeReviewProjection> Proof() => JsonSerializer.Deserialize<PbeReviewProjection>((await db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.OrganizationId == org && r.Kind == "pbe-target-review")).DataJson, PbeQuestionBank.Json)!;
        var pending = await Proof(); Assert.True(pending.Provisional); Assert.Equal(1, pending.PendingCount); Assert.Equal(34, pending.AcceptedSequence);
        var final = d with { Status = "Resolved", Revision = 2, Resolution = new([1], "Frozen source supports the label", Guid.NewGuid(), DateTimeOffset.UtcNow) }; await Stage(final);
        for (var n = 0; n < 12; n++) if ((await Continue(final)).GetProperty("status").GetString() == "Ready") break;
        var expected = PbeReviewRules.Initial(target); foreach (var e in events) expected = PbeReviewRules.Advance(expected, e with { EarnedPoints = 1 }); var corrected = await Proof(); Assert.Equal(expected, corrected.Review); Assert.False(corrected.Provisional);
        Assert.Equal(original, await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.Kind == "pbe-recall-event").OrderBy(r => r.Id).Select(r => r.DataJson).ToListAsync());
        var proofPage = JsonSerializer.SerializeToElement(await replay.Page(final, target, null, default), PbeQuestionBank.Json); Assert.Equal(32, proofPage.GetProperty("items").GetArrayLength()); Assert.All(proofPage.GetProperty("items").EnumerateArray(), item => Assert.Equal(JsonValueKind.Null, item.GetProperty("responseLockedAtUtc").ValueKind));
        await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.Kind == "pbe-evidence-ref").ExecuteDeleteAsync(); await Stage(final);
        var repair = await Continue(final); Assert.Equal("Indexing", repair.GetProperty("stage").GetString()); Assert.False(repair.GetProperty("indexReady").GetBoolean()); Assert.Equal(34, (await Proof()).AcceptedSequence);
        for (var n = 0; n < 12; n++) if ((await Continue(final)).GetProperty("status").GetString() == "Ready") break;
        Assert.Equal(expected, (await Proof()).Review);
    }
}
