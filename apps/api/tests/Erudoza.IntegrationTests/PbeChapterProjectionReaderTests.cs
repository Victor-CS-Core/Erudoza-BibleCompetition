using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace Erudoza.IntegrationTests;

public sealed class PbeChapterProjectionReaderTests : IClassFixture<ErudozaApiFactory>
{
    readonly ErudozaApiFactory factory;
    readonly ITestOutputHelper output;
    public PbeChapterProjectionReaderTests(ErudozaApiFactory factory, ITestOutputHelper output)
    {
        this.factory = factory;
        this.output = output;
        factory.DisablePracticeTicker = true;
    }
    static readonly CancellationToken Ct = CancellationToken.None;
    static string Json<T>(T value) => JsonSerializer.Serialize(value, PbeQuestionBank.Json);
    static Guid Id(int n) => Guid.Parse($"00000000-0000-0000-0000-{n:000000000000}");
    sealed class Manifest(ErudozaDbContext db)
    {
        public Guid Org { get; } = Guid.NewGuid();
        public Guid Season { get; } = Guid.NewGuid();
        public Guid Student { get; } = Guid.NewGuid();
        public string Generation { get; } = Guid.NewGuid().ToString();
        int page;
        public readonly PbeChapterProjectionReader Reader = new(db);
        public async Task Add(IEnumerable<string> entries, Guid? org = null, Guid? season = null, Guid? student = null, string? generation = null)
        {
            foreach (var chunk in entries.Chunk(64))
                db.PbeTrainingRecords.Add(new PbeTrainingRecord
                {
                    OrganizationId = org ?? Org,
                    SeasonId = season ?? Season,
                    OwnerId = student ?? Student,
                    Kind = "pbe-chapter-manifest",
                    Id = $"{generation ?? Generation}:inputs:{page++:000000}",
                    DataJson = Json(chunk)
                });
            await db.SaveChangesAsync();
        }
        public Task<IReadOnlyList<PbeChapterGroupMetadata>> Groups(string after = "") => Reader.GroupPage(Org, Season, Student, Generation, after, Ct);
        public Task<IReadOnlyList<PbeTarget>> Targets(string group, string after = "") => Reader.GroupTargets(Org, Season, Student, Generation, group, after, Ct);
        public Task<IReadOnlyList<Guid>> Ids(string after = "") => Reader.TargetIds(Org, Season, Student, Generation, after, Ct);
        public Task<IReadOnlyList<PbeCapturedRetention>> Retentions(params Guid[] ids) => Reader.Retentions(Org, Season, Student, Generation, ids, Ct);
        public Task<int> Coverage(string key) => Reader.CoveredPassages(Org, Season, Student, Generation, key, Ct);
        public Task<IReadOnlyDictionary<Guid, int>> Variants(params PbeTarget[] targets) => Reader.VariantCounts(Org, Season, Student, Generation, targets, Ct);
    }
    static string Source(int n, int verse, Guid? pack = null, int? chapter = 1, string book = "GEN") => Json(new object?[] {
        "source", Id(n).ToString().ToUpperInvariant(), (pack ?? Id(9000)).ToString().ToUpperInvariant(), chapter is null ? "Commentary" : "Scripture", book, chapter, chapter is null ? null : verse, n, "citation", "hash" });
    static PbeTarget Target(int n, int[] sources, RecallSkill skill = RecallSkill.FactualRecall, string label = "") => new() { Id = Id(n), SourceUnitIds = sources.Select(Id).ToList(), Skill = skill, Label = label };
    static string TargetEntry(PbeTarget target) => Json(new object[] { "target", target.Id, Json(target) });
    static string Question(int n, int[] sources, string kind, params int[] targets) => Json(new object[] { "question", Id(n), Json(new { id = Id(n), version = 1, sourceUnitIds = sources.Select(Id), kind, ordered = false, parts = targets.Select(t => new { targetId = Id(t), points = 1 }) }) });
    static string Retention(int target, string identity = "captured") => Json(new object[] { "retention", Id(target), Json(new PbeReviewProjection(identity, Id(target), new PbeTargetReview(Id(target), 1, 999, false, null, null, null), 7, null, Id(8800), "ShortAnswer", Retention: PbeChapterRules.InitialRetention())), 12L });
    Manifest Create(IServiceScope scope) => new(scope.ServiceProvider.GetRequiredService<ErudozaDbContext>());

