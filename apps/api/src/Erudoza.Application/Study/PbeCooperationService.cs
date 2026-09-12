using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Application.Study;

public sealed class PbeCooperationConflictException(string code) : Exception(code) { public string Code { get; } = code; }
public enum CooperationOperation { StudentSummary, StudentContinue, CoachSummary, CoachContinue, CoachDetail }
/// <summary>Server minted authorization under the actual request user; never deserialized from a client.</summary>
public sealed class VerifiedCooperationScope
{
    public Guid OrganizationId { get; }
    public Guid SeasonId { get; }
    public Guid ActorId { get; }
    public CooperationOperation Operation { get; }
    public bool Student => Operation is CooperationOperation.StudentSummary or CooperationOperation.StudentContinue;
    public string? AdmissionReason { get; }
    private VerifiedCooperationScope(Guid org, Guid season, Guid actor, CooperationOperation op, string? reason)
        => (OrganizationId, SeasonId, ActorId, Operation, AdmissionReason) = (org, season, actor, op, reason);
    internal static async Task<VerifiedCooperationScope> Verify(IErudozaDbContext db, ICurrentUser user, Guid org, Guid season, CooperationOperation operation, CancellationToken ct)
    {
        if (!user.IsAuthenticated || user.OrganizationId != org || org == Guid.Empty || season == Guid.Empty) throw new UnauthorizedAccessException();
        var caller = await (from u in db.Users.AsNoTracking() join m in db.OrganizationMembers.AsNoTracking() on u.Id equals m.UserId where u.Id == user.UserId && u.IsActive && m.OrganizationId == org select new { u.Id, u.Kind, m.Role }).SingleOrDefaultAsync(ct);
        var student = operation is CooperationOperation.StudentSummary or CooperationOperation.StudentContinue;
        if (caller is null || (student ? caller.Kind != UserKind.Student || caller.Role != OrganizationRole.Student : caller.Kind != UserKind.Adult || caller.Role is not (OrganizationRole.Owner or OrganizationRole.Admin))) throw new UnauthorizedAccessException();
        if (student && !await db.CompetitionMembers.AnyAsync(m => m.OrganizationId == org && m.SeasonId == season && m.UserId == caller.Id, ct)) throw new UnauthorizedAccessException();
        var admitted = await db.Seasons.AsNoTracking().Where(s => s.OrganizationId == org && s.Id == season).Select(s => new { s.Status, s.PbeEnabled }).SingleOrDefaultAsync(ct) ?? throw new KeyNotFoundException("Season was not found.");
        return new(org, season, caller.Id, operation, admitted.Status != SeasonStatus.Active ? "SeasonClosed" : admitted.PbeEnabled ? null : "PbeDisabled");
    }
}

