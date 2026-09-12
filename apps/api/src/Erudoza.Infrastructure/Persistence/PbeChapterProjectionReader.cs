using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain.Practice;
namespace Erudoza.Infrastructure.Persistence;

/// <summary>
/// Projects the immutable, scoped tuple manifest inside the database. Windows may inspect the complete
/// capped metadata set, but only one 128-row/64-KiB page crosses the reader boundary. No source text,
/// answer payload, or complete manifest is hydrated here.
/// </summary>
public sealed class PbeChapterProjectionReader(ErudozaDbContext db) : IPbeChapterProjectionReader
{
    readonly PbeChapterJsonReader reader = new(db);
    const int MaxBytes = 65536;
    const string SqliteEntries = """
        entries AS (
          SELECT json_extract(e.value,'$[0]') AS family, lower(json_extract(e.value,'$[1]')) AS id,
            json_extract(e.value,'$[2]') AS payload, e.value AS tuple
          FROM PbeTrainingRecords p, json_each(p.DataJson) e
          WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student
            AND p.Kind='pbe-chapter-manifest' AND substr(p.Id,1,length(@prefix))=@prefix)
        """;
    // Entry 2 is a serialized JSON STRING. OPENJSON WITH nvarchar(max) preserves values above 4,000
    // characters, unlike JSON_VALUE. Binary collations preserve ordinal keys independently of database defaults.
    const string ServerEntries = """
        entries AS (
          SELECT v.family, lower(v.id) COLLATE Latin1_General_100_BIN2 AS id, v.payload, e.value AS tuple
          FROM PbeTrainingRecords p CROSS APPLY OPENJSON(p.DataJson) e
          CROSS APPLY OPENJSON(e.value) WITH (family nvarchar(32) '$[0]', id nvarchar(36) '$[1]', payload nvarchar(max) '$[2]') v
          WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId=@student
            AND p.Kind='pbe-chapter-manifest' AND LEFT(p.Id,LEN(@prefix)) COLLATE Latin1_General_100_BIN2=@prefix)
        """;
    const string SqliteSources = """
        , sourceRows AS (
          SELECT id, lower(payload) AS packId, json_extract(tuple,'$[4]') AS bookKey,
            CASE WHEN json_extract(tuple,'$[3]')='Scripture' THEN json_extract(tuple,'$[5]') END AS chapter,
            json_extract(tuple,'$[6]') AS verse,
            CASE WHEN json_extract(tuple,'$[3]')='Scripture' THEN
              'chapter:'||lower(payload)||':'||json_extract(tuple,'$[4]')||':'||json_extract(tuple,'$[5]')
              ELSE 'intro:'||lower(payload) END AS parentKey
          FROM entries WHERE family='source')
        """;
    const string ServerSources = """
        , sourceRows AS (
          SELECT id, lower(payload) COLLATE Latin1_General_100_BIN2 AS packId,
            s.bookKey COLLATE Latin1_General_100_BIN2 AS bookKey,
            CASE WHEN s.kind='Scripture' THEN s.chapter END AS chapter, s.verse,
            CASE WHEN s.kind='Scripture' THEN CONCAT('chapter:',lower(payload),':',s.bookKey,':',s.chapter)
              ELSE CONCAT('intro:',lower(payload)) END COLLATE Latin1_General_100_BIN2 AS parentKey
          FROM entries CROSS APPLY OPENJSON(CASE WHEN family='source' THEN tuple ELSE '[]' END) WITH (kind nvarchar(32) '$[3]', bookKey nvarchar(max) '$[4]', chapter int '$[5]', verse int '$[6]') s
          WHERE family='source')
        """;
    const string Windows = """
        , numbered AS (SELECT *,verse-row_number() OVER(PARTITION BY parentKey ORDER BY verse,id) AS run FROM sourceRows WHERE chapter IS NOT NULL),
        runs AS (SELECT *,count(*) OVER(PARTITION BY parentKey,run) AS n,row_number() OVER(PARTITION BY parentKey,run ORDER BY verse,id) AS pos FROM numbered),
        lengths AS (SELECT *,((n+4)/5) AS k FROM runs),
        sizes AS (SELECT *,n/k AS base,n%k AS extra FROM lengths),
        balanced AS (SELECT *,CASE WHEN pos<=(base+1)*extra THEN (pos-1)/(base+1) ELSE extra+(pos-1-(base+1)*extra)/base END AS groupNo FROM sizes),
        boundaries AS (SELECT *,first_value(id) OVER(PARTITION BY parentKey,run,groupNo ORDER BY verse,id) AS firstId,first_value(id) OVER(PARTITION BY parentKey,run,groupNo ORDER BY verse DESC,id DESC) AS lastId FROM balanced)
        """;
    const string SqliteMembers = ", members AS (SELECT id,parentKey,'group:'||parentKey||':'||firstId||':'||lastId AS groupKey FROM boundaries UNION ALL SELECT id,parentKey,null FROM sourceRows WHERE chapter IS NULL)";
    const string ServerMembers = ", members AS (SELECT id,parentKey,CONCAT('group:',parentKey,':',firstId,':',lastId) AS groupKey FROM boundaries UNION ALL SELECT id,parentKey,null FROM sourceRows WHERE chapter IS NULL)";
    const string Selected = ", selected AS (SELECT id FROM members WHERE parentKey=@group OR groupKey=@group)";
    const string Groups = """
        , groups AS (
          SELECT parentKey AS groupKey,CAST(null AS nvarchar(max)) AS parentChapterKey,
            CASE WHEN chapter IS NULL THEN 'Introduction' ELSE 'Chapter' END AS kind,packId,bookKey,chapter,
            count(*) AS assignedPassages,0 AS firstVerse,0 AS lastVerse
          FROM sourceRows GROUP BY parentKey,packId,bookKey,chapter
          UNION ALL
          SELECT m.groupKey,m.parentKey,'PassageGroup',s.packId,s.bookKey,s.chapter,count(*),min(s.verse),max(s.verse)
          FROM members m JOIN sourceRows s ON s.id=m.id WHERE m.groupKey IS NOT NULL
          GROUP BY m.groupKey,m.parentKey,s.packId,s.bookKey,s.chapter)
        """;
    static string SqliteGroupCtes => SqliteEntries + SqliteSources + Windows + SqliteMembers;
    static string ServerGroupCtes => ServerEntries + ServerSources + Windows + ServerMembers;
    static Dictionary<string, object?> Scope(Guid org, Guid season, Guid student, string generation)
    {
        if (!Guid.TryParseExact(generation, "D", out _)) throw new ArgumentException("Expected an owned chapter generation UUID.", nameof(generation));
        var values = PbeChapterJsonReader.Scope(org, season, student);
        values["@prefix"] = generation + ":inputs:";
        return values;
    }
    static string Input<T>(IReadOnlyList<T> values)
    {
        if (values.Count > 128) throw new PbeChapterLimitException("InputTooLarge");
        var json = JsonSerializer.Serialize(values, PbeQuestionBank.Json);
        if (Encoding.UTF8.GetByteCount(json) > MaxBytes) throw new PbeChapterLimitException("InputTooLarge");
        return json;
    }
    // Payload lengths are computed before transfer. A null first row reports an oversized record without
    // reading that record into managed memory. Prefix pages continue from the last returned identity.
    static string Budget(string ctes, string candidates, bool sqlite, bool explicitIds)
    {
        // UTF-8 varchar collations require SQL Server 2019+. SQL execution remains provider-owned.
        var length = sqlite ? "length(CAST(payload AS BLOB))" : "DATALENGTH(CONVERT(varchar(max),payload COLLATE Latin1_General_100_BIN2_UTF8))";
        var page = sqlite ? "SELECT * FROM candidates ORDER BY orderKey LIMIT 128" : "SELECT TOP(128) * FROM candidates ORDER BY orderKey";
        var predicate = explicitIds ? "totalBytes<=65536 OR rn=1" : "runningBytes<=65536 OR rn=1";
        var accepted = explicitIds ? "totalBytes<=65536" : "runningBytes<=65536";
        return $"""
            WITH {ctes}, candidates AS ({candidates}), page AS ({page}),
            measured AS (SELECT *,{length}+1 AS bytes FROM page),
            bounded AS (SELECT *,row_number() OVER(ORDER BY orderKey) AS rn,
              1+sum(bytes) OVER(ORDER BY orderKey ROWS UNBOUNDED PRECEDING) AS runningBytes,
              1+sum(bytes) OVER() AS totalBytes FROM measured)
            SELECT CASE WHEN {accepted} THEN payload ELSE NULL END FROM bounded WHERE {predicate} ORDER BY orderKey
            """;
    }
    async Task<IReadOnlyList<T>> Page<T>(string sqliteCtes, string serverCtes, string sqliteCandidates, string serverCandidates,
        Dictionary<string, object?> values, CancellationToken ct, bool explicitIds = false)
    {
        var rows = await reader.Query(Budget(sqliteCtes, sqliteCandidates, true, explicitIds), Budget(serverCtes, serverCandidates, false, explicitIds),
            values, r => r.IsDBNull(0) ? throw new PbeChapterLimitException("InputTooLarge") : r.GetString(0), ct);
        var result = new List<T>(); var bytes = 2;
        foreach (var row in rows)
        {
            var item = JsonSerializer.Deserialize<T>(row, PbeQuestionBank.Json) ?? throw new JsonException("Missing chapter metadata.");
            var size = JsonSerializer.SerializeToUtf8Bytes(item, PbeQuestionBank.Json).Length + (result.Count == 0 ? 0 : 1);
            if (bytes + size > MaxBytes)
            {
                if (explicitIds || result.Count == 0) throw new PbeChapterLimitException("InputTooLarge");
                break;
            }
            result.Add(item); bytes += size;
        }
        return result;
    }
    public Task<IReadOnlyList<PbeChapterGroupMetadata>> GroupPage(Guid org, Guid season, Guid student, string generation, string after, CancellationToken ct)
    {
        var values = Scope(org, season, student, generation); values["@after"] = after;
        const string sqliteOrdered = """
            , ordered AS (SELECT *,bookKey||':'||printf('%08d',coalesce(chapter,99999999))||':'||packId||':'||printf('%08d',firstVerse)||':'||groupKey AS sortKey FROM groups)
            """;
        const string serverOrdered = """
            , ordered AS (SELECT *,CONCAT(bookKey,':',RIGHT('00000000'+CONVERT(varchar(8),coalesce(chapter,99999999)),8),':',packId,':',RIGHT('00000000'+CONVERT(varchar(8),firstVerse),8),':',groupKey) COLLATE Latin1_General_100_BIN2 AS sortKey FROM groups)
            """;
        return Page<PbeChapterGroupMetadata>(SqliteGroupCtes + Groups.Replace("nvarchar(max)", "TEXT", StringComparison.Ordinal) + sqliteOrdered,
            ServerGroupCtes + Groups + serverOrdered, """
            SELECT sortKey AS orderKey,json_object('key',groupKey,'parentChapterKey',parentChapterKey,'kind',kind,
              'contentPackId',packId,'bookKey',bookKey,'chapter',chapter,'assignedPassages',assignedPassages,
              'label',CASE WHEN kind='Introduction' THEN bookKey||' introduction' WHEN kind='Chapter' THEN bookKey||' '||chapter
                ELSE bookKey||' '||chapter||':'||firstVerse||CASE WHEN firstVerse=lastVerse THEN '' ELSE '–'||lastVerse END END,
              'scopeLabel',assignedPassages||CASE WHEN kind='Introduction' THEN ' assigned introduction units' ELSE ' assigned verses' END,
              'sortKey',sortKey) AS payload FROM ordered WHERE sortKey>@after
            """, """
            SELECT sortKey AS orderKey,(SELECT groupKey AS [key],parentChapterKey,kind,packId AS contentPackId,bookKey,chapter,assignedPassages,
              CASE WHEN kind='Introduction' THEN CONCAT(bookKey,' introduction') WHEN kind='Chapter' THEN CONCAT(bookKey,' ',chapter)
                ELSE CONCAT(bookKey,' ',chapter,':',firstVerse,CASE WHEN firstVerse=lastVerse THEN '' ELSE CONCAT(N'–',lastVerse) END) END AS label,
              CONCAT(assignedPassages,CASE WHEN kind='Introduction' THEN ' assigned introduction units' ELSE ' assigned verses' END) AS scopeLabel,
              sortKey FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) AS payload FROM ordered WHERE sortKey>@after
            """, values, ct);
    }
    public Task<IReadOnlyList<PbeTarget>> GroupTargets(Guid org, Guid season, Guid student, string generation, string groupKey, string after, CancellationToken ct)
    {
        var values = Scope(org, season, student, generation); values["@group"] = groupKey; values["@after"] = after.ToLowerInvariant();
        return Page<PbeTarget>(SqliteGroupCtes + Selected, ServerGroupCtes + Selected, """
            SELECT id AS orderKey,payload FROM entries e WHERE family='target' AND id>@after
              AND EXISTS (SELECT 1 FROM json_each(CASE WHEN e.family IN ('target','question') THEN e.payload ELSE '{}' END,'$.sourceUnitIds') u WHERE lower(u.value) IN (SELECT id FROM selected))
            """, """
            SELECT id AS orderKey,payload FROM entries e WHERE family='target' AND id>@after
              AND EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN e.family IN ('target','question') THEN e.payload ELSE '{}' END,'$.sourceUnitIds') u WHERE lower(u.value) COLLATE Latin1_General_100_BIN2 IN (SELECT id FROM selected))
            """, values, ct);
    }
    public async Task<int> CoveredPassages(Guid org, Guid season, Guid student, string generation, string groupKey, CancellationToken ct)
    {
        var values = Scope(org, season, student, generation); values["@group"] = groupKey;
        var counts = await reader.Query("WITH " + SqliteGroupCtes + Selected + " SELECT count(DISTINCT lower(u.value)) FROM entries e,json_each(CASE WHEN e.family IN ('target','question') THEN e.payload ELSE '{}' END,'$.sourceUnitIds') u WHERE e.family='question' AND lower(u.value) IN (SELECT id FROM selected)",
            "WITH " + ServerGroupCtes + Selected + " SELECT count(DISTINCT lower(u.value) COLLATE Latin1_General_100_BIN2) FROM entries e CROSS APPLY OPENJSON(CASE WHEN e.family IN ('target','question') THEN e.payload ELSE '{}' END,'$.sourceUnitIds') u WHERE e.family='question' AND lower(u.value) COLLATE Latin1_General_100_BIN2 IN (SELECT id FROM selected)",
            values, r => Convert.ToInt32(r.GetValue(0)), ct);
        return counts.Single();
    }
    public async Task<IReadOnlyDictionary<Guid, int>> VariantCounts(Guid org, Guid season, Guid student, string generation, IReadOnlyList<PbeTarget> targets, CancellationToken ct)
    {
        var values = Scope(org, season, student, generation);
        values["@targets"] = Input(targets.Select(t => new { t.Id, t.Skill }).ToArray());
        var counts = await reader.Query("WITH " + SqliteEntries + """
            , requested AS (SELECT lower(json_extract(value,'$.id')) AS id,json_extract(value,'$.skill') AS skill FROM json_each(@targets)),
            headParts AS MATERIALIZED (
              SELECT q.id AS questionId,json_extract(q.payload,'$.kind') AS kind,lower(json_extract(p.value,'$.targetId')) AS targetId
              FROM entries q,json_each(CASE WHEN q.family='question' THEN q.payload ELSE '{}' END,'$.parts') p
              WHERE q.family='question' AND json_extract(q.payload,'$.kind')<>'TrueFalse')
            SELECT t.id,count(DISTINCT h.questionId) FROM requested t LEFT JOIN headParts h
              ON h.targetId=t.id AND (t.skill<>'ExactWords' OR h.kind='ExactWords')
            GROUP BY t.id ORDER BY t.id
            """, "WITH " + ServerEntries + """
            , requested AS (SELECT lower(t.id) COLLATE Latin1_General_100_BIN2 AS id,t.skill FROM OPENJSON(@targets) WITH (id nvarchar(36) '$.id',skill nvarchar(32) '$.skill') t),
            headParts AS (
              SELECT q.id AS questionId,JSON_VALUE(q.payload,'$.kind') AS kind,lower(JSON_VALUE(p.value,'$.targetId')) COLLATE Latin1_General_100_BIN2 AS targetId
              FROM entries q CROSS APPLY OPENJSON(CASE WHEN q.family='question' THEN q.payload ELSE '{}' END,'$.parts') p
              WHERE q.family='question' AND JSON_VALUE(q.payload,'$.kind')<>'TrueFalse'),
            headCounts AS (SELECT targetId,count(DISTINCT questionId) AS factualCount,count(DISTINCT CASE WHEN kind='ExactWords' THEN questionId END) AS exactCount FROM headParts GROUP BY targetId)
            SELECT t.id,coalesce(CASE WHEN t.skill='ExactWords' THEN h.exactCount ELSE h.factualCount END,0)
            FROM requested t LEFT JOIN headCounts h ON h.targetId=t.id ORDER BY t.id
            """, values, r => (Id: Guid.Parse(r.GetString(0)), Count: Convert.ToInt32(r.GetValue(1))), ct);
        return counts.ToDictionary(r => r.Id, r => r.Count);
    }
    public async Task<IReadOnlyList<Guid>> TargetIds(Guid org, Guid season, Guid student, string generation, string after, CancellationToken ct)
    {
        var values = Scope(org, season, student, generation); values["@after"] = after.ToLowerInvariant();
        return await reader.Query("WITH " + SqliteEntries + " SELECT id FROM entries WHERE family='target' AND id>@after ORDER BY id LIMIT 128",
            "WITH " + ServerEntries + " SELECT TOP(128) id FROM entries WHERE family='target' AND id>@after ORDER BY id",
            values, r => Guid.Parse(r.GetString(0)), ct);
    }
    public Task<IReadOnlyList<PbeCapturedRetention>> RetentionPage(Guid org, Guid season, Guid student, string generation, IReadOnlyList<Guid> targetIds, CancellationToken ct)
        => RetentionLookup(org, season, student, generation, targetIds, ct, false);
    public Task<IReadOnlyList<PbeCapturedRetention>> Retentions(Guid org, Guid season, Guid student, string generation, IReadOnlyList<Guid> targetIds, CancellationToken ct)
        => RetentionLookup(org, season, student, generation, targetIds, ct, true);
    Task<IReadOnlyList<PbeCapturedRetention>> RetentionLookup(Guid org, Guid season, Guid student, string generation, IReadOnlyList<Guid> targetIds, CancellationToken ct, bool explicitIds)
    {
        var values = Scope(org, season, student, generation); values["@ids"] = Input(targetIds);
        return Page<PbeCapturedRetention>(SqliteEntries, ServerEntries, """
            SELECT id AS orderKey,json_object('targetId',id,'projection',json(payload),'revision',json_extract(tuple,'$[3]')) AS payload
            FROM entries WHERE family='retention' AND id IN (SELECT value FROM json_each(@ids))
            """, """
            SELECT id AS orderKey,(SELECT id AS targetId,JSON_QUERY(payload) AS projection,CONVERT(bigint,JSON_VALUE(tuple,'$[3]')) AS revision
              FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS payload
            FROM entries WHERE family='retention' AND id IN (SELECT value FROM OPENJSON(@ids))
            """, values, ct, explicitIds: explicitIds);
    }
}