    [Theory]
    [InlineData(1, "1")]
    [InlineData(2, "2")]
    [InlineData(6, "3,3")]
    [InlineData(11, "4,4,3")]
    public async Task Balanced_runs_keep_true_parents_and_nonadditive_spanning_targets(int count, string sizes)
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        await f.Add(Enumerable.Range(1, count).Select(n => Source(n, n)).Append(TargetEntry(Target(100, [1, count]))));
        var groups = await f.Groups(); var parent = Assert.Single(groups, g => g.Kind == "Chapter");
        Assert.Equal($"chapter:{Id(9000)}:GEN:1", parent.Key);
        Assert.Equal(count, parent.AssignedPassages);
        Assert.Equal("GEN 1", parent.Label);
        var children = groups.Where(g => g.Kind == "PassageGroup").ToArray();
        Assert.Equal(sizes, string.Join(',', children.Select(g => g.AssignedPassages)));
        Assert.All(children, g => Assert.Equal(parent.Key, g.ParentChapterKey));
        Assert.Equal(Id(100), Assert.Single(await f.Targets(parent.Key)).Id);
        Assert.Equal(Id(100), Assert.Single(await f.Targets(children[0].Key)).Id);
        Assert.Equal(Id(100), Assert.Single(await f.Targets(children[^1].Key)).Id);
    }
    [Fact]
    public async Task Gaps_packs_and_introductions_remain_separate_and_ordered()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        await f.Add([Source(1, 1), Source(2, 2), Source(3, 4), Source(4, 1, Id(9001)), Source(5, 0, Id(9002), null)]);
        var rows = await f.Groups();
        Assert.Equal(["Chapter", "PassageGroup", "PassageGroup", "Chapter", "PassageGroup", "Introduction"], rows.Select(r => r.Kind));
        Assert.Equal([2, 1, 1], rows.Where(r => r.Kind == "PassageGroup").Select(r => r.AssignedPassages));
        Assert.Equal("GEN 1:1–2", rows[1].Label);
        Assert.Equal($"group:chapter:{Id(9000)}:GEN:1:{Id(1)}:{Id(2)}", rows[1].Key);
        Assert.Equal($"intro:{Id(9002)}", rows[^1].Key);
        Assert.Equal("1 assigned introduction units", rows[^1].ScopeLabel);
        Assert.Equal(rows.OrderBy(r => r.SortKey, StringComparer.Ordinal), rows);
    }
    [Fact]
    public async Task Coverage_is_distinct_and_variants_follow_recall_skill_and_manifest_membership()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        var factual = Target(100, [1, 2]); var exact = Target(101, [1], RecallSkill.ExactWords); var absent = Target(102, [1]);
        await f.Add([Source(1, 1), Source(2, 2), Source(3, 3), TargetEntry(factual), TargetEntry(exact), Question(200, [1, 2], "ShortAnswer", 100, 101), Question(201, [2], "TrueFalse", 100), Question(202, [1], "ExactWords", 100, 101)]);
        var parent = Assert.Single(await f.Groups(), g => g.Kind == "Chapter");
        Assert.Equal(2, await f.Coverage(parent.Key)); Assert.Equal(0, await f.Coverage("unknown"));
        var counts = await f.Variants(factual, exact, absent);
        Assert.Equal(2, counts[factual.Id]); Assert.Equal(1, counts[exact.Id]); Assert.Equal(0, counts[absent.Id]);
        Assert.Empty(await f.Targets("unknown"));
    }
    [Theory]
    [InlineData("org")]
    [InlineData("season")]
    [InlineData("student")]
    [InlineData("generation")]
    public async Task Every_query_binds_exact_manifest_scope(string changed)
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        var mine = Target(100, [1]); var other = Target(101, [2]);
        await f.Add([Source(1, 1), TargetEntry(mine), Retention(100), Question(200, [1], "ShortAnswer", 100)]);
        await f.Add([Source(2, 2), TargetEntry(other), Retention(101), Question(201, [1, 2], "ExactWords", 100, 101)],
            org: changed == "org" ? Guid.NewGuid() : null, season: changed == "season" ? Guid.NewGuid() : null,
            student: changed == "student" ? Guid.NewGuid() : null, generation: changed == "generation" ? f.Generation + "x" : null);
        var parent = Assert.Single(await f.Groups(), g => g.Kind == "Chapter");
        Assert.Equal(1, parent.AssignedPassages); Assert.Equal(Id(100), Assert.Single(await f.Targets(parent.Key)).Id);
        Assert.Equal([Id(100)], await f.Ids()); Assert.Equal(Id(100), Assert.Single(await f.Retentions(Id(100), Id(101))).TargetId);
        Assert.Equal(1, await f.Coverage(parent.Key)); Assert.Equal(1, (await f.Variants(mine))[mine.Id]);
    }
    [Fact]
    public async Task Target_and_source_pages_continue_without_skipping_after_128_rows()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        await f.Add(Enumerable.Range(1, 140).Select(n => Source(n, 1, chapter: n)).Concat(Enumerable.Range(1000, 140).Select(n => TargetEntry(Target(n, [1])))));
        var groups = new List<PbeChapterGroupMetadata>(); string after = "";
        do { var page = await f.Groups(after); Assert.InRange(page.Count, 0, 128); Assert.True(Encoding.UTF8.GetByteCount(Json(page)) <= 65536); if (page.Count == 0) break; groups.AddRange(page); after = page[^1].SortKey; } while (true);
        Assert.Equal(280, groups.Count); Assert.Equal(280, groups.Select(g => g.Key).Distinct().Count());
        var ids = await f.Ids(); Assert.Equal(128, ids.Count); Assert.Equal(Id(1000), ids[0]); Assert.Equal(Id(1127), ids[^1]);
        Assert.Equal(12, (await f.Ids(ids[^1].ToString())).Count);
        var targets = await f.Targets(groups[0].Key); Assert.Equal(128, targets.Count);
        Assert.Equal(12, (await f.Targets(groups[0].Key, targets[^1].Id.ToString())).Count);
    }
    [Fact]
    public async Task Unicode_and_long_target_pages_have_positive_bounded_prefixes_and_lossless_continuation()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope); var label = string.Concat(Enumerable.Repeat("雪😀", 700));
        await f.Add(Enumerable.Range(100, 12).Select(n => TargetEntry(Target(n, [1], label: label))).Prepend(Source(1, 1)));
        var parent = Assert.Single(await f.Groups(), g => g.Kind == "Chapter");
        var all = new List<PbeTarget>(); string after = "";
        do { var page = await f.Targets(parent.Key, after); if (page.Count == 0) break; Assert.True(Encoding.UTF8.GetByteCount(Json(page)) <= 65536); Assert.All(page, t => Assert.Equal(label, t.Label)); all.AddRange(page); after = page[^1].Id.ToString(); } while (true);
        Assert.Equal(12, all.Count); Assert.Equal(12, all.Select(t => t.Id).Distinct().Count());
    }
    [Fact]
    public async Task Retention_lookup_preserves_capture_and_rejects_oversized_explicit_results()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        await f.Add([Retention(100), Retention(101, new string('x', 70000))]);
        var row = Assert.Single(await f.Retentions(Id(100))); Assert.Equal(12, row.Revision); Assert.Equal(7, row.Projection.AcceptedSequence); Assert.Equal("captured", row.Projection.Id);
        Assert.NotNull(row.Projection.Retention); Assert.False(row.Projection.Retention.Practiced);
        var error = await Assert.ThrowsAsync<PbeChapterLimitException>(() => f.Retentions(Id(101))); Assert.Equal("InputTooLarge", error.Reason);
        await Assert.ThrowsAsync<PbeChapterLimitException>(() => f.Retentions(Enumerable.Range(1, 129).Select(Id).ToArray()));
        await Assert.ThrowsAsync<PbeChapterLimitException>(() => f.Variants(Enumerable.Range(1, 129).Select(n => Target(n, [1])).ToArray()));
    }
    [Fact]
    public async Task Oversized_first_target_or_group_fails_explicitly()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        await f.Add([Source(1, 1), TargetEntry(Target(100, [1], label: new string('x', 70000)))]);
        var parent = Assert.Single(await f.Groups(), g => g.Kind == "Chapter");
        await Assert.ThrowsAsync<PbeChapterLimitException>(() => f.Targets(parent.Key));
        var other = Create(scope); await other.Add([Source(1, 1, book: new string('雪', 20000))]);
        await Assert.ThrowsAsync<PbeChapterLimitException>(() => other.Groups());
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int Trace(uint kind, IntPtr context, IntPtr statement, IntPtr elapsed);
    [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_trace_v2(IntPtr connection, uint mask, Trace? callback, IntPtr context);
    [DllImport("e_sqlite3", CallingConvention = CallingConvention.Cdecl)]
    static extern int sqlite3_stmt_status(IntPtr statement, int operation, int reset);

    [Fact]
    public async Task Variant_cost_does_not_repeat_unrelated_manifest_expansion_per_requested_target()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope); var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var targets = Enumerable.Range(100, 128).Select(n => Target(n, [1])).ToArray();
        await f.Add([Source(1, 1)]); await f.Add(targets.Select(TargetEntry));
        await f.Add(targets.SelectMany((t, n) => new[] { Question(1000 + n * 2, [1], "ShortAnswer", 100 + n), Question(1001 + n * 2, [1], "ShortAnswer", 100 + n) }));
        await f.Add(Enumerable.Range(10000, 6400).Select(n => Retention(n)));
        var connection = (SqliteConnection)db.Database.GetDbConnection(); await connection.OpenAsync(); var handle = connection.Handle!.DangerousGetHandle();
        var steps = new List<int>(); Trace trace = (_, _, statement, _) => { steps.Add(sqlite3_stmt_status(statement, 4, 0)); return 0; };
        Assert.Equal(0, sqlite3_trace_v2(handle, 2, trace, IntPtr.Zero)); var watch = Stopwatch.StartNew();
        try
        {
            Assert.Equal(2, (await f.Variants(targets[0]))[targets[0].Id]); var oneMs = watch.ElapsedMilliseconds; watch.Restart();
            var many = await f.Variants(targets); Assert.Equal(128, many.Count); Assert.All(many.Values, n => Assert.Equal(2, n));
            output.WriteLine($"variant-cost: unrelatedRetentionPages=100; oneTargetVmSteps={steps[0]}; all128VmSteps={steps[1]}; oneMs={oneMs}; all128Ms={watch.ElapsedMilliseconds}");
            Assert.Equal(2, steps.Count); Assert.True(steps[1] < steps[0] * 4L, $"128 targets repeated manifest expansion: {steps[1]} VM steps versus {steps[0]} for one target.");
        }
        finally { sqlite3_trace_v2(handle, 0, null, IntPtr.Zero); GC.KeepAlive(trace); }
    }

    [Fact]
    public async Task Capped_large_manifest_returns_small_pages_while_exposing_real_SQLite_work()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        await f.Add(Enumerable.Range(1, 5000).Select(n => Source(n, (n - 1) % 5 + 1, chapter: (n - 1) / 5 + 1))
            .Concat(Enumerable.Range(10000, 2000).Select(n => TargetEntry(Target(n, [1, 5000]))))
            .Concat(Enumerable.Range(20000, 20).Select(n => Question(n, [1, 5000], "ShortAnswer", 10000)))
            .Concat(Enumerable.Range(10000, 64).Select(n => Retention(n))));
        var connection = (SqliteConnection)db.Database.GetDbConnection(); await connection.OpenAsync();
        var handle = connection.Handle!.DangerousGetHandle();
        var stats = new List<(int FullScanSteps, int VmSteps, int Sorts)>();
        Trace trace = (_, _, statement, _) => { stats.Add((sqlite3_stmt_status(statement, 1, 0), sqlite3_stmt_status(statement, 4, 0), sqlite3_stmt_status(statement, 2, 0))); return 0; };
        Assert.Equal(0, sqlite3_trace_v2(handle, 2, trace, IntPtr.Zero));
        var watch = Stopwatch.StartNew();
        try
        {
            var groups = await f.Groups(); var targets = await f.Targets($"chapter:{Id(9000)}:GEN:1");
            var coverage = await f.Coverage($"chapter:{Id(9000)}:GEN:1"); var variants = await f.Variants(Target(10000, [1, 5000]));
            var ids = await f.Ids(); var retentions = await f.Retentions(Enumerable.Range(10000, 64).Select(Id).ToArray());
            Assert.InRange(groups.Count, 1, 128); Assert.Equal(128, targets.Count); Assert.Equal(1, coverage); Assert.Equal(20, variants[Id(10000)]);
            Assert.Equal(128, ids.Count); Assert.Equal(64, retentions.Count);
            foreach (var (name, count, bytes) in new[] { ("groups", groups.Count, Encoding.UTF8.GetByteCount(Json(groups))), ("targets", targets.Count, Encoding.UTF8.GetByteCount(Json(targets))), ("ids", ids.Count, Encoding.UTF8.GetByteCount(Json(ids))), ("retentions", retentions.Count, Encoding.UTF8.GetByteCount(Json(retentions))) })
            { Assert.InRange(bytes, 2, 65536); output.WriteLine($"{name}: rows={count}; serializedUtf8Bytes={bytes}"); }
            Assert.Equal(6, stats.Count);
            for (var i = 0; i < stats.Count; i++) output.WriteLine($"query{i + 1}: fullScanSteps={stats[i].FullScanSteps}; vmSteps={stats[i].VmSteps}; sorts={stats[i].Sorts}");
            output.WriteLine($"fixture: sources=5000; targets=2000; questions=20; retentions=64; elapsedMs={watch.ElapsedMilliseconds}");
        }
        finally { sqlite3_trace_v2(handle, 0, null, IntPtr.Zero); GC.KeepAlive(trace); }
    }
    [Fact]
    public async Task Queries_share_the_callers_transaction_and_rollback()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        await f.Add([TargetEntry(Target(100, [1]))]);
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await f.Add([TargetEntry(Target(101, [1]))]);
            Assert.Equal([Id(100), Id(101)], await f.Ids());
            await transaction.RollbackAsync();
        }
        Assert.Equal([Id(100)], await f.Ids());
    }
    [Fact]
    public async Task Explicit_retention_lookup_rejects_total_overflow_without_a_partial_success()
    {
        using var scope = factory.Services.CreateScope(); var f = Create(scope);
        await f.Add(Enumerable.Range(100, 20).Select(n => Retention(n, new string('x', 4000))));
        Assert.Single(await f.Retentions(Id(100)));
        var ids = Enumerable.Range(100, 20).Select(Id).ToArray();
        await Assert.ThrowsAsync<PbeChapterLimitException>(() => f.Retentions(ids));
        var prefix = await f.Reader.RetentionPage(f.Org, f.Season, f.Student, f.Generation, ids, Ct);
        Assert.InRange(prefix.Count, 1, ids.Length - 1); Assert.Equal(ids.Take(prefix.Count), prefix.Select(r => r.TargetId));
        Assert.InRange(Encoding.UTF8.GetByteCount(Json(prefix)), 1, 65536);
        var suffix = await f.Reader.RetentionPage(f.Org, f.Season, f.Student, f.Generation, ids.Skip(prefix.Count).ToArray(), Ct);
        Assert.Equal(ids, prefix.Concat(suffix).Select(r => r.TargetId));
    }
}
