using System.Text.Json;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class PbeProgressTests
{
    static readonly Guid Season = Guid.Parse("cccccccc-0000-0000-0000-000000000001"), Target = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001"), Question = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000001");
    static Guid Id(int n) => Guid.Parse($"dddddddd-0000-0000-0000-{n:000000000000}");
    static PbeRecallEvidence E(int n, int points = 0, long at = 1000) => new(Id(n), Target, Question, at, points, 1, true, true);
    [Fact]
    public async Task Accepted_attempt_composes_with_evidence_exact_retry_and_tied_chronology()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var services = factory.Services.CreateScope(); var db = services.ServiceProvider.GetRequiredService<ErudozaDbContext>(); await db.Database.EnsureCreatedAsync(); var org = Guid.NewGuid(); var student = Guid.NewGuid(); var service = new PbeProgressService(db);
        await using (var tx = await db.BeginSerializableTransactionAsync())
        {
            var result = await service.PrepareRecallEvidenceAsync(org, Season, student, "scope-1", [E(1)]); Assert.False(result.Replayed);
            db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = Season, OwnerId = student, Kind = "pbe-test-attempt", Id = Id(1).ToString() }); await db.SaveChangesAsync(); await tx.CommitAsync();
        }
        db.ChangeTracker.Clear(); Assert.True((await service.PrepareRecallEvidenceAsync(org, Season, student, "scope-2", [E(1)])).Replayed);
        await Assert.ThrowsAsync<PbeProgressConflictException>(() => service.PrepareRecallEvidenceAsync(org, Season, student, "scope-1", [E(1, 1)]));
        await using (var tx = await db.BeginSerializableTransactionAsync()) { await service.PrepareRecallEvidenceAsync(org, Season, student, "scope-2", [E(2, 1)]); await db.SaveChangesAsync(); await tx.CommitAsync(); }
        db.ChangeTracker.Clear(); var p = await service.LoadAsync(org, Season, student, [Target], [Question]); Assert.Equal(86401000, p.Reviews.Single().Review.DueAtMs);
        var events = await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.Kind == "pbe-recall-event").OrderBy(r => r.Id).ToListAsync(); Assert.Equal(new[] { 1, 2 }, events.Select(r => JsonDocument.Parse(r.DataJson).RootElement.GetProperty("acceptedSequence").GetInt32()));
        await Assert.ThrowsAsync<PbeProgressConflictException>(() => service.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(3, 1, 999)]));
    }
    [Fact]
    public async Task Stale_concurrent_preparation_rolls_back_losing_caller_attempt()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var sa = factory.Services.CreateScope(); using var sb = factory.Services.CreateScope(); var a = sa.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var b = sb.ServiceProvider.GetRequiredService<ErudozaDbContext>(); await a.Database.EnsureCreatedAsync(); var org = Guid.NewGuid(); var student = Guid.NewGuid(); var x = new PbeProgressService(a); var y = new PbeProgressService(b);
        await x.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(1)]); await a.SaveChangesAsync(); a.ChangeTracker.Clear();
        await x.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(2, 1)]); await y.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(3)]);
        await using (var tx = await a.BeginSerializableTransactionAsync()) { await a.SaveChangesAsync(); await tx.CommitAsync(); }
        await using (var tx = await b.BeginSerializableTransactionAsync())
        {
            b.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = Season, OwnerId = student, Kind = "pbe-test-attempt", Id = Id(3).ToString() }); await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => b.SaveChangesAsync()); await tx.RollbackAsync();
        }
        a.ChangeTracker.Clear(); Assert.False(await a.PbeTrainingRecords.AnyAsync(r => r.OrganizationId == org && r.Kind == "pbe-test-attempt")); Assert.False((await x.LoadAsync(org, Season, student, [Target], [])).Reviews.Single().Review.Unresolved);
    }
    [Fact]
    public async Task Service_is_idempotent_without_creating_successful_recall()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var s = factory.Services.CreateScope(); var db = s.ServiceProvider.GetRequiredService<ErudozaDbContext>(); await db.Database.EnsureCreatedAsync(); var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid(); var e = new PbeServiceEvent(Id(1), Question, [Target], "ShortAnswer", 1000);
        await service.PrepareServiceAsync(org, Season, student, e); await db.SaveChangesAsync(); db.ChangeTracker.Clear(); Assert.True((await service.PrepareServiceAsync(org, Season, student, e)).Replayed);
        await Assert.ThrowsAsync<PbeProgressConflictException>(() => service.PrepareServiceAsync(org, Season, student, e with { AtMs = 1001 })); var p = await service.LoadAsync(org, Season, student, [Target], [Question]); Assert.Empty(p.Reviews); Assert.Equal(1, p.Questions.Single().ServedCount); Assert.Equal(1, p.Targets.Single().ServedCount);
    }
    [Fact]
    public async Task Multipart_events_keep_original_tied_sequences_and_count_only_later_encounters()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid(); var other = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002"); var third = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");
        var events = new[] { new[] { E(1), E(1, 1) with { TargetId = other } }, new[] { E(2, 1) with { TargetId = other } }, new[] { E(3, 1) with { TargetId = other }, E(3, 1) with { TargetId = third } } };
        for (var i = 0; i < events.Length; i++) { await service.PrepareRecallEvidenceAsync(org, Season, student, "s", events[i]); await db.SaveChangesAsync(); db.ChangeTracker.Clear(); var p = await service.LoadAsync(org, Season, student, [Target], []); Assert.Equal(i, p.RecentTargets.Count(t => t.AcceptedSequence > p.Reviews.Single().FailedSequence)); db.ChangeTracker.Clear(); }
    }
    [Fact]
    public async Task First_writer_race_and_service_race_preserve_only_the_atomic_winner()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var sa = factory.Services.CreateScope(); using var sb = factory.Services.CreateScope(); var a = sa.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var b = sb.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var org = Guid.NewGuid(); var student = Guid.NewGuid(); var x = new PbeProgressService(a); var y = new PbeProgressService(b);
        await x.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(1)]); await y.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(2, 1)]); await a.SaveChangesAsync();
        await using (var tx = await b.BeginSerializableTransactionAsync()) { b.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = Season, OwnerId = student, Kind = "pbe-test-attempt", Id = Id(2).ToString() }); await Assert.ThrowsAsync<DbUpdateException>(() => b.SaveChangesAsync()); await tx.RollbackAsync(); }
        a.ChangeTracker.Clear(); b.ChangeTracker.Clear();
        Assert.False(await a.PbeTrainingRecords.AnyAsync(r => r.OrganizationId == org && r.Kind == "pbe-test-attempt"));
        var e = new PbeServiceEvent(Id(3), Question, [Target], "ShortAnswer", 1000); await x.PrepareServiceAsync(org, Season, student, e); await y.PrepareServiceAsync(org, Season, student, e with { ServiceId = Id(4) }); await a.SaveChangesAsync(); await Assert.ThrowsAsync<DbUpdateException>(() => b.SaveChangesAsync()); a.ChangeTracker.Clear(); Assert.Equal(1, (await x.LoadAsync(org, Season, student, [Target], [Question])).Questions.Single().ServedCount);
    }
    [Fact]
    public async Task Projection_queries_remain_bounded_and_scoped_after_excluded_history_growth()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var scope = factory.Services.CreateScope(); var original = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var queries = new List<string>();
        await using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite(original.Database.GetConnectionString()).LogTo(queries.Add, [Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.CommandExecuted]).Options); var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid(); await service.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(1)]); await db.SaveChangesAsync(); db.ChangeTracker.Clear(); queries.Clear();
        Assert.Single((await service.LoadAsync(org, Season, student, [Target], [Question])).Reviews); Assert.Equal(4, queries.Count); db.ChangeTracker.Clear();
        foreach (var kind in new[] { "pbe-recall-event", "pbe-target-review", "pbe-target-service", "pbe-question-service" }) await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO PbeTrainingRecords(OrganizationId,SeasonId,OwnerId,Kind,Id,DataJson,Revision) SELECT {org},{Season},{student},{kind},'excluded-' || value,'{{}}',1 FROM json_each({JsonSerializer.Serialize(Enumerable.Range(0, 10000))})");
        queries.Clear(); var p = await service.LoadAsync(org, Season, student, [Target], [Question]); Assert.Single(p.Reviews); Assert.Empty(p.Targets); Assert.Empty(p.Questions); Assert.Equal(4, queries.Count);
        Assert.All(queries, q => { Assert.Contains("OrganizationId", q); Assert.Contains("SeasonId", q); Assert.Contains("OwnerId", q); Assert.Contains("Kind", q); Assert.Contains("Id", q); });
        Assert.Empty((await service.LoadAsync(org, Season, Guid.NewGuid(), [Target], [Question])).Reviews); Assert.Empty((await service.LoadAsync(org, Guid.NewGuid(), student, [Target], [Question])).Reviews);
    }
    [Fact]
    public async Task Atomic_wrapper_rolls_back_caller_records_and_normalizes_storage_conflicts()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid();
        await service.ExecuteAsync(async ct => await service.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(1)], ct)); db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<PbeProgressConflictException>(() => service.ExecuteAsync(async ct =>
        {
            var result = await service.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(2, 1)], ct);
            db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = Season, OwnerId = student, Kind = "pbe-test-attempt", Id = Id(2).ToString() });
            db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = Season, OwnerId = student, Kind = "pbe-recall-event", Id = $"{student}:{Season}:{Id(1)}" }); return result;
        })); db.ChangeTracker.Clear(); Assert.False(await db.PbeTrainingRecords.AnyAsync(r => r.OrganizationId == org && r.Kind == "pbe-test-attempt")); Assert.True((await service.LoadAsync(org, Season, student, [Target], [])).Reviews.Single().Review.Unresolved);
    }
    [Fact]
    public async Task Shared_literal_thirteen_event_chronology_persists_recognition_aid_delay_and_recovery()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid(); using var fixture = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "pbe/replay-fixtures.json")));
        foreach (var step in fixture.RootElement.GetProperty("events").EnumerateArray())
        {
            var n = step.GetProperty("number").GetInt32(); var e = E(n, step.GetProperty("earned").GetInt32(), step.GetProperty("atMs").GetInt64()) with { Unaided = step.GetProperty("unaided").GetBoolean(), Recall = step.GetProperty("recall").GetBoolean() };
            await service.ExecuteAsync(ct => service.PrepareRecallEvidenceAsync(org, Season, student, "scope-" + n, [e], ct)); db.ChangeTracker.Clear(); var p = (await service.LoadAsync(org, Season, student, [Target], [])).Reviews.Single(); Assert.Equal((n, step.GetProperty("index").GetInt32(), step.GetProperty("due").GetInt64(), step.GetProperty("unresolved").GetBoolean()), (p.AcceptedSequence, p.Review.IntervalIndex, p.Review.DueAtMs, p.Review.Unresolved)); db.ChangeTracker.Clear();
        }
    }
    [Fact]
    public async Task Accepted_question_kind_is_separate_from_view_history_and_included_in_retry_identity()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid();
        await service.ExecuteAsync(ct => service.PrepareRecallEvidenceAsync(org, Season, student, "s", [E(1)], ct, questionKind: "ShortAnswer")); db.ChangeTracker.Clear(); var recognition = E(2, 1) with { Recall = false };
        await service.ExecuteAsync(ct => service.PrepareRecallEvidenceAsync(org, Season, student, "s", [recognition], ct, questionKind: "TrueFalse")); db.ChangeTracker.Clear(); var p = (await service.LoadAsync(org, Season, student, [Target], [])).Reviews.Single(); Assert.Equal("TrueFalse", p.LastAnsweredQuestionKind); Assert.True(p.Review.Unresolved); Assert.Equal(Id(1), p.Review.LastAttemptId);
        await Assert.ThrowsAsync<PbeProgressConflictException>(() => service.PrepareRecallEvidenceAsync(org, Season, student, "s", [recognition], questionKind: "ShortAnswer"));
    }
    [Fact]
    public void Maximum_projection_scope_uses_a_bounded_SQL_Server_parameter_set()
    {
        using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlServer("Server=localhost;Database=translation-only;Trusted_Connection=True;TrustServerCertificate=True").Options);
        var service = new PbeProgressService(db);
        var method = typeof(PbeProgressService).GetMethod("ProjectionRows", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        var query = (IQueryable<PbeTrainingRecord>)method.Invoke(service, [Guid.NewGuid(), Season, Guid.NewGuid(), "pbe-target-review", Enumerable.Range(0, 10000).Select(n => "target-" + n).ToArray()])!;
        var sql = query.ToQueryString();
        Assert.InRange(System.Text.RegularExpressions.Regex.Matches(sql, "DECLARE ").Count, 1, 5);
        Assert.Contains("OPENJSON", sql);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task First_recall_preserves_an_existing_index_readiness_cursor_count_and_revision(bool ready)
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true }; using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var service = new PbeProgressService(db); var org = Guid.NewGuid(); var student = Guid.NewGuid(); var id = $"{student}:{Season}";
        var original = JsonSerializer.Serialize(new PbeEvidenceIndex(id, ready, "saved-legacy-cursor", 17), PbeProgressService.Json);
        db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = Season, OwnerId = student, Kind = "pbe-evidence-index", Id = id, DataJson = original, Revision = 9 }); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        await using (var tx = await db.BeginSerializableTransactionAsync())
        {
            var result = await service.PrepareRecallEvidenceAsync(org, Season, student, "scope", [E(1)]); Assert.Equal(1, result.AcceptedSequence);
            await db.SaveChangesAsync(); await tx.CommitAsync();
        }
        db.ChangeTracker.Clear();
        var index = await db.PbeTrainingRecords.SingleAsync(r => r.OrganizationId == org && r.Kind == "pbe-evidence-index"); Assert.Equal(original, index.DataJson); Assert.Equal(9, index.Revision);
        Assert.Single(await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.Kind == "pbe-evidence-ref").ToListAsync());
        Assert.True((await service.ExecuteAsync(ct => service.PrepareRecallEvidenceAsync(org, Season, student, "scope", [E(1)], ct))).Replayed);
    }

}