public sealed class PbeCooperationService(IErudozaDbContext db, ICurrentUser user, IClock clock, PbeProgressService writes, IPbeCooperationReader reader)
{
    public const string RuleVersion = "pbe-cooperation-v1";
    const int TotalBytes = 32 * 1024 * 1024, GuardBytes = 16 * 1024 * 1024;
    static readonly JsonSerializerOptions Json = new(PbeQuestionBank.Json) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static string Serialize<T>(T value)
    {
        // JSON.stringify-compatible Unicode escaping, including supplementary code points.
        // Keep this D2 codec separate from legacy D1 and session receipt serialization.
        var output = new StringBuilder();
        void String(string text)
        {
            output.Append('"');
            for (var i = 0; i < text.Length; i++)
            {
                var c = text[i];
                switch (c)
                {
                    case '"': output.Append("\\\""); break;
                    case '\\': output.Append("\\\\"); break;
                    case '\b': output.Append("\\b"); break;
                    case '\f': output.Append("\\f"); break;
                    case '\n': output.Append("\\n"); break;
                    case '\r': output.Append("\\r"); break;
                    case '\t': output.Append("\\t"); break;
                    default:
                        if (c < 32 || char.IsSurrogate(c) && !(char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))) output.Append("\\u").Append(((int)c).ToString("x4", System.Globalization.CultureInfo.InvariantCulture));
                        else { output.Append(c); if (char.IsHighSurrogate(c)) output.Append(text[++i]); }
                        break;
                }
            }
            output.Append('"');
        }
        void Write(JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    output.Append('{'); var first = true; foreach (var item in element.EnumerateObject()) { if (!first) output.Append(','); first = false; String(item.Name); output.Append(':'); Write(item.Value); }
                    output.Append('}'); break;
                case JsonValueKind.Array:
                    output.Append('['); var initial = true; foreach (var item in element.EnumerateArray()) { if (!initial) output.Append(','); initial = false; Write(item); }
                    output.Append(']'); break;
                case JsonValueKind.String: String(element.GetString()!); break;
                default: output.Append(element.GetRawText()); break;
            }
        }
        Write(JsonSerializer.SerializeToElement(value, Json)); return output.ToString();
    }
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public sealed record Work(int SchemaVersion, string RuleVersion, string WorkId, string Stage, string? After, int SubjectIndex, int PageCount, int Bytes, int GuardBytes, string? PublishedId, string? AbandonedId, string? Reason);
    public sealed record Page<T>(string Id, string GenerationId, string Family, int Ordinal, IReadOnlyList<T> Entries, int Bytes, string Hash);
    sealed record Cursor(int V, Guid OrganizationId, Guid SeasonId, string SnapshotId, string Operation, string After);
    static T Read<T>(PbeTrainingRecord row) => JsonSerializer.Deserialize<T>(row.DataJson, Json)!;
    IQueryable<PbeTrainingRecord> Rows(Guid org, Guid season, string kind) => db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == season && r.OwnerId == null && r.Kind == kind);
    Task<PbeTrainingRecord?> Pointer(Guid org, Guid season, CancellationToken ct) => Rows(org, season, "pbe-cooperation-work").SingleOrDefaultAsync(r => r.Id == season.ToString(), ct);
    void Write(Guid org, Guid season, string kind, string id, object value, PbeTrainingRecord? row = null)
    {
        var payload = Serialize(value); if (Encoding.UTF8.GetByteCount(payload) > 65536) throw new PbeChapterLimitException("InputTooLarge");
        if (row is null) db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = kind, Id = id, OwnerId = null, DataJson = payload });
        else { row.DataJson = payload; row.Revision++; }
    }
    Page<T> BuildPage<T>(Work work, string family, IReadOnlyList<T> entries)
    {
        if (entries.Count > 128) throw new PbeChapterLimitException("ScopeTooLarge");
        var id = $"{work.WorkId}:{family}:{work.PageCount:D6}";
        var page = new Page<T>(id, work.WorkId, family, work.PageCount, entries, 0, Hash(Serialize(entries)));
        while (true) { var bytes = Encoding.UTF8.GetByteCount(Serialize(page)); if (bytes == page.Bytes) break; page = page with { Bytes = bytes }; }
        var guards = family == "inputs" ? page.Bytes : 0;
        if (page.Bytes > 65536 || work.Bytes + page.Bytes > TotalBytes || work.GuardBytes + guards > GuardBytes) throw new PbeChapterLimitException("InputTooLarge");
        return page;
    }
    static Work ChargePage<T>(Work work, Page<T> page) => work with { PageCount = work.PageCount + 1, Bytes = work.Bytes + page.Bytes, GuardBytes = work.GuardBytes + (page.Family == "inputs" ? page.Bytes : 0) };
    Work AddPage<T>(VerifiedCooperationScope scope, Work work, string family, IReadOnlyList<T> entries)
    {
        var page = BuildPage(work, family, entries); Write(scope.OrganizationId, scope.SeasonId, "pbe-cooperation-manifest", page.Id, page);
        return ChargePage(work, page);
    }
    static PbeCooperationSnapshot Empty(Guid season, Work? w, string? reason = null, string? state = null) => new(season, RuleVersion, null, null, reason is not null ? "Blocked" : state ?? (w is null ? "NotStarted" : "Updating"), reason, null, null, 0, 0, null, null, null, new(w?.WorkId, reason is not null ? "None" : w is null ? "None" : w.Stage == "Complete" ? "Reload" : "Continue"));
    static PbeOwnMaterialSummary Own(CooperationMaterialRow? r) => r is null ? new(0, new(0, 0), new(0, 0), new(0, 0)) : new(r.Assigned, new(r.PracticedKnown, r.PracticedPossible), new(r.RetainedKnown, r.RetainedPossible), new(r.DueKnown, r.DuePossible));
    static PbeMaterialSummary Material(IReadOnlyList<CooperationMaterialRow> rows, string kind, int roster)
    {
        var union = rows.SingleOrDefault(r => r.StudentId == "" && r.SourceKind == kind); var own = rows.Where(r => r.StudentId != "" && r.SourceKind == kind && r.Assigned > 0).ToArray();
        PbeEqualRetained? equal = own.Length == 0 ? null : new(own.Average(r => (double)r.RetainedKnown / r.Assigned), own.Average(r => (double)r.RetainedPossible / r.Assigned), own.Length, own.Count(r => r.RetainedKnown != r.RetainedPossible), roster - own.Length);
        return union is null ? new(0, new(0, 0), new(0, 0), new(0, 0), new(0, 0), equal) : new(union.Assigned, new(union.CoveredKnown, union.CoveredPossible), new(union.PracticedKnown, union.PracticedPossible), new(union.RetainedKnown, union.RetainedPossible), new(union.DueKnown, union.DuePossible), equal);
    }
    async Task<bool> PagesValid(VerifiedCooperationScope scope, string generation, CancellationToken ct, int? expectedCount = null, long? expectedBytes = null)
    {
        var pages = Rows(scope.OrganizationId, scope.SeasonId, "pbe-cooperation-manifest").AsNoTracking().Where(r => r.Id.StartsWith(generation + ":"));
        var ordinals = new HashSet<int>(); long total = 0; var valid = true;
        await foreach (var row in pages.AsAsyncEnumerable().WithCancellation(ct))
        {
            var bytes = Encoding.UTF8.GetByteCount(row.DataJson); total += bytes; if (bytes > 65536 || total > TotalBytes) return false;
            try
            {
                var page = Read<Page<JsonElement>>(row);
                if (page.Id != row.Id || page.GenerationId != generation || page.Entries.Count > 128 || page.Bytes != bytes || page.Hash != Hash(Serialize(page.Entries)) || !ordinals.Add(page.Ordinal) || page.Id != $"{generation}:{page.Family}:{page.Ordinal:D6}") valid = false;
            }
            catch (JsonException) { return false; }
        }
        return valid && (expectedCount is null || ordinals.Count == expectedCount) && (expectedBytes is null || total == expectedBytes) && ordinals.Order().SequenceEqual(Enumerable.Range(0, ordinals.Count));
    }
    async Task<Work> Publish(VerifiedCooperationScope scope, Work work, CancellationToken ct)
    {
        if (!await PagesValid(scope, work.WorkId, ct, work.PageCount, work.Bytes) || !await reader.InputsCurrent(scope, work.WorkId, ct)) throw new PbeCooperationConflictException("PBE_COOPERATION_WORK_STALE");
        var now = DateTimeOffset.FromUnixTimeMilliseconds(clock.UtcNow.ToUnixTimeMilliseconds());
        var rows = await reader.Totals(scope, work.WorkId, now.ToUnixTimeMilliseconds(), ct);
        var descriptorInputs = await reader.Descriptors(scope, work.WorkId, ct);
        var roster = descriptorInputs.Where(x => x.Key.StartsWith("roster:", StringComparison.Ordinal)).ToArray();
        var descriptors = descriptorInputs.Where(x => x.Key.StartsWith("pointer:", StringComparison.Ordinal)).ToDictionary(x => x.Value[1].GetString()!);
        var subjects = roster.Select(r =>
        {
            var id = r.Value[1].GetString()!; var d = descriptors[id].Value;
            return new PbeCooperationStudent(id, r.Value[2].GetString()!, d[4].GetString()!, d[5].GetString(), Own(rows.SingleOrDefault(x => x.StudentId == id && x.SourceKind == "Scripture")), Own(rows.SingleOrDefault(x => x.StudentId == id && x.SourceKind == "Commentary")));
        }).OrderBy(x => x.StudentId, StringComparer.Ordinal).ToArray();
        var unknown = subjects.Count(s => s.State == "Unknown"); var future = rows.Where(r => r.FutureDueAtMs is not null).Select(r => r.FutureDueAtMs!.Value).DefaultIfEmpty(now.AddMinutes(5).ToUnixTimeMilliseconds()).Min();
        var snapshot = new PbeCooperationSnapshot(scope.SeasonId, RuleVersion, await reader.ScopeVersion(scope, work.WorkId, ct), work.WorkId, unknown > 0 ? "Provisional" : "Snapshot", null, now, DateTimeOffset.FromUnixTimeMilliseconds(Math.Min(now.AddMinutes(5).ToUnixTimeMilliseconds(), future)), subjects.Length, unknown, Material(rows, "Scripture", subjects.Length), Material(rows, "Commentary", subjects.Length), null, new(work.WorkId, "Reload"));
        var subjectsPage = BuildPage(work, "subjects", subjects); work = ChargePage(work, subjectsPage);
        var snapshotBytes = Encoding.UTF8.GetByteCount(Serialize(snapshot)); if (work.Bytes + snapshotBytes > TotalBytes) throw new PbeChapterLimitException("InputTooLarge");
        var stored = System.Text.Json.Nodes.JsonNode.Parse(Serialize(snapshot))!; stored["manifestPageCount"] = work.PageCount; stored["manifestBytes"] = work.Bytes;
        snapshotBytes = Encoding.UTF8.GetByteCount(Serialize(stored)); if (work.Bytes + snapshotBytes > TotalBytes) throw new PbeChapterLimitException("InputTooLarge");
        Write(scope.OrganizationId, scope.SeasonId, "pbe-cooperation-manifest", subjectsPage.Id, subjectsPage);
        Write(scope.OrganizationId, scope.SeasonId, "pbe-cooperation-snapshot", work.WorkId, stored);
        return work with { Stage = "Complete", After = null, Bytes = work.Bytes + snapshotBytes, AbandonedId = work.PublishedId, PublishedId = work.WorkId };
    }
    async Task<bool> Cleanup(VerifiedCooperationScope scope, string id, CancellationToken ct)
    {
        var query = Rows(scope.OrganizationId, scope.SeasonId, "pbe-cooperation-manifest").Where(r => r.Id.StartsWith(id + ":"));
        var ids = await query.OrderBy(r => r.Id).Select(r => r.Id).Take(112).ToArrayAsync(ct);
        if (ids.Length > 0) { await query.Where(r => ids.Contains(r.Id)).ExecuteDeleteAsync(ct); return false; }
        await Rows(scope.OrganizationId, scope.SeasonId, "pbe-cooperation-snapshot").Where(r => r.Id == id).ExecuteDeleteAsync(ct); return true;
    }
    public Task<PbeCooperationSnapshot> Continue(Guid org, ContinueChaptersRequest request, bool coach, CancellationToken ct) => writes.ExecuteAsync(async token =>
    {
        var scope = await VerifiedCooperationScope.Verify(db, user, org, request.SeasonId, coach ? CooperationOperation.CoachContinue : CooperationOperation.StudentContinue, token);
        var pointer = await Pointer(org, request.SeasonId, token); var work = pointer is null ? null : Read<Work>(pointer);
        if (scope.AdmissionReason is not null) return Empty(request.SeasonId, work, scope.AdmissionReason);
        if (request.WorkId is not null && (work is null || request.WorkId != work.WorkId || work.Stage == "Blocked")) throw new PbeCooperationConflictException("PBE_COOPERATION_WORK_STALE");
        // A completed retry only returns its receipt hint. Current GET owns full validation;
        // a new bootstrap captures fresh bounded work without a whole-set ordinary read.
        if (work?.Stage == "Complete" && request.WorkId is not null) return Empty(request.SeasonId, work);
        if (work?.AbandonedId is { } abandoned)
        {
            // Cleanup has not created resumable work under the completed generation ID.
            // Ask the client to bootstrap again while preserving completed-ID receipt semantics.
            if (!await Cleanup(scope, abandoned, token)) return Empty(request.SeasonId, work) with { Work = new(null, "Continue") };
            work = work with { AbandonedId = null };
        }
        if (work is null || work.Stage is "Complete" or "Blocked") work = new(1, RuleVersion, Guid.NewGuid().ToString(), "Roster", null, 0, 0, 0, 0, work?.PublishedId, work is { Stage: "Blocked" } ? work.WorkId : null, null);
        try
        {
            if (work.Stage == "Roster")
            {
                var reason = await reader.LimitReason(scope, token);
                work = reason is not null ? work with { Stage = "Blocked", Reason = reason } : work with { Stage = "Sources" };
            }
            else if (work.Stage == "Sources")
            {
                var page = await reader.SourcePage(scope, work.After ?? "", token);
                work = page.Count == 0 ? work with { Stage = "Assignments", After = null } : AddPage(scope, work, "inputs", page) with { After = page[^1].Key };
            }
            else if (work.Stage == "Assignments")
            {
                var page = await reader.InputPage(scope, work.WorkId, work.After ?? "", token);
                work = page.Count == 0 ? work with { Stage = "Facts", After = null } : AddPage(scope, work, "inputs", page) with { After = page[^1].Key };
            }
            else if (work.Stage == "Facts")
            {
                var page = await reader.FactPage(scope, work.WorkId, work.After ?? "", token);
                work = page.Count == 0 ? work with { Stage = "Publishing", After = null } : AddPage(scope, work, "facts", page) with { After = $"{page[^1].SourceKind}:{page[^1].ContentPackId}:{page[^1].SourceUnitId}:{page[^1].StudentId}" };
            }
            else if (work.Stage == "Publishing")
            {
                try { work = await Publish(scope, work, token); }
                catch (PbeCooperationConflictException) when (request.WorkId is null)
                { work = new(1, RuleVersion, Guid.NewGuid().ToString(), "Roster", null, 0, 0, 0, 0, work.PublishedId, work.WorkId, null); }
            }
        }
        catch (PbeChapterLimitException e) { work = work with { Stage = "Blocked", Reason = e.Reason }; }
        Write(org, request.SeasonId, "pbe-cooperation-work", request.SeasonId.ToString(), work, pointer);
        return Empty(request.SeasonId, work, work.Reason);
    }, ct);
    async Task<(VerifiedCooperationScope Scope, Work? Work, PbeCooperationSnapshot Snapshot)> Current(Guid org, Guid season, CooperationOperation operation, CancellationToken ct)
    {
        var scope = await VerifiedCooperationScope.Verify(db, user, org, season, operation, ct); var pointer = await Pointer(org, season, ct); var work = pointer is null ? null : Read<Work>(pointer);
        if (scope.AdmissionReason is not null) return (scope, work, Empty(season, work, scope.AdmissionReason));
        if (work?.PublishedId is null) return (scope, work, Empty(season, work, work?.Reason));
        var stored = await Rows(org, season, "pbe-cooperation-snapshot").AsNoTracking().SingleOrDefaultAsync(r => r.Id == work.PublishedId, ct);
        if (stored is null) return (scope, work, Empty(season, work));
        var seal = JsonDocument.Parse(stored.DataJson).RootElement;
        if (!await PagesValid(scope, work.PublishedId, ct, seal.GetProperty("manifestPageCount").GetInt32(), seal.GetProperty("manifestBytes").GetInt64()) || !await reader.InputsCurrent(scope, work.PublishedId, ct)) return (scope, work, Empty(season, work, null, "Updating"));
        return (scope, work, Read<PbeCooperationSnapshot>(stored));
    }
    async Task<IReadOnlyList<PbeCooperationStudent>> Subjects(Guid org, Guid season, string generation, CancellationToken ct)
    {
        var page = await Rows(org, season, "pbe-cooperation-manifest").AsNoTracking().SingleAsync(r => r.Id.StartsWith(generation + ":subjects:"), ct);
        return Read<Page<PbeCooperationStudent>>(page).Entries;
    }
    public async Task<PbeCooperationSnapshot> Get(Guid org, Guid season, bool coach, CancellationToken ct)
    {
        await using var transaction = await db.BeginSerializableTransactionAsync(ct);
        var (scope, work, snapshot) = await Current(org, season, coach ? CooperationOperation.CoachSummary : CooperationOperation.StudentSummary, ct);
        if (scope.Student && snapshot.SnapshotId is not null)
        {
            var own = (await Subjects(org, season, snapshot.SnapshotId, ct)).Single(s => s.StudentId == scope.ActorId.ToString());
            snapshot = snapshot with { Own = new(own.Scripture, own.Introduction, own.State) };
        }
        await transaction.CommitAsync(ct); return snapshot with { Work = new(work?.WorkId, snapshot.Reason is not null ? "None" : work is null ? "None" : work.Stage == "Complete" ? "Reload" : "Continue") };
    }
    public async Task<PbeCooperationStudents> Students(Guid org, Guid season, string? after, int? limit, CancellationToken ct)
    {
        var take = limit ?? 32; if (take is < 1 or > 32) throw new DomainException("Choose a page size between 1 and 32.");
        await using var transaction = await db.BeginSerializableTransactionAsync(ct);
        var (_, _, snapshot) = await Current(org, season, CooperationOperation.CoachDetail, ct);
        if (snapshot.SnapshotId is null) throw new PbeCooperationConflictException("PBE_COOPERATION_CURSOR_STALE");
        Cursor? cursor = null;
        if (after is not null) try
            {
                if (after.Length > 4096) throw new FormatException(); cursor = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(after), Json);
                if (cursor is null || cursor.V != 1 || cursor.OrganizationId != org || cursor.SeasonId != season || cursor.SnapshotId != snapshot.SnapshotId || cursor.Operation != "CoachDetail") throw new FormatException();
            }
            catch (Exception e) when (e is FormatException or JsonException) { throw new PbeCooperationConflictException("PBE_COOPERATION_CURSOR_STALE"); }
        var rows = (await Subjects(org, season, snapshot.SnapshotId, ct)).Where(s => cursor is null || string.CompareOrdinal(s.StudentId, cursor.After) > 0).ToArray();
        var items = rows.Take(take).ToArray(); string? next = rows.Length > items.Length ? Convert.ToBase64String(Encoding.UTF8.GetBytes(Serialize(new Cursor(1, org, season, snapshot.SnapshotId, "CoachDetail", items[^1].StudentId)))) : null;
        var result = new PbeCooperationStudents(season, snapshot.SnapshotId, next, items); if (Encoding.UTF8.GetByteCount(Serialize(result)) > 65536) throw new PbeChapterLimitException("InputTooLarge");
        await transaction.CommitAsync(ct); return result;
    }
}
