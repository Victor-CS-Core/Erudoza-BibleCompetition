using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class PbeChapterLimitException(string reason) : Exception(reason) { public string Reason { get; } = reason; }
public sealed class PbeChapterConflictException(string code) : Exception(code) { public string Code { get; } = code; }

/// <summary>Owned resumable chapter projection. Every publication revalidates the exact input set under the shared serializable transaction.</summary>
public sealed class PbeChapterProgressService(IErudozaDbContext db, IClock clock,
    PbeSourceResolver resolver, PbeProgressService progress, PbeEvidenceReplayService replay, IPbeChapterJsonReader jsonReader, IPbeChapterProjectionReader projectionReader)
{
    public const string RuleVersion = "pbe-chapter-v1";
    public const string GroupRuleVersion = "pbe-passage-groups-v1";
    const int PageRows = 128, PageBytes = 65536, StagingBytes = 16 * 1024 * 1024;
    static readonly JsonSerializerOptions Json = new(PbeQuestionBank.Json) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public sealed record Work(int SchemaVersion, string Id, string State, string? Stage, string? Reason, string? ScopeVersion,
        DateTimeOffset AsOfUtc, DateTimeOffset DueRefreshAtUtc, int InputOffset, int InputPages, int StagedBytes,
        int RowOffset, string? SnapshotId, string? AbandonedId = null, int ProofOffset = 0, int ProofPages = 0, string? ProofFingerprint = null, string CapturePhase = "scope", string After = "", int FamilyRows = 0, int SourceCount = 0, int ScriptureCount = 0, string GroupAfter = "", Aggregate? Aggregate = null, int ProofBytes = 0);
    public sealed record Aggregate(PbeChapterGroupMetadata Group, string TargetAfter, PbeChapterCounts Counts, bool Updating, bool Repair);
    public sealed record StoredProjection(PbeProgressRow Row, string EvidenceFingerprint);
    public sealed record Stamp(PbeStampSummary Summary, string ProofGenerationId, string ProofFamily, int TargetCount, int QualifyingAttemptCount, int ProofPageCount, string ProofHash);
    public sealed record WitnessEntry(Guid TargetId, IReadOnlyList<PbeRetentionCandidate> Witness);
    public sealed record WitnessPage(string GenerationId, string Family, IReadOnlyList<WitnessEntry> Entries, string Hash);
    sealed record ChapterInventory(Guid ContentPackId, string BookKey, int Chapter, int Count);
    sealed record Input(string[] Entries, PbeSourceScope Sources, PbeBank Bank, IReadOnlyList<Group> Groups, string ScopeVersion);
    sealed record Group(string Key, string? ParentChapterKey, string Kind, string Label, string ScopeLabel, Guid Pack,
        string Book, int? Chapter, bool? Whole, IReadOnlyList<Guid> Sources);
    sealed record Cursor(Guid OrganizationId, Guid StudentId, Guid SeasonId, string View, string? Parent, string? Snapshot, string After);
    static string Owner(Guid student, Guid season) => $"{student}:{season}";
    static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Json);
    static T Read<T>(PbeTrainingRecord row) => JsonSerializer.Deserialize<T>(row.DataJson, Json)!;
    IQueryable<PbeTrainingRecord> Rows(Guid org, Guid student, Guid season, string kind) => db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == student && r.Kind == kind);
    Task<PbeTrainingRecord?> Get(Guid org, Guid student, Guid season, string kind, string id, CancellationToken ct) => Rows(org, student, season, kind).SingleOrDefaultAsync(r => r.Id == id, ct);
    void Write(Guid org, Guid student, Guid season, string kind, string id, object value, PbeTrainingRecord? row = null)
    {
        var json = Serialize(value);
        if (Encoding.UTF8.GetByteCount(json) > PageBytes) throw new PbeChapterLimitException("InputTooLarge");
        if (row is null) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, OwnerId = student, Kind = kind, Id = id, DataJson = json });
        else { row.DataJson = json; row.Revision++; }
    }
    Task<string?> Admission(Guid org, Guid student, Guid season, CancellationToken ct)
        => resolver.ChapterAdmission(org, season, student, ct);
    async Task<Input> Capture(Guid org, Guid student, Guid season, CancellationToken ct)
    {
        var sources = await resolver.ReadChapterSources(org, season, student, ct);
        var allowed = sources.Sources.ToDictionary(s => s.Id);
        var ids = allowed.Keys.ToArray();
        var entries = (await CurrentControls(org, student, season, ct)).ToList();
        // Actual publication/current GET is the full-set validation exception. Cap each raw family
        // before filtering; retain validated metadata, never a second question/answer bank.
        var targetMap = new Dictionary<Guid, PbeTarget>(); var questions = new List<PbeQuestion>();
        var bankGuards = new List<(string Kind, string Id, string Entry)>();
        foreach (var kind in new[] { "pbe-target", "pbe-question-head" })
        {
            var count = 0;
            foreach (var sourceBatch in ids.Chunk(1000))
            {
                var query = db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == kind && r.OwnerId.HasValue && sourceBatch.Contains(r.OwnerId.Value));
                {
                    var page = await query.OrderBy(r => r.Id).Take(10001 - count).ToListAsync(ct);
                    count += page.Count;
                    if (count > 10000) throw new PbeChapterLimitException("ScopeTooLarge");
                    foreach (var row in page)
                    {
                        bankGuards.Add((kind, row.Id, BankGuard(row)));
                        if (kind == "pbe-target")
                        {
                            var target = Read<PbeTarget>(row);
                            try { PbeRubric.ValidateTarget(target); if (target.SourceUnitIds.All(allowed.ContainsKey)) targetMap[target.Id] = new() { Id = target.Id, SourceUnitIds = target.SourceUnitIds, Skill = target.Skill, Label = "Captured target" }; }
                            catch (ArgumentException) { }
                            continue;
                        }
                        var head = Read<PbeBankQuestionData>(row); var q = head.Question;
                        if (!head.Published || head.SeasonId != season || q.SchemaVersion != 2 || q.SourceUnitIds.Any(id => !allowed.TryGetValue(id, out var source) || source.ContentPackId != q.ContentPackId || source.SourceKind != q.SourceKind)) continue;
                        try
                        {
                            PbeRubric.Validate(q, q.Parts.Select(p => p.TargetId).Distinct().Where(targetMap.ContainsKey).Select(id => targetMap[id]).ToArray());
                            if (PbeQuestionBank.SourceProof(q, allowed) == head.SourceFingerprint)
                                questions.Add(new()
                                {
                                    SchemaVersion = q.SchemaVersion,
                                    Id = q.Id,
                                    Version = q.Version,
                                    ContentPackId = q.ContentPackId,
                                    SourceUnitId = q.SourceUnitId,
                                    SourceUnitIds = q.SourceUnitIds,
                                    SourceKind = q.SourceKind,
                                    Kind = q.Kind,
                                    Ordered = q.Ordered,
                                    Parts = q.Parts.Select(p => new PbeQuestionPart { TargetId = p.TargetId, Points = p.Points }).ToList()
                                });
                        }
                        catch (ArgumentException) { }
                        catch (DomainException) { }
                    }
                }
            }
        }
        var targets = targetMap.Values.ToArray();
        entries.AddRange(sources.Sources.OrderBy(s => s.Id.ToString(), StringComparer.Ordinal).Select(s => SourceEntry(s)));
        entries.AddRange(bankGuards.OrderBy(r => r.Kind, StringComparer.Ordinal).ThenBy(r => r.Id, StringComparer.Ordinal).Select(r => r.Entry));
        var assignedScripture = resolver.ChapterScriptureQuery(org, season, student);
        var inventory = await db.SourceUnits.AsNoTracking().Where(s => s.IsActive && !s.IsRetired && assignedScripture.Any(a => a.ContentPackId == s.ContentPackId && a.BookKey == s.BookKey && a.Chapter == s.Chapter))
            .GroupBy(s => new { s.ContentPackId, s.BookKey, s.Chapter }).Select(g => new ChapterInventory(g.Key.ContentPackId, g.Key.BookKey, g.Key.Chapter, g.Count())).ToListAsync(ct);
        if (entries.Any(e => Encoding.UTF8.GetByteCount(Serialize(new[] { e })) > PageBytes) || entries.Sum(e => Encoding.UTF8.GetByteCount(e) + 8) > StagingBytes) throw new PbeChapterLimitException("InputTooLarge");
        var groups = Groups(sources.Sources, (pack, book, chapter) => inventory.SingleOrDefault(x => x.ContentPackId == pack && x.BookKey == book && x.Chapter == chapter)?.Count ?? 0);
        var controls = entries.Select(e => JsonSerializer.Deserialize<JsonElement>(e)).Where(e => e[0].GetString() == "control").ToArray();
        var assignmentTuples = controls.Where(e => e[1].GetString() == "assignment-scope").Select(e => new object?[] { "assignment", e[3].GetGuid(), e[4].GetGuid(), e[5].GetString(), e[6].GetInt32(), e[7].GetInt32(), e[8].GetInt32(), e[9].GetInt32() })
            .Concat(controls.Where(e => e[1].GetString() == "intro-assignment").Select(e => new object?[] { "pbe-introduction-assignment", e[2].GetString(), e[4].GetGuid(), null, null, null, null, null }))
            .OrderBy(a => a[0]!.ToString(), StringComparer.Ordinal).ThenBy(a => a[1]!.ToString(), StringComparer.Ordinal).ThenBy(Serialize, StringComparer.Ordinal).ToArray();
        var version = Hash(Serialize(new object[] { RuleVersion, GroupRuleVersion, season, student,
            sources.Sources.OrderBy(s => s.Id.ToString(), StringComparer.Ordinal).Select(s => new object?[] { s.Id, s.ContentPackId, s.SourceKind.ToString(), s.BookKey, s.Chapter, s.Verse, s.Ordinal, s.CitationLabel, Hash(s.CanonicalText) }).ToArray(),
            targets.OrderBy(t => t.Id.ToString(), StringComparer.Ordinal).Select(t => new object[] { t.Id, t.SourceUnitIds.OrderBy(id => id.ToString(), StringComparer.Ordinal).ToArray(), t.Skill.ToString() }).ToArray(),
            questions.OrderBy(q => q.Id.ToString(), StringComparer.Ordinal).ThenBy(q => q.Version).Select(q => new object[] { q.Id, q.Version, q.SourceUnitIds.OrderBy(id => id.ToString(), StringComparer.Ordinal).ToArray(), q.Kind.ToString(), q.Ordered, q.Parts.Select(p => new object[] { p.TargetId, p.Points }).ToArray() }).ToArray(),
            assignmentTuples }));
        return new(entries.ToArray(), sources, new(questions, targets, []), groups, version);
    }
    static IReadOnlyList<Group> Groups(IReadOnlyList<PbeSourceUnit> sources, Func<Guid, string, int, int> inventory)
    {
        var result = new List<Group>();
        foreach (var parent in sources.GroupBy(s => (s.ContentPackId, s.BookKey, Chapter: s.SourceKind == PbeSourceKind.Scripture ? s.Chapter : null, s.SourceKind)).OrderBy(g => g.Key.BookKey, StringComparer.Ordinal).ThenBy(g => g.Key.Chapter ?? int.MaxValue).ThenBy(g => g.Key.ContentPackId))
        {
            var scripture = parent.Key.SourceKind == PbeSourceKind.Scripture;
            var sorted = parent.OrderBy(s => s.Verse ?? s.Ordinal).ThenBy(s => s.Id).ToArray();
            var key = scripture ? $"chapter:{parent.Key.ContentPackId}:{parent.Key.BookKey}:{parent.Key.Chapter}" : $"intro:{parent.Key.ContentPackId}";
            var whole = scripture && inventory(parent.Key.ContentPackId, parent.Key.BookKey, parent.Key.Chapter!.Value) == sorted.Length;
            var label = scripture ? $"{parent.Key.BookKey} {parent.Key.Chapter}" : $"{parent.Key.BookKey} introduction";
            var scopeLabel = scripture ? whole ? "Whole assigned chapter" : "Assigned passages" : "Assigned introduction units";
            result.Add(new(key, null, scripture ? "Chapter" : "Introduction", label, scopeLabel, parent.Key.ContentPackId, parent.Key.BookKey, parent.Key.Chapter, scripture ? whole : null, sorted.Select(s => s.Id).ToArray()));
            if (!scripture) continue;
            var runs = new List<List<PbeSourceUnit>>();
            foreach (var source in sorted)
            {
                if (runs.Count == 0 || source.Verse != runs[^1][^1].Verse + 1) runs.Add([]);
                runs[^1].Add(source);
            }
            foreach (var run in runs)
            {
                var count = (run.Count + 4) / 5; var size = run.Count / count; var extra = run.Count % count; var offset = 0;
                for (var i = 0; i < count; i++)
                {
                    var units = run.Skip(offset).Take(size + (i < extra ? 1 : 0)).ToArray(); offset += units.Length;
                    result.Add(new($"group:{key}:{units[0].Id}:{units[^1].Id}", key, "PassageGroup", $"{label}:{units[0].Verse}" + (units.Length > 1 ? $"–{units[^1].Verse}" : ""), "Assigned passages", parent.Key.ContentPackId, parent.Key.BookKey, parent.Key.Chapter, null, units.Select(s => s.Id).ToArray()));
                }
            }
        }
        return result;
    }
    static PbeChapterWork Public(Work? work, string? reason = null) => reason is not null ? new(work?.Id, "Blocked", null, reason) : work is null ? new(null, "NotStarted", null, null) : new(work.Id, work.State, work.Stage, work.Reason);
    static string Encode(Cursor cursor) => Convert.ToBase64String(Encoding.UTF8.GetBytes(Serialize(cursor)));
    static Cursor? Decode(string? after, Guid org, Guid student, Guid season, string view, string? parent)
    {
        if (after is null) return null;
        try
        {
            if (after.Length > 4096) throw new FormatException();
            var cursor = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(after), Json)!;
            if (cursor.OrganizationId != org || cursor.StudentId != student || cursor.SeasonId != season || cursor.View != view || cursor.Parent != parent) throw new FormatException();
            return cursor;
        }
        catch (Exception e) when (e is FormatException or JsonException) { throw new DomainException("Invalid chapter cursor."); }
    }
    public async Task<PbeChapterPage> Page(Guid org, Guid student, Guid season, string? view, string? chapterKey, string? after, int? limit, CancellationToken ct)
    {
        view ??= "Chapters"; var take = limit ?? 32;
        if (view is not ("Chapters" or "Groups" or "Stamps") || take is < 1 or > 32 || chapterKey?.Length > 1000 || view == "Groups" && chapterKey is null) throw new DomainException("Invalid chapter page.");
        var admission = await Admission(org, student, season, ct);
        var saved = await Get(org, student, season, "pbe-chapter-work", Owner(student, season), ct); var work = saved is null ? null : Read<Work>(saved);
        var history = await Rows(org, student, season, "pbe-chapter-stamp").AnyAsync(ct);
        var cursor = Decode(after, org, student, season, view, chapterKey);
        Input? input = null;
        if (admission is null && work is not null)
        {
            try { input = await Capture(org, student, season, ct); if (input.Sources.Sources.Count == 0) admission = "NoAssignment"; }
            catch (PbeChapterLimitException e) { admission = e.Reason; }
        }
        var current = admission is null && input is not null && work?.State == "Complete" && work.ScopeVersion == input.ScopeVersion;
        if (view != "Stamps" && cursor is not null && (!current || cursor.Snapshot != work?.SnapshotId)) throw new PbeChapterConflictException("PBE_CHAPTER_CURSOR_STALE");
        var items = new List<object>(); string? next = null;
        if (view == "Stamps")
        {
            var query = Rows(org, student, season, "pbe-chapter-stamp").AsNoTracking();
            if (cursor is not null) query = query.Where(r => string.Compare(r.Id, cursor.After) > 0);
            // Chapter filter is applied with a bounded indexed scan; cursor advances through nonmatching identities.
            var rows = await query.OrderBy(r => r.Id).Take(take + 1).ToListAsync(ct);
            foreach (var row in rows.Take(take))
            {
                var summary = Read<Stamp>(row).Summary;
                if (chapterKey is null || summary.ChapterKey == chapterKey) items.Add(summary with { MatchesCurrentScope = input is null || admission is not null ? null : summary.ScopeVersion == input.ScopeVersion });
            }
            if (rows.Count > take) next = Encode(new(org, student, season, view, chapterKey, null, rows[take - 1].Id));
        }
        else if (current)
        {
            if (view == "Groups" && !input!.Groups.Any(g => g.Kind == "Chapter" && g.Key == chapterKey)) throw new PbeChapterConflictException("PBE_CHAPTER_CURSOR_STALE");
            var prefix = work!.SnapshotId + ":";
            var query = Rows(org, student, season, "pbe-chapter-projection").AsNoTracking().Where(r => r.Id.StartsWith(prefix));
            if (cursor is not null) query = query.Where(r => string.Compare(r.Id, cursor.After) > 0);
            var rows = await query.OrderBy(r => r.Id).Take(129).ToListAsync(ct); string? last = null;
            var allProofs = await jsonReader.CurrentRetentions(org, season, student, work.Id, ct);
            foreach (var row in rows.Take(128))
            {
                var stored = Read<StoredProjection>(row);
                if (view == "Chapters" ? stored.Row.Kind == "PassageGroup" : stored.Row.ParentChapterKey != chapterKey) { last = row.Id; continue; }
                var group = input!.Groups.Single(g => g.Key == stored.Row.Key);
                var targetIds = Targets(input, group).ToHashSet();
                var proofs = allProofs.Where(r => targetIds.Contains(Read<PbeReviewProjection>(r).TargetId)).ToArray();
                var value = EvidenceFingerprint(proofs) == stored.EvidenceFingerprint ? stored.Row : stored.Row with { CurrentReadiness = "Updating", Actions = [] };
                if (Encoding.UTF8.GetByteCount(Serialize(items.Append(value))) > PageBytes - 4096) break;
                items.Add(value); last = row.Id;
                if (items.Count == take) break;
            }
            if (last is not null && (rows.Count > 128 || last != rows.LastOrDefault()?.Id)) next = Encode(new(org, student, season, view, chapterKey, work.SnapshotId, last));
        }
        return new(season, RuleVersion, current ? work!.ScopeVersion : null, current ? work!.SnapshotId : null, chapterKey,
            Public(work, admission), current, history, current ? work!.AsOfUtc : null, current ? work!.DueRefreshAtUtc : null, next, view, items);
    }
    static Guid[] Targets(Input input, Group group)
    {
        var sources = group.Sources.ToHashSet(); return input.Bank.Targets.Where(t => t.SourceUnitIds.Any(sources.Contains)).Select(t => t.Id).ToArray();
    }
    async Task<List<PbeTrainingRecord>> TargetRows(Guid org, Guid student, Guid season, IReadOnlyList<Guid> targets, CancellationToken ct)
    {
        var ids = targets.Select(t => $"{Owner(student, season)}:{t}").ToArray();
        var rows = new List<PbeTrainingRecord>();
        foreach (var batch in ids.Chunk(400)) rows.AddRange(await Rows(org, student, season, "pbe-target-review").AsNoTracking().Where(r => batch.Contains(r.Id)).OrderBy(r => r.Id).ToListAsync(ct));
        return rows;
    }
    static string EvidenceFingerprint(IReadOnlyList<PbeTrainingRecord> rows) => Hash(Serialize(rows.OrderBy(r => r.Id, StringComparer.Ordinal).Select(r => new object[] { r.Id, r.Revision, Hash(r.DataJson) }).ToArray()));
    public Task<ContinueChaptersResponse> Continue(Guid org, Guid student, ContinueChaptersRequest request, CancellationToken ct)
        => progress.ExecuteAsync(async token =>
        {
            var season = request.SeasonId; var admission = await Admission(org, student, season, token);
            var pointer = await Get(org, student, season, "pbe-chapter-work", Owner(student, season), token);
            var work = pointer is null ? null : Read<Work>(pointer);
            if (request.WorkId is not null && (request.WorkId != work?.Id || work?.State == "Blocked")) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
            if (admission is not null) return new ContinueChaptersResponse(season, null, Public(work, admission), "None");
            try
            {
                if (work?.State == "Complete")
                {
                    // Readback validation of an already published snapshot is the same explicit exception as GET.
                    var current = await Capture(org, student, season, token);
                    if (current.ScopeVersion == work.ScopeVersion && clock.UtcNow < work.DueRefreshAtUtc && !await EvidenceChanged(org, student, season, work, current, token))
                        return new ContinueChaptersResponse(season, work.ScopeVersion, Public(work), "Reload");
                    if (request.WorkId is not null && current.ScopeVersion != work.ScopeVersion) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
                    work = NewWork(work);
                }
                else if (work?.State == "Blocked" && request.WorkId is null) work = NewWork(work);
                else work ??= NewWork(null);
                work = await Step(org, student, season, work, token);
            }
            catch (PbeChapterConflictException) when (request.WorkId is null)
            {
                // A lost response or stale captured set is recoverable by the bootstrap contract.
                work = NewWork(work);
            }
            catch (PbeChapterLimitException e)
            {
                work ??= NewWork(null); work = work with { State = "Blocked", Stage = null, Reason = e.Reason };
            }
            Write(org, student, season, "pbe-chapter-work", Owner(student, season), work!, pointer);
            return new ContinueChaptersResponse(season, work!.ScopeVersion, Public(work), work.State == "Complete" ? "Reload" : work.State == "Blocked" ? "None" : "Continue");
        }, ct);
    Work NewWork(Work? previous)
    {
        if (previous?.AbandonedId is not null) return previous with { State = "Working", Stage = "Cleanup", Reason = null };
        var now = clock.UtcNow;
        return new(1, Guid.NewGuid().ToString(), "Working", "Indexing", null, null, now, now.AddMinutes(5), 0, 0, 0, 0, null, previous?.Id);
    }
    Work SaveInputPage(Guid org, Guid student, Guid season, Work work, IReadOnlyList<string> entries)
    {
        var bytes = Encoding.UTF8.GetByteCount(Serialize(entries));
        if (entries.Count > PageRows || bytes > PageBytes || work.StagedBytes + bytes > StagingBytes) throw new PbeChapterLimitException("InputTooLarge");
        Write(org, student, season, "pbe-chapter-manifest", $"{work.Id}:inputs:{work.InputPages:D6}", entries);
        return work with { InputPages = work.InputPages + 1, InputOffset = work.InputOffset + entries.Count, StagedBytes = work.StagedBytes + bytes };
    }
    static IReadOnlyList<T> FitPage<T>(IEnumerable<T> values, Func<T, IEnumerable<string>> entries)
    {
        var result = new List<T>(); var all = new List<string>();
        foreach (var value in values)
        {
            var next = all.Concat(entries(value)).ToArray();
            if (next.Length > PageRows || Encoding.UTF8.GetByteCount(Serialize(next)) > PageBytes) break;
            all = next.ToList(); result.Add(value);
        }
        if (result.Count == 0 && values.Any()) throw new PbeChapterLimitException("InputTooLarge");
        return result;
    }
    async Task<Work> Step(Guid org, Guid student, Guid season, Work work, CancellationToken ct)
    {
        if (work.State == "Blocked") return work;
        if (work.AbandonedId is not null)
        {
            if (await Cleanup(org, student, season, work.AbandonedId, ct)) return work with { Stage = "Cleanup" };
            work = work with { AbandonedId = null, Stage = "Indexing" };
        }
        if (ControlFamilies.Contains(work.CapturePhase))
        {
            var rows = await ControlPage(org, student, season, work.CapturePhase, work.After, PageRows + 1, ct);
            var page = FitPage(rows.Take(PageRows), r => new[] { r.Entry });
            if (work.FamilyRows + page.Count > 10000) throw new PbeChapterLimitException("ScopeTooLarge");
            work = SaveInputPage(org, student, season, work, page.Select(r => r.Entry).ToArray()) with { After = page.LastOrDefault().Id ?? work.After, FamilyRows = work.FamilyRows + page.Count };
            if (page.Count == rows.Count)
            {
                var next = Array.IndexOf(ControlFamilies, work.CapturePhase) + 1;
                work = work with { CapturePhase = next < ControlFamilies.Length ? ControlFamilies[next] : "sources", After = "", FamilyRows = 0 };
            }
            return work;
        }
        if (work.CapturePhase == "sources")
        {
            var scripture = await resolver.ChapterScripturePage(org, season, student, work.After, PageRows, ct);
            var introductions = await jsonReader.IntroductionPage(org, season, student, work.After, PageRows, ct);
            // Either family can stop at its byte prefix. Never advance past its last returned ID while it may have unseen rows.
            var frontier = new[] { scripture.LastOrDefault()?.Id.ToString(), introductions.LastOrDefault()?.Id.ToString() }.Where(id => id is not null).OrderBy(id => id, StringComparer.Ordinal).FirstOrDefault();
            var all = scripture.Concat(introductions).Where(s => string.CompareOrdinal(s.Id.ToString(), frontier) <= 0).OrderBy(s => s.Id.ToString(), StringComparer.Ordinal).Take(PageRows).ToArray();
            var page = FitPage(all.Take(PageRows), s => new[] { SourceEntry(s) });
            var sourceCount = work.SourceCount + page.Count; var scriptureCount = work.ScriptureCount + page.Count(s => s.SourceKind == PbeSourceKind.Scripture);
            if (sourceCount > 10000 || scriptureCount > 5000) throw new PbeChapterLimitException("ScopeTooLarge");
            work = SaveInputPage(org, student, season, work, page.Select(SourceEntry).ToArray()) with { SourceCount = sourceCount, ScriptureCount = scriptureCount, After = page.LastOrDefault()?.Id.ToString() ?? work.After };
            if (all.Length == 0) work = work with { CapturePhase = "targets", After = "", FamilyRows = 0 };
            if (sourceCount == 0 && all.Length == 0) work = work with { State = "Blocked", Stage = null, Reason = "NoAssignment" };
            return work;
        }
        if (work.CapturePhase is "targets" or "questions") return await BankStep(org, student, season, work, ct);
        if (work.CapturePhase == "replay")
        {
            var ids = await projectionReader.TargetIds(org, season, student, work.Id, work.After, ct);
            if (ids.Count == 0) return work with { CapturePhase = "retentions", After = "", Stage = "Projecting" };
            var step = await replay.ContinueTargets(new(org, season, student), ids, ct);
            return work with { Stage = "Replaying", After = step.Status == "Ready" ? ids[^1].ToString() : work.After };
        }
        if (work.CapturePhase == "retentions")
        {
            var rows = await jsonReader.CurrentRetentionPage(org, season, student, work.Id, work.After, ct);
            if (rows.Count == 0) return work with { CapturePhase = "seal", After = "" };
            var ids = rows.Select(r => Read<PbeReviewProjection>(r).TargetId).ToArray();
            var byTarget = rows.ToDictionary(r => Read<PbeReviewProjection>(r).TargetId);
            var page = FitPage(ids, id => new[] { Serialize(new object[] { "retention", id, byTarget[id].DataJson, byTarget[id].Revision }) });
            foreach (var id in page)
            {
                var projection = Read<PbeReviewProjection>(byTarget[id]);
                if (projection.Retention?.RuleVersion != PbeChapterRules.RetentionRuleVersion) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
                if (projection.Review.DueAtMs > work.AsOfUtc.ToUnixTimeMilliseconds() && projection.Review.DueAtMs < work.DueRefreshAtUtc.ToUnixTimeMilliseconds()) work = work with { DueRefreshAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(projection.Review.DueAtMs) };
            }
            return SaveInputPage(org, student, season, work, page.Select(id => Serialize(new object[] { "retention", id, byTarget[id].DataJson, byTarget[id].Revision })).ToArray()) with { After = page[^1].ToString() };
        }
        if (work.CapturePhase == "seal") return work with { CapturePhase = "aggregate", Stage = "Projecting", After = "" };
        return await AggregateStep(org, student, season, work, ct);
    }
    async Task VerifyManifest(Guid org, Guid student, Guid season, Work work, Input current, CancellationToken ct)
    {
        var prefix = work.Id + ":inputs:";
        var pages = await Rows(org, student, season, "pbe-chapter-manifest").AsNoTracking().Where(r => r.Id.StartsWith(prefix)).OrderBy(r => r.Id).Take(work.InputPages + 1).ToListAsync(ct);
        if (pages.Count != work.InputPages || pages.Where((page, i) => page.Id != $"{work.Id}:inputs:{i:D6}").Any() || pages.Sum(p => Encoding.UTF8.GetByteCount(p.DataJson)) != work.StagedBytes - work.ProofBytes) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        var entries = pages.SelectMany(Read<string[]>).ToArray();
        if (entries.Length != work.InputOffset) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        var parsed = entries.Select(text => (Text: text, Value: JsonSerializer.Deserialize<JsonElement>(text))).ToArray();
        var guards = parsed.Where(e => e.Value[0].GetString() is "control" or "source" or "bank").Select(e => e.Text).OrderBy(e => e, StringComparer.Ordinal);
        if (!guards.SequenceEqual(current.Entries.OrderBy(e => e, StringComparer.Ordinal), StringComparer.Ordinal)) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        var capturedTargets = parsed.Where(e => e.Value[0].GetString() == "target").Select(e => JsonSerializer.Deserialize<PbeTarget>(e.Value[2].GetString()!, Json)!).ToArray();
        var capturedQuestions = parsed.Where(e => e.Value[0].GetString() == "question").Select(e => JsonSerializer.Deserialize<PbeQuestion>(e.Value[2].GetString()!, Json)!).ToArray();
        string TargetsProof(IEnumerable<PbeTarget> targets) => Serialize(targets.OrderBy(t => t.Id.ToString(), StringComparer.Ordinal).Select(t => new object[] { t.Id, t.SourceUnitIds, t.Skill.ToString() }).ToArray());
        string QuestionsProof(IEnumerable<PbeQuestion> questions) => Serialize(questions.OrderBy(q => q.Id.ToString(), StringComparer.Ordinal).Select(q => new object[] { q.Id, q.Version, q.SourceUnitIds, q.Kind.ToString(), q.Ordered, q.Parts.Select(p => new object[] { p.TargetId, p.Points }).ToArray() }).ToArray());
        if (TargetsProof(capturedTargets) != TargetsProof(current.Bank.Targets) || QuestionsProof(capturedQuestions) != QuestionsProof(current.Bank.Questions)) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        var retentions = parsed.Where(e => e.Value[0].GetString() == "retention").ToArray();
        var targetIds = current.Bank.Targets.Select(t => t.Id).ToArray();
        if (retentions.Length != targetIds.Length || !retentions.Select(e => e.Value[1].GetGuid()).Order().SequenceEqual(targetIds.Order())) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        var actual = (await jsonReader.CurrentRetentions(org, season, student, work.Id, ct)).ToDictionary(r => Read<PbeReviewProjection>(r).TargetId);
        if (retentions.Any(e => !actual.TryGetValue(e.Value[1].GetGuid(), out var row) || row.Revision != e.Value[3].GetInt64() || row.DataJson != e.Value[2].GetString())) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
    }
    async Task<bool> Cleanup(Guid org, Guid student, Guid season, string id, CancellationToken ct)
    {
        // Stamps own their immutable proof pages directly; generation input/row staging has no stamp references.
        var prefix = id + ":";
        var inputQuery = db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == student && (r.Kind == "pbe-chapter-manifest" || r.Kind == "pbe-chapter-projection") && r.Id.StartsWith(prefix));
        var ids = await inputQuery.OrderBy(r => r.Id).Select(r => r.Id).Take(PageRows).ToArrayAsync(ct);
        if (ids.Length > 0) { await inputQuery.Where(r => ids.Contains(r.Id)).ExecuteDeleteAsync(ct); return true; }
        // Each proof family belongs to at most one stamp. Filter candidates on the server before limiting the cleanup page.
        var generationMatch = "\"proofGenerationId\":\"" + id + "\"";
        var proofQuery = Rows(org, student, season, "pbe-chapter-stamp-proof").Where(r => r.Id.StartsWith(prefix) &&
            !db.PbeTrainingRecords.Any(stamp => stamp.OrganizationId == org && stamp.SeasonId == season && stamp.OwnerId == student && stamp.Kind == "pbe-chapter-stamp" &&
                stamp.DataJson.Contains(generationMatch) && stamp.DataJson.Contains("\"proofFamily\":\"" + r.Id.Substring(prefix.Length, 12) + "\"")));
        var proofIds = await proofQuery.OrderBy(r => r.Id).Select(r => r.Id).Take(PageRows).ToArrayAsync(ct);
        if (proofIds.Length > 0) await proofQuery.Where(r => proofIds.Contains(r.Id)).ExecuteDeleteAsync(ct);
        return proofIds.Length > 0;
    }
    async Task<bool> EvidenceChanged(Guid org, Guid student, Guid season, Work work, Input input, CancellationToken ct)
    {
        var prefix = work.Id + ":";
        var rows = await Rows(org, student, season, "pbe-chapter-projection").AsNoTracking().Where(r => r.Id.StartsWith(prefix)).ToListAsync(ct);
        var proofs = await jsonReader.CurrentRetentions(org, season, student, work.Id, ct);
        foreach (var row in rows)
        {
            var stored = Read<StoredProjection>(row); var group = input.Groups.Single(g => g.Key == stored.Row.Key); var ids = Targets(input, group).ToHashSet();
            if (stored.EvidenceFingerprint != EvidenceFingerprint(proofs.Where(r => ids.Contains(Read<PbeReviewProjection>(r).TargetId)).ToArray())) return true;
        }
        return false;
    }
    static PbeProgressRow Project(Input input, Group group, IReadOnlyList<PbeReviewProjection> projections, Work work)
    {
        var scoped = new PbeChapterScope(group.Key, input.ScopeVersion, group.Sources, input.Sources.Sources.Select(s => s.Id).ToArray());
        var counts = PbeChapterRules.ProjectChapter(scoped, input.Bank.Targets, projections.Select(p => p.Review).ToArray(), [], input.Bank.Questions, new(work.AsOfUtc.ToUnixTimeMilliseconds()));
        var ids = Targets(input, group).ToHashSet(); var states = projections.Where(p => ids.Contains(p.TargetId)).ToArray();
        var retained = states.Count(p => p.Retention is not null && PbeChapterRules.IsRetained(p.Retention) && !p.Provisional && input.Bank.Questions.Where(q => q.Kind != PbeQuestionKind.TrueFalse && q.Parts.Any(part => part.TargetId == p.TargetId) && (input.Bank.Targets.Single(t => t.Id == p.TargetId).Skill != RecallSkill.ExactWords || q.Kind == PbeQuestionKind.ExactWords)).Select(q => q.Id).Distinct().Count() >= 2);
        var updating = states.Any(p => p.Provisional || p.Retention is null || p.Retention.DataGap);
        var current = updating ? "Updating" : counts.TotalTargets > 0 && counts.AssignedPassages > 0 && counts.QuestionCoveredPassages == counts.AssignedPassages && retained == counts.TotalTargets && counts.MissingVariantTargets == 0 ? "Retained" : "Incomplete";
        var actions = new List<PbeProgressAction>();
        if (!updating && input.Bank.Questions.Any(q => q.Parts.Any(p => ids.Contains(p.TargetId)))) actions.Add(new("Practice", "Practice", new(group.Key, input.ScopeVersion)));
        if (!updating && counts.DueTargets > 0) actions.Add(new("Review", states.Any(p => p.Review.Unresolved) ? "Comeback practice" : "Review", new(group.Key, input.ScopeVersion)));
        return new(group.Key, group.ParentChapterKey, group.Kind, group.Label, group.ScopeLabel, group.Pack, group.Book, group.Chapter, group.Whole,
            new(counts.AssignedPassages, counts.QuestionCoveredPassages, counts.TotalTargets, states.Count(p => p.Retention?.Practiced == true), states.Count(p => p.Retention is { Recalled: true, PendingCount: 0, DataGap: false } && !p.Provisional), retained, counts.DueTargets, counts.MissingVariantTargets), current, null, false, actions);
    }
    /// <summary>D2 resolves this owned intent before invoking the existing full-assignment target selector.</summary>
    public async Task<IReadOnlyList<Guid>> ResolveProgressScope(Guid org, Guid student, Guid season, PbeProgressScope selector, CancellationToken ct)
    {
        if (await Admission(org, student, season, ct) is not null) throw new PbeChapterConflictException("PBE_CHAPTER_CURSOR_STALE");
        var pointer = await Get(org, student, season, "pbe-chapter-work", Owner(student, season), ct);
        var work = pointer is null ? null : Read<Work>(pointer);
        var input = await Capture(org, student, season, ct);
        if (work?.State != "Complete" || input.ScopeVersion != selector.ScopeVersion || work.ScopeVersion != selector.ScopeVersion) throw new PbeChapterConflictException("PBE_CHAPTER_CURSOR_STALE");
        await VerifyManifest(org, student, season, work, input, ct);
        var group = input.Groups.SingleOrDefault(g => g.Key == selector.Key) ?? throw new PbeChapterConflictException("PBE_CHAPTER_CURSOR_STALE");
        return Targets(input, group);
    }
    static readonly string[] ControlFamilies = ["scope", "assignment", "assignment-scope", "intro-assignment", "introduction", "pack", "member"];
    async Task<IReadOnlyList<(string Id, string Entry)>> ControlPage(Guid org, Guid student, Guid season, string family, string after, int limit, CancellationToken ct)
    {
        switch (family)
        {
            case "scope": return (await db.ScopeEntries.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && string.Compare(r.Id.ToString().ToLower(), after) > 0).OrderBy(r => r.Id.ToString().ToLower()).Take(limit).ToListAsync(ct)).Select(r => (r.Id.ToString(), Serialize(new object[] { "control", family, r.Id, r.ContentPackId, r.Kind.ToString(), r.BookKey, r.StartChapter, r.StartVerse, r.EndChapter, r.EndVerse }))).ToArray();
            case "assignment": return (await db.Assignments.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.StudentUserId == student && string.Compare(r.Id.ToString().ToLower(), after) > 0).OrderBy(r => r.Id.ToString().ToLower()).Take(limit).ToListAsync(ct)).Select(r => (r.Id.ToString(), Serialize(new object[] { "control", family, r.Id, r.Type.ToString() }))).ToArray();
            case "assignment-scope": return (await db.AssignmentScopes.AsNoTracking().Where(r => r.Assignment!.OrganizationId == org && r.Assignment.SeasonId == season && r.Assignment.StudentUserId == student && string.Compare(r.Id.ToString().ToLower(), after) > 0).OrderBy(r => r.Id.ToString().ToLower()).Take(limit).ToListAsync(ct)).Select(r => (r.Id.ToString(), Serialize(new object[] { "control", family, r.Id, r.AssignmentId, r.ContentPackId, r.BookKey, r.StartChapter, r.StartVerse, r.EndChapter, r.EndVerse }))).ToArray();
            case "intro-assignment": return (await Rows(org, student, season, "pbe-introduction-assignment").AsNoTracking().Where(r => string.Compare(r.Id, after) > 0).OrderBy(r => r.Id).Take(limit).ToListAsync(ct)).Select(r => (r.Id, Serialize(new object[] { "control", family, r.Id, r.Revision, Read<PbeIntroductionAssignment>(r).ContentPackId }))).ToArray();
            case "introduction": return (await jsonReader.AssignedIntroductionPage(org, season, student, after, limit, ct)).Select(r => (r.Id, Serialize(new object[] { "control", family, r.Id, r.Revision }))).ToArray();
            case "pack": return (await db.ContentPacks.AsNoTracking().Where(r => db.AssignmentScopes.Any(a => a.Assignment!.OrganizationId == org && a.Assignment.SeasonId == season && a.Assignment.StudentUserId == student && a.ContentPackId == r.Id) && string.Compare(r.Id.ToString().ToLower(), after) > 0).OrderBy(r => r.Id.ToString().ToLower()).Take(limit).ToListAsync(ct)).Select(r => (r.Id.ToString(), Serialize(new object[] { "control", family, r.Id, r.OrganizationId, r.IsActive, r.IsBuiltIn, r.LicensingStatus, r.SourceType.ToString() }))).ToArray();
            case "member": return (await db.CompetitionMembers.AsNoTracking().Where(r => r.OrganizationId == org && r.SeasonId == season && r.UserId == student && string.Compare(r.Id.ToString().ToLower(), after) > 0).OrderBy(r => r.Id.ToString().ToLower()).Take(limit).ToListAsync(ct)).Select(r => (r.Id.ToString(), Serialize(new object[] { "control", family, r.Id, r.UserId }))).ToArray();
            default: throw new InvalidOperationException("Unknown chapter guard family.");
        }
    }
    async Task<IReadOnlyList<string>> CurrentControls(Guid org, Guid student, Guid season, CancellationToken ct)
    {
        var entries = new List<string>();
        foreach (var family in ControlFamilies)
        {
            var page = await ControlPage(org, student, season, family, "", 10001, ct);
            if (page.Count > 10000) throw new PbeChapterLimitException("ScopeTooLarge");
            entries.AddRange(page.Select(p => p.Entry));
        }
        return entries;
    }
    static string SourceEntry(PbeSourceUnit s) => Serialize(new object?[] { "source", s.Id, s.ContentPackId, s.SourceKind.ToString(), s.BookKey, s.Chapter, s.Verse, s.Ordinal, s.CitationLabel, Hash(s.CanonicalText) });
    static string BankGuard(PbeTrainingRecord row) => Serialize(new object?[] { "bank", row.Kind, row.Id, row.OwnerId, row.Revision });
    async Task<Work> BankStep(Guid org, Guid student, Guid season, Work work, CancellationToken ct)
    {
        var targetPhase = work.CapturePhase == "targets"; var kind = targetPhase ? "pbe-target" : "pbe-question-head";
        var raw = await jsonReader.CandidatePage(org, season, student, work.Id, kind, work.After, PageRows + 1, ct);
        if (raw.Count == 0) return work with { CapturePhase = targetPhase ? "questions" : "replay", After = "", FamilyRows = 0, Stage = targetPhase ? "Indexing" : "Replaying" };
        if (work.FamilyRows + raw.Count > 10000) throw new PbeChapterLimitException("ScopeTooLarge");
        var chosen = new List<PbeTrainingRecord>(); var sourceIds = new HashSet<Guid>(); var targetIds = new HashSet<Guid>();
        foreach (var row in raw.Take(PageRows))
        {
            var units = targetPhase ? Read<PbeTarget>(row).SourceUnitIds : Read<PbeBankQuestionData>(row).Question.SourceUnitIds;
            var targets = targetPhase ? Array.Empty<Guid>() : Read<PbeBankQuestionData>(row).Question.Parts.Select(p => p.TargetId).ToArray();
            if (sourceIds.Union(units).Count() > PageRows || targetIds.Union(targets).Count() > PageRows) break;
            sourceIds.UnionWith(units); targetIds.UnionWith(targets); chosen.Add(row);
        }
        if (raw.Count > 0 && chosen.Count == 0) throw new PbeChapterLimitException("InputTooLarge");
        var capturedSources = await jsonReader.ManifestEntries(org, season, student, work.Id, "source", sourceIds.Select(id => id.ToString()).ToArray(), ct);
        var allowedIds = capturedSources.Select(text => JsonSerializer.Deserialize<JsonElement>(text)[1].GetGuid()).ToHashSet();
        var sourceMap = new Dictionary<Guid, PbeSourceUnit>(); var targetMap = new Dictionary<Guid, PbeTarget>();
        if (!targetPhase)
        {
            var scripture = await resolver.SelectedChapterScriptureSources(org, season, student, sourceIds.ToArray(), ct);
            var intros = await jsonReader.SelectedIntroductionSources(org, season, student, sourceIds.Select(id => id.ToString()).ToArray(), ct);
            sourceMap = scripture.Concat(intros).Where(s => allowedIds.Contains(s.Id)).ToDictionary(s => s.Id);
            var ids = targetIds.Select(id => id.ToString()).ToArray();
            targetMap = (await jsonReader.ManifestEntries(org, season, student, work.Id, "target", ids, ct))
                .Select(text => JsonSerializer.Deserialize<PbeTarget>(JsonSerializer.Deserialize<JsonElement>(text)[2].GetString()!, Json)!).ToDictionary(t => t.Id);
            foreach (var target in targetMap.Values) target.Label = "Captured target";
        }
        var values = new List<(PbeTrainingRecord Row, string[] Entries)>();
        foreach (var row in chosen)
        {
            var entries = new List<string> { BankGuard(row) };
            if (targetPhase)
            {
                var target = Read<PbeTarget>(row);
                var valid = true; try { PbeRubric.ValidateTarget(target); } catch (ArgumentException) { valid = false; }
                if (valid && target.SourceUnitIds.All(allowedIds.Contains))
                {
                    var compact = new PbeTarget { Id = target.Id, SourceUnitIds = target.SourceUnitIds, Skill = target.Skill };
                    entries.Add(Serialize(new object[] { "target", target.Id, Serialize(compact) }));
                }
            }
            else
            {
                var head = Read<PbeBankQuestionData>(row); var q = head.Question;
                if (head.Published && head.SeasonId == season && q.SourceUnitIds.All(sourceMap.ContainsKey))
                {
                    try
                    {
                        PbeRubric.Validate(q, q.Parts.Select(p => p.TargetId).Distinct().Where(targetMap.ContainsKey).Select(id => targetMap[id]).ToArray());
                        if (q.SourceUnitIds.All(id => sourceMap[id].ContentPackId == q.ContentPackId && sourceMap[id].SourceKind == q.SourceKind) && PbeQuestionBank.SourceProof(q, sourceMap) == head.SourceFingerprint)
                        {
                            var compact = new PbeQuestion
                            {
                                SchemaVersion = q.SchemaVersion,
                                Id = q.Id,
                                Version = q.Version,
                                ContentPackId = q.ContentPackId,
                                SourceUnitId = q.SourceUnitId,
                                SourceUnitIds = q.SourceUnitIds,
                                SourceKind = q.SourceKind,
                                Kind = q.Kind,
                                Ordered = q.Ordered,
                                Parts = q.Parts.Select(p => new PbeQuestionPart { TargetId = p.TargetId, Points = p.Points }).ToList()
                            };
                            entries.Add(Serialize(new object[] { "question", q.Id, Serialize(compact) }));
                        }
                    }
                    catch (ArgumentException) { }
                    catch (DomainException) { }
                }
            }
            values.Add((row, entries.ToArray()));
        }
        var page = FitPage(values, v => v.Entries);
        work = SaveInputPage(org, student, season, work, page.SelectMany(v => v.Entries).ToArray()) with { After = page.LastOrDefault().Row?.Id ?? work.After, FamilyRows = work.FamilyRows + page.Count };
        return work;
    }
    async Task<Work> AggregateStep(Guid org, Guid student, Guid season, Work work, CancellationToken ct)
    {
        if (work.Aggregate is null)
        {
            var group = (await projectionReader.GroupPage(org, season, student, work.Id, work.GroupAfter, ct)).FirstOrDefault();
            if (group is null)
            {
                var current = await Capture(org, student, season, ct); await VerifyManifest(org, student, season, work, current, ct);
                return work with { State = "Complete", Stage = null, SnapshotId = work.Id };
            }
            var covered = await projectionReader.CoveredPassages(org, season, student, work.Id, group.Key, ct);
            return work with { Aggregate = new(group, "", new(group.AssignedPassages, covered, 0, 0, 0, 0, 0, 0), false, false), Stage = "Projecting" };
        }
        var aggregate = work.Aggregate;
        var targets = await projectionReader.GroupTargets(org, season, student, work.Id, aggregate.Group.Key, aggregate.TargetAfter, ct);
        if (targets.Count == 0) return await PublishAggregate(org, student, season, work, ct);
        var retentionPage = await projectionReader.RetentionPage(org, season, student, work.Id, targets.Select(t => t.Id).ToArray(), ct);
        if (retentionPage.Count == 0 || !targets.Take(retentionPage.Count).Select(t => t.Id).SequenceEqual(retentionPage.Select(r => r.TargetId))) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        targets = targets.Take(retentionPage.Count).ToArray();
        var retentions = retentionPage.ToDictionary(r => r.TargetId);
        var variants = await projectionReader.VariantCounts(org, season, student, work.Id, targets, ct);
        var entries = new List<WitnessEntry>(); var counts = aggregate.Counts;
        foreach (var target in targets)
        {
            var projection = retentions.GetValueOrDefault(target.Id)?.Projection; var state = projection?.Retention; var variantCount = variants.GetValueOrDefault(target.Id);
            var witness = state is not null && PbeChapterRules.IsRetained(state) && variantCount >= 2 && aggregate.Group.Kind != "PassageGroup" ? new WitnessEntry(target.Id, state.Witness!) : null;
            if (witness is not null && (entries.Count >= 64 || Encoding.UTF8.GetByteCount(Serialize(entries.Append(witness))) + 1000 > PageBytes)) break;
            counts = counts with
            {
                TotalTargets = counts.TotalTargets + 1,
                PracticedTargets = counts.PracticedTargets + (state?.Practiced == true ? 1 : 0),
                RecalledTargets = counts.RecalledTargets + (state is { Recalled: true, PendingCount: 0, DataGap: false } && projection?.Provisional != true ? 1 : 0),
                RetainedTargets = counts.RetainedTargets + (state is not null && PbeChapterRules.IsRetained(state) && projection?.Provisional != true && variantCount >= 2 ? 1 : 0),
                MissingVariantTargets = counts.MissingVariantTargets + (variantCount < 2 ? 1 : 0),
                DueTargets = counts.DueTargets + (projection is not null && (projection.Review.Unresolved || projection.Review.IntervalIndex >= 0 && projection.Review.DueAtMs <= work.AsOfUtc.ToUnixTimeMilliseconds()) ? 1 : 0)
            };
            aggregate = aggregate with
            {
                Counts = counts,
                Updating = aggregate.Updating || state is null || state.DataGap || projection?.Provisional == true,
                Repair = aggregate.Repair || projection?.Review.Unresolved == true,
                TargetAfter = target.Id.ToString()
            };
            if (witness is not null) entries.Add(witness);
        }
        if (entries.Count > 0)
        {
            var family = $"proof-{work.RowOffset:D6}"; var id = $"{work.Id}:{family}:{work.ProofOffset:D6}";
            var page = new WitnessPage(work.Id, family, entries, Hash(Serialize(entries)));
            var bytes = Encoding.UTF8.GetByteCount(Serialize(page));
            if (bytes > PageBytes || work.StagedBytes + bytes > StagingBytes) throw new PbeChapterLimitException("InputTooLarge");
            Write(org, student, season, "pbe-chapter-stamp-proof", id, page);
            // Retain the charge after sealing; insertion, accounting and cursor advancement commit together.
            work = work with { ProofOffset = work.ProofOffset + entries.Count, ProofPages = work.ProofPages + 1, StagedBytes = work.StagedBytes + bytes, ProofBytes = work.ProofBytes + bytes };
        }
        return work with { Aggregate = aggregate };
    }
    async Task<Work> PublishAggregate(Guid org, Guid student, Guid season, Work work, CancellationToken ct)
    {
        var current = await Capture(org, student, season, ct);
        await VerifyManifest(org, student, season, work, current, ct);
        if (work.ScopeVersion is not null && current.ScopeVersion != work.ScopeVersion) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        work = work with { ScopeVersion = current.ScopeVersion };
        var group = current.Groups.Single(g => g.Key == work.Aggregate!.Group.Key);
        var targetIds = Targets(current, group); var targetSet = targetIds.ToHashSet();
        var proofRows = (await jsonReader.CurrentRetentions(org, season, student, work.Id, ct)).Where(r => targetSet.Contains(Read<PbeReviewProjection>(r).TargetId)).ToArray(); var projections = proofRows.Select(Read<PbeReviewProjection>).ToArray();
        var row = Project(current, group, projections, work);
        if (Serialize(row.Counts) != Serialize(work.Aggregate!.Counts)) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
        if (group.Kind != "PassageGroup")
        {
            var stampId = $"{Owner(student, season)}:{Hash(Serialize(new[] { group.Key, current.ScopeVersion, RuleVersion }))}";
            var prior = await Get(org, student, season, "pbe-chapter-stamp", stampId, ct);
            var chapterMatch = "\"chapterKey\":\"" + group.Key + "\"";
            row = row with { HasHistoricalStamps = await Rows(org, student, season, "pbe-chapter-stamp").AnyAsync(r => r.DataJson.Contains(chapterMatch), ct) };
            if (prior is not null) row = row with { Stamp = Read<Stamp>(prior).Summary with { MatchesCurrentScope = true } };
            else if (row.CurrentReadiness == "Retained")
            {
                var family = $"proof-{work.RowOffset:D6}"; var prefix = $"{work.Id}:{family}:";
                var pages = await Rows(org, student, season, "pbe-chapter-stamp-proof").AsNoTracking().Where(r => r.Id.StartsWith(prefix)).OrderBy(r => r.Id).Take(work.ProofPages + 1).ToListAsync(ct);
                var values = pages.Select(Read<WitnessPage>).ToArray();
                var expected = projections.OrderBy(p => p.TargetId.ToString(), StringComparer.Ordinal).Select(p => new WitnessEntry(p.TargetId, p.Retention!.Witness!)).ToArray();
                if (pages.Count != work.ProofPages || values.Any(p => p.GenerationId != work.Id || p.Family != family || p.Hash != Hash(Serialize(p.Entries))) || Serialize(values.SelectMany(v => v.Entries).ToArray()) != Serialize(expected)) throw new PbeChapterConflictException("PBE_CHAPTER_WORK_STALE");
                var summary = new PbeStampSummary(stampId, group.Key, group.Kind, group.Label, group.ScopeLabel, current.ScopeVersion, RuleVersion, clock.UtcNow, true);
                row = row with { Stamp = summary, HasHistoricalStamps = true };
                // Validate the paired row before tracking either publication write.
                if (Encoding.UTF8.GetByteCount(Serialize(new StoredProjection(row, EvidenceFingerprint(proofRows)))) > PageBytes) throw new PbeChapterLimitException("InputTooLarge");
                Write(org, student, season, "pbe-chapter-stamp", stampId, new Stamp(summary, work.Id, family, targetIds.Length, targetIds.Length * 2, pages.Count, Hash(Serialize(pages.Select(p => new[] { p.Id, Read<WitnessPage>(p).Hash }).ToArray()))));
            }
        }
        Write(org, student, season, "pbe-chapter-projection", $"{work.Id}:{work.RowOffset:D6}", new StoredProjection(row, EvidenceFingerprint(proofRows)));
        return work with { Aggregate = null, GroupAfter = work.Aggregate!.Group.SortKey, RowOffset = work.RowOffset + 1, ProofPages = 0, ProofOffset = 0 };
    }
}
