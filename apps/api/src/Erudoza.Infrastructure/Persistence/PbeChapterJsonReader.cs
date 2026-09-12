using System.Data;
using System.Data.Common;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
namespace Erudoza.Infrastructure.Persistence;

/// <summary>Fixed provider-owned JSON queries return bounded private metadata instead of whole session or introduction payloads.</summary>
public sealed class PbeChapterJsonReader(ErudozaDbContext db) : IPbeChapterJsonReader
{
    public static readonly System.Diagnostics.DiagnosticListener Diagnostics = new("Erudoza.PbeChapterJsonReader");
    public sealed record QueryMetric(int Statements, long Rows, long ValueBytes, long MaxBoundBytes);
    bool Sqlite => db.Database.ProviderName switch { "Microsoft.EntityFrameworkCore.Sqlite" => true, "Microsoft.EntityFrameworkCore.SqlServer" => false, _ => throw new NotSupportedException("Chapter JSON queries require SQLite or SQL Server.") };
    internal async Task<IReadOnlyList<T>> Query<T>(string sqlite, string sqlServer, IReadOnlyDictionary<string, object?> values, Func<DbDataReader, T> read, CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand(); command.CommandText = Sqlite ? sqlite : sqlServer;
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var (name, value) in values)
        {
            var p = command.CreateParameter(); p.ParameterName = name;
            p.Value = value is Guid id && Sqlite ? id.ToString().ToUpperInvariant() : value ?? DBNull.Value;
            command.Parameters.Add(p);
        }
        var measure = Diagnostics.IsEnabled("Query"); long valueBytes = 0;
        var items = new List<T>(); await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (measure) for (var i = 0; i < reader.FieldCount; i++) if (!reader.IsDBNull(i)) valueBytes += System.Text.Encoding.UTF8.GetByteCount(Convert.ToString(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture) ?? "");
            items.Add(read(reader));
        }
        if (measure) Diagnostics.Write("Query", new QueryMetric(1, items.Count, valueBytes, command.Parameters.Cast<DbParameter>().Select(p => (long)System.Text.Encoding.UTF8.GetByteCount(Convert.ToString(p.Value, System.Globalization.CultureInfo.InvariantCulture) ?? "")).DefaultIfEmpty().Max()));
        return items;
    }
    static Guid GuidAt(DbDataReader reader, int index) => reader.GetValue(index) is Guid value ? value : Guid.Parse(reader.GetString(index));
    internal static Dictionary<string, object?> Scope(Guid org, Guid season, Guid student) => new() { ["@org"] = org, ["@season"] = season, ["@student"] = student };
    const string SQLiteAssigned = "EXISTS (SELECT 1 FROM PbeTrainingRecords a WHERE a.OrganizationId=i.OrganizationId AND a.SeasonId=i.SeasonId AND a.OwnerId=@student AND a.Kind='pbe-introduction-assignment' AND json_extract(a.DataJson,'$.contentPackId')=i.Id)";
    const string SqlServerAssigned = "EXISTS (SELECT 1 FROM PbeTrainingRecords a WHERE a.OrganizationId=i.OrganizationId AND a.SeasonId=i.SeasonId AND a.OwnerId=@student AND a.Kind='pbe-introduction-assignment' AND JSON_VALUE(a.DataJson,'$.contentPackId')=i.Id)";
    public Task<IReadOnlyList<PbeSourceUnit>> IntroductionPage(Guid org, Guid season, Guid student, string after, int limit, CancellationToken ct)
        => IntroductionQuery(org, season, student, after, limit, null, ct);
    public Task<IReadOnlyList<PbeSourceUnit>> SelectedIntroductionSources(Guid org, Guid season, Guid student, IReadOnlyList<string> ids, CancellationToken ct)
    {
        if (ids.Count > 128) throw new ArgumentException("Bound introduction source IDs.");
        return IntroductionQuery(org, season, student, "", 128, ids, ct);
    }
    Task<IReadOnlyList<PbeSourceUnit>> IntroductionQuery(Guid org, Guid season, Guid student, string after, int limit, IReadOnlyList<string>? ids, CancellationToken ct)
    {
        var values = Scope(org, season, student); values["@after"] = after; values["@limit"] = limit; values["@include"] = (int)ScopeEntryKind.Include;
        values["@selected"] = ids is null ? 0 : 1; values["@ids"] = JsonSerializer.Serialize(ids ?? []);
        return Query($"""
            SELECT json_extract(u.value,'$.id'), i.Id, json_extract(i.DataJson,'$.bookKey'), CAST(u.key AS INTEGER)+1,
                   json_extract(u.value,'$.citation'), json_extract(u.value,'$.canonicalText')
            FROM PbeTrainingRecords i, json_each(i.DataJson,'$.units') u
            WHERE i.OrganizationId=@org AND i.SeasonId=@season AND i.Kind='pbe-introduction' AND i.OwnerId IS NULL
              AND {SQLiteAssigned} AND json_extract(i.DataJson,'$.reviewed')=1
              AND json_extract(i.DataJson,'$.licensingStatus') IN ('approved','public-domain','creative-commons')
              AND EXISTS (SELECT 1 FROM CompetitionMembers m WHERE m.OrganizationId=@org AND m.SeasonId=@season AND m.UserId=@student)
              AND EXISTS (SELECT 1 FROM ScopeEntries e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.Kind=@include AND upper(e.BookKey)=json_extract(i.DataJson,'$.bookKey'))
              AND (@selected=0 OR json_extract(u.value,'$.id') IN (SELECT value FROM json_each(@ids)))
              AND json_extract(u.value,'$.id')>@after ORDER BY json_extract(u.value,'$.id') LIMIT @limit
            """, $"""
            SELECT TOP(@limit) v.Id, i.Id, JSON_VALUE(i.DataJson,'$.bookKey'), CAST(u.[key] AS int)+1, v.Citation, v.CanonicalText
            FROM PbeTrainingRecords i CROSS APPLY OPENJSON(i.DataJson,'$.units') u
            CROSS APPLY OPENJSON(u.value) WITH (Id nvarchar(36) '$.id', Citation nvarchar(max) '$.citation', CanonicalText nvarchar(max) '$.canonicalText') v
            WHERE i.OrganizationId=@org AND i.SeasonId=@season AND i.Kind='pbe-introduction' AND i.OwnerId IS NULL
              AND {SqlServerAssigned} AND JSON_VALUE(i.DataJson,'$.reviewed')='true'
              AND JSON_VALUE(i.DataJson,'$.licensingStatus') IN ('approved','public-domain','creative-commons')
              AND EXISTS (SELECT 1 FROM CompetitionMembers m WHERE m.OrganizationId=@org AND m.SeasonId=@season AND m.UserId=@student)
              AND EXISTS (SELECT 1 FROM ScopeEntries e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.Kind=@include AND upper(e.BookKey)=JSON_VALUE(i.DataJson,'$.bookKey'))
              AND (@selected=0 OR v.Id IN (SELECT value FROM OPENJSON(@ids)))
              AND v.Id>@after ORDER BY v.Id
            """, values, r => new PbeSourceUnit(GuidAt(r, 0), GuidAt(r, 1), PbeSourceKind.Commentary, r.GetString(2), null, null, Convert.ToInt32(r.GetValue(3)), r.GetString(4), r.GetString(5)), ct);
    }
    public Task<IReadOnlyList<PbeTrainingRecord>> AssignedIntroductionPage(Guid org, Guid season, Guid student, string after, int limit, CancellationToken ct)
    {
        var values = Scope(org, season, student); values["@after"] = after; values["@limit"] = limit;
        return Query<PbeTrainingRecord>($"SELECT i.Id,i.Revision FROM PbeTrainingRecords i WHERE i.OrganizationId=@org AND i.SeasonId=@season AND i.Kind='pbe-introduction' AND i.OwnerId IS NULL AND {SQLiteAssigned} AND i.Id>@after ORDER BY i.Id LIMIT @limit",
            $"SELECT TOP(@limit) i.Id,i.Revision FROM PbeTrainingRecords i WHERE i.OrganizationId=@org AND i.SeasonId=@season AND i.Kind='pbe-introduction' AND i.OwnerId IS NULL AND {SqlServerAssigned} AND i.Id>@after ORDER BY i.Id",
            values, r => new() { OrganizationId = org, SeasonId = season, Kind = "pbe-introduction", Id = r.GetString(0), Revision = Convert.ToInt64(r.GetValue(1)) }, ct);
    }
    public Task<IReadOnlyList<PbeTrainingRecord>> CandidatePage(Guid org, Guid season, Guid student, string generation, string kind, string after, int limit, CancellationToken ct)
    {
        if (kind is not ("pbe-target" or "pbe-question-head")) throw new ArgumentException("Invalid chapter input family.");
        var values = Scope(org, season, student); values["@prefix"] = generation + ":inputs:%"; values["@kind"] = kind; values["@after"] = after; values["@limit"] = limit;
        return Query<PbeTrainingRecord>("""
            WITH candidates AS (SELECT r.Id,r.OwnerId,r.Revision,r.DataJson FROM PbeTrainingRecords r
            WHERE r.OrganizationId=@org AND r.SeasonId=@season AND r.Kind=@kind AND r.Id>@after
            AND EXISTS (SELECT 1 FROM PbeTrainingRecords p, json_each(p.DataJson) e
              WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE @prefix
              AND json_extract(e.value,'$[0]')='source' AND json_extract(e.value,'$[1]')=lower(r.OwnerId))
            ORDER BY r.Id LIMIT @limit),
            bounded AS (SELECT *,SUM(length(CAST(DataJson AS BLOB))+length(Id)+72) OVER(ORDER BY Id) AS bytes,row_number() OVER(ORDER BY Id) AS rn FROM candidates)
            SELECT Id,OwnerId,Revision,CASE WHEN bytes<=64000 THEN DataJson ELSE NULL END FROM bounded WHERE bytes<=64000 OR rn=1 ORDER BY Id
            """, """
            WITH candidates AS (SELECT TOP(@limit) r.Id,r.OwnerId,r.Revision,r.DataJson FROM PbeTrainingRecords r
            WHERE r.OrganizationId=@org AND r.SeasonId=@season AND r.Kind=@kind AND r.Id>@after
            AND EXISTS (SELECT 1 FROM PbeTrainingRecords p CROSS APPLY OPENJSON(p.DataJson) e
              WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE @prefix
              AND JSON_VALUE(e.value,'$[0]')='source' AND JSON_VALUE(e.value,'$[1]')=LOWER(CONVERT(nvarchar(36),r.OwnerId)))
            ORDER BY r.Id),
            bounded AS (SELECT *,SUM(CONVERT(bigint,DATALENGTH(CONVERT(varchar(max),DataJson COLLATE Latin1_General_100_BIN2_UTF8)))+LEN(Id)+72) OVER(ORDER BY Id) AS bytes,row_number() OVER(ORDER BY Id) AS rn FROM candidates)
            SELECT Id,OwnerId,Revision,CASE WHEN bytes<=64000 THEN DataJson ELSE NULL END FROM bounded WHERE bytes<=64000 OR rn=1 ORDER BY Id
            """, values, r => r.IsDBNull(3) ? throw new Erudoza.Application.Study.PbeChapterLimitException("InputTooLarge") : new() { OrganizationId = org, SeasonId = season, Kind = kind, Id = r.GetString(0), OwnerId = GuidAt(r, 1), Revision = Convert.ToInt64(r.GetValue(2)), DataJson = r.GetString(3) }, ct);
    }
    public Task<IReadOnlyList<string>> ManifestEntries(Guid org, Guid season, Guid student, string generation, string family, IReadOnlyList<string>? ids, CancellationToken ct)
    {
        if (ids?.Count > 1000) throw new ArgumentException("Bound chapter metadata lookup IDs.");
        var values = Scope(org, season, student); values["@prefix"] = generation + ":inputs:%"; values["@family"] = family; values["@ids"] = JsonSerializer.Serialize(ids ?? []); values["@all"] = ids is null ? 1 : 0;
        return Query("""
            SELECT e.value FROM PbeTrainingRecords p, json_each(p.DataJson) e
            WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE @prefix
              AND json_extract(e.value,'$[0]')=@family AND (@all=1 OR json_extract(e.value,'$[1]') IN (SELECT value FROM json_each(@ids)))
            ORDER BY json_extract(e.value,'$[1]')
            """, """
            SELECT e.value FROM PbeTrainingRecords p CROSS APPLY OPENJSON(p.DataJson) e
            WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE @prefix
              AND JSON_VALUE(e.value,'$[0]')=@family AND (@all=1 OR JSON_VALUE(e.value,'$[1]') IN (SELECT value FROM OPENJSON(@ids)))
            ORDER BY JSON_VALUE(e.value,'$[1]')
            """, values, r => r.GetString(0), ct);
    }
    public Task<IReadOnlyList<PbeTrainingRecord>> LegacyEventPage(Guid org, Guid season, Guid student, string after, CancellationToken ct)
    {
        var values = Scope(org, season, student); values["@after"] = after;
        return Query<PbeTrainingRecord>("""
            WITH candidates AS (SELECT Id,DataJson,Revision FROM PbeTrainingRecords WHERE OrganizationId=@org AND SeasonId=@season AND OwnerId=@student AND Kind='pbe-recall-event' AND Id>@after ORDER BY Id LIMIT 25),
            bounded AS (SELECT *,SUM(length(CAST(DataJson AS BLOB))+length(Id)+32) OVER(ORDER BY Id) AS bytes FROM candidates)
            SELECT Id,DataJson,Revision FROM bounded WHERE bytes<=64000 OR Id=(SELECT MIN(Id) FROM candidates) ORDER BY Id
            """, """
            WITH candidates AS (SELECT TOP(25) Id,DataJson,Revision FROM PbeTrainingRecords WHERE OrganizationId=@org AND SeasonId=@season AND OwnerId=@student AND Kind='pbe-recall-event' AND Id>@after ORDER BY Id),
            bounded AS (SELECT *,SUM(CONVERT(bigint,DATALENGTH(CONVERT(varchar(max),DataJson COLLATE Latin1_General_100_BIN2_UTF8)))+LEN(Id)+32) OVER(ORDER BY Id) AS bytes FROM candidates)
            SELECT Id,DataJson,Revision FROM bounded WHERE bytes<=64000 OR Id=(SELECT MIN(Id) FROM candidates) ORDER BY Id
            """, values, r => new() { OrganizationId = org, SeasonId = season, OwnerId = student, Kind = "pbe-recall-event", Id = r.GetString(0), DataJson = r.GetString(1), Revision = Convert.ToInt64(r.GetValue(2)) }, ct);
    }
    public Task<IReadOnlyList<PbeReplayTargetState>> ReplayStates(Guid org, Guid season, Guid student, IReadOnlyList<Guid> targets, CancellationToken ct)
    {
        if (targets.Count > 128) throw new ArgumentException("Bound replay target metadata.");
        var values = Scope(org, season, student); values["@ids"] = JsonSerializer.Serialize(targets); values["@owner"] = $"{student}:{season}:";
        return Query<PbeReplayTargetState>("""
            SELECT t.value, CASE WHEN coalesce(json_extract(p.DataJson,'$.retention.ruleVersion'),'')<>'pbe-retention-v1'
              OR (d.Id IS NULL AND json_extract(p.DataJson,'$.retention.dataGap')=1)
              OR json_extract(d.DataJson,'$.generation')<>json_extract(d.DataJson,'$.completedGeneration') THEN 1 ELSE 0 END,
              CASE WHEN p.Id IS NULL THEN 0 ELSE 1 END,
              CASE WHEN EXISTS (SELECT 1 FROM PbeTrainingRecords e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.OwnerId=@student AND e.Kind='pbe-evidence-ref' AND e.Id>@owner||t.value||':' AND e.Id<@owner||t.value||';') THEN 1 ELSE 0 END
            FROM json_each(@ids) t
            LEFT JOIN PbeTrainingRecords p ON p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-target-review' AND p.Id=@owner||t.value
            LEFT JOIN PbeTrainingRecords d ON d.OrganizationId=@org AND d.SeasonId=@season AND d.OwnerId=@student AND d.Kind='pbe-evidence-dirty' AND d.Id=@owner||t.value
            ORDER BY t.value
            """, """
            SELECT t.value, CASE WHEN coalesce(JSON_VALUE(p.DataJson,'$.retention.ruleVersion'),'')<>'pbe-retention-v1'
              OR (d.Id IS NULL AND JSON_VALUE(p.DataJson,'$.retention.dataGap')='true')
              OR JSON_VALUE(d.DataJson,'$.generation')<>JSON_VALUE(d.DataJson,'$.completedGeneration') THEN 1 ELSE 0 END,
              CASE WHEN p.Id IS NULL THEN 0 ELSE 1 END,
              CASE WHEN EXISTS (SELECT 1 FROM PbeTrainingRecords e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.OwnerId=@student AND e.Kind='pbe-evidence-ref' AND e.Id>CONCAT(@owner,t.value,':') AND e.Id<CONCAT(@owner,t.value,';')) THEN 1 ELSE 0 END
            FROM OPENJSON(@ids) t
            LEFT JOIN PbeTrainingRecords p ON p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-target-review' AND p.Id=CONCAT(@owner,t.value)
            LEFT JOIN PbeTrainingRecords d ON d.OrganizationId=@org AND d.SeasonId=@season AND d.OwnerId=@student AND d.Kind='pbe-evidence-dirty' AND d.Id=CONCAT(@owner,t.value)
            ORDER BY t.value
            """, values, r => new(Guid.Parse(r.GetString(0)), Convert.ToInt32(r.GetValue(1)) == 1, Convert.ToInt32(r.GetValue(2)) == 1, Convert.ToInt32(r.GetValue(3)) == 1), ct);
    }
    const string SQLiteCapturedTargets = """
        capturedTargets AS MATERIALIZED (
          SELECT DISTINCT json_extract(e.value,'$[1]') AS targetId FROM PbeTrainingRecords p,json_each(p.DataJson) e
          WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE @prefix
            AND json_extract(e.value,'$[0]')='target')
        """;
    const string ServerCapturedTargets = """
        capturedTargets AS (
          SELECT DISTINCT JSON_VALUE(e.value,'$[1]') AS targetId FROM PbeTrainingRecords p CROSS APPLY OPENJSON(p.DataJson) e
          WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE @prefix
            AND JSON_VALUE(e.value,'$[0]')='target')
        """;
    public Task<IReadOnlyList<PbeTrainingRecord>> CurrentRetentionPage(Guid org, Guid season, Guid student, string generation, string after, CancellationToken ct)
        => CurrentRetentionRows(org, season, student, generation, after, true, ct);
    // Only actual publication/current GET reads the whole capped current set.
    public Task<IReadOnlyList<PbeTrainingRecord>> CurrentRetentions(Guid org, Guid season, Guid student, string generation, CancellationToken ct)
        => CurrentRetentionRows(org, season, student, generation, "", false, ct);
    Task<IReadOnlyList<PbeTrainingRecord>> CurrentRetentionRows(Guid org, Guid season, Guid student, string generation, string after, bool page, CancellationToken ct)
    {
        var values = Scope(org, season, student); values["@prefix"] = generation + ":inputs:%"; values["@owner"] = $"{student}:{season}:"; values["@after"] = $"{student}:{season}:" + after;
        values["@limit"] = page ? 128 : 10001; values["@page"] = page ? 1 : 0;
        return Query<PbeTrainingRecord>("WITH " + SQLiteCapturedTargets + """
            , candidates AS (
              SELECT r.Id,r.Revision,r.DataJson FROM capturedTargets t JOIN PbeTrainingRecords r ON r.Id=@owner||t.targetId
              WHERE r.OrganizationId=@org AND r.SeasonId=@season AND r.OwnerId=@student AND r.Kind='pbe-target-review' AND r.Id>@after
              ORDER BY r.Id LIMIT @limit),
            bounded AS (SELECT *,SUM(length(CAST(DataJson AS BLOB))+length(Id)+32) OVER(ORDER BY Id) AS bytes,row_number() OVER(ORDER BY Id) AS rn FROM candidates)
            SELECT Id,Revision,CASE WHEN @page=0 OR bytes<=64000 THEN DataJson ELSE NULL END FROM bounded WHERE @page=0 OR bytes<=64000 OR rn=1 ORDER BY Id
            """, "WITH " + ServerCapturedTargets + """
            , candidates AS (
              SELECT TOP(@limit) r.Id,r.Revision,r.DataJson FROM capturedTargets t JOIN PbeTrainingRecords r ON r.Id=CONCAT(@owner,t.targetId)
              WHERE r.OrganizationId=@org AND r.SeasonId=@season AND r.OwnerId=@student AND r.Kind='pbe-target-review' AND r.Id>@after
              ORDER BY r.Id),
            bounded AS (SELECT *,SUM(CONVERT(bigint,DATALENGTH(CONVERT(varchar(max),DataJson COLLATE Latin1_General_100_BIN2_UTF8)))+LEN(Id)+32) OVER(ORDER BY Id) AS bytes,row_number() OVER(ORDER BY Id) AS rn FROM candidates)
            SELECT Id,Revision,CASE WHEN @page=0 OR bytes<=64000 THEN DataJson ELSE NULL END FROM bounded WHERE @page=0 OR bytes<=64000 OR rn=1 ORDER BY Id
            """, values, r => r.IsDBNull(2) ? throw new Erudoza.Application.Study.PbeChapterLimitException("InputTooLarge") : new() { OrganizationId = org, SeasonId = season, OwnerId = student, Kind = "pbe-target-review", Id = r.GetString(0), Revision = Convert.ToInt64(r.GetValue(1)), DataJson = r.GetString(2) }, ct);
    }
    public Task<IReadOnlyList<PbeFrozenMetadata>> FrozenMetadata(Guid org, Guid season, Guid student, IReadOnlyList<string> attemptIds, CancellationToken ct)
    {
        if (attemptIds.Count > 32) throw new ArgumentException("Bound frozen evidence pages.");
        var values = Scope(org, season, student); values["@ids"] = JsonSerializer.Serialize(attemptIds);
        return Query<PbeFrozenMetadata>("""
            SELECT a.Id, json_extract(c.value,'$.question.id'), json_extract(c.value,'$.question.version'), json_extract(a.DataJson,'$.responseLockedAtUtc'), (SELECT group_concat(json_extract(t.value,'$.id'),',') FROM json_each(c.value,'$.targets') t)
            FROM PbeTrainingRecords a JOIN PbeTrainingRecords s ON s.OrganizationId=a.OrganizationId AND s.SeasonId=a.SeasonId AND s.OwnerId=a.OwnerId AND s.Kind='pbe-session' AND s.Id=json_extract(a.DataJson,'$.sessionId'), json_each(s.DataJson,'$.cards') c
            WHERE a.OrganizationId=@org AND a.SeasonId=@season AND a.OwnerId=@student AND a.Kind='pbe-attempt' AND a.Id IN (SELECT value FROM json_each(@ids))
              AND json_extract(c.value,'$.id')=json_extract(a.DataJson,'$.cardId')
            """, """
            SELECT a.Id, JSON_VALUE(c.value,'$.question.id'), TRY_CONVERT(int,JSON_VALUE(c.value,'$.question.version')), JSON_VALUE(a.DataJson,'$.responseLockedAtUtc'), (SELECT STRING_AGG(JSON_VALUE(t.value,'$.id'),',') FROM OPENJSON(c.value,'$.targets') t)
            FROM PbeTrainingRecords a JOIN PbeTrainingRecords s ON s.OrganizationId=a.OrganizationId AND s.SeasonId=a.SeasonId AND s.OwnerId=a.OwnerId AND s.Kind='pbe-session' AND s.Id=JSON_VALUE(a.DataJson,'$.sessionId') CROSS APPLY OPENJSON(s.DataJson,'$.cards') c
            WHERE a.OrganizationId=@org AND a.SeasonId=@season AND a.OwnerId=@student AND a.Kind='pbe-attempt' AND a.Id IN (SELECT value FROM OPENJSON(@ids))
              AND JSON_VALUE(c.value,'$.id')=JSON_VALUE(a.DataJson,'$.cardId')
            """, values, r => new(r.GetString(0), GuidAt(r, 1), r.IsDBNull(2) ? null : Convert.ToInt32(r.GetValue(2)), r.IsDBNull(3) ? null : DateTimeOffset.Parse(r.GetString(3), System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds(), r.IsDBNull(4) ? [] : r.GetString(4).Split(',').Select(Guid.Parse).ToArray()), ct);
    }
}
