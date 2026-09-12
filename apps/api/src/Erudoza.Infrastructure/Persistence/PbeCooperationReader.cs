using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using System.Data;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore;
namespace Erudoza.Infrastructure.Persistence;

/// <summary>Provider-owned compact set capture. JSON scans stay in the provider; every ordinary result has a SQL byte prefix.</summary>
public sealed class PbeCooperationReader(ErudozaDbContext db) : IPbeCooperationReader
{
    readonly PbeChapterJsonReader reader = new(db);
    sealed class Sql(bool sqlite)
    {
        public string Id(string x) => sqlite ? $"lower({x})" : $"lower(CONVERT(varchar(36),{x}))";
        public string S(string x, string path) => sqlite ? $"json_extract({x},'{path}')" : $"(SELECT v FROM OPENJSON({x}) WITH(v nvarchar(max) '{path}'))";
        public string J(string x, string path) => sqlite ? $"json_extract({x},'{path}')" : $"JSON_QUERY({x},'{path}')";
        public string B(string x, string path) => $"CASE WHEN CAST({S(x, path)} AS varchar(8)) IN ('true','1') THEN 1 ELSE 0 END";
        public string Each(string x, string alias) => sqlite ? $"json_each({x}) {alias}" : $"OPENJSON({x}) {alias}";
        public string JoinEach(string x, string alias) => sqlite ? $"JOIN {Each(x, alias)}" : $"CROSS APPLY {Each(x, alias)}";
        public string Cat(params string[] xs) => sqlite ? $"({string.Join("||", xs)})" : $"CONCAT({string.Join(',', xs)})";
        public string Bytes(string x) => sqlite ? $"length(CAST({x} AS BLOB))" : $"DATALENGTH(CONVERT(varchar(max),{x} COLLATE Latin1_General_100_BIN2_UTF8))";
        public string A(params string[] xs)
        {
            string Part(string x)
            {
                if (x[0] == '#') return sqlite ? x[1..] : $"COALESCE(CONVERT(nvarchar(max),{x[1..]}),'null')";
                if (x[0] == '?') return sqlite ? $"json(CASE WHEN {x[1..]}<>0 THEN 'true' ELSE 'false' END)" : $"CASE WHEN {x[1..]}<>0 THEN 'true' ELSE 'false' END";
                if (x[0] == '@') return sqlite ? $"json({x[1..]})" : $"COALESCE({x[1..]},'null')";
                return sqlite ? x : $"CASE WHEN {x} IS NULL THEN 'null' ELSE CONCAT('\"',STRING_ESCAPE(CONVERT(nvarchar(max),{x}),'json'),'\"') END";
            }
            return sqlite ? $"json_array({string.Join(',', xs.Select(Part))})" : Cat("'['", string.Join(",',',", xs.Select(Part)), "']'");
        }
        public string Exact(string value) => sqlite ? value : $"({value} COLLATE Latin1_General_100_BIN2)";
        public string TupleEqual(string a, string b) => $"NOT EXISTS(SELECT [key],type,{Exact("value")} FROM {Each(a, "aa")} EXCEPT SELECT [key],type,{Exact("value")} FROM {Each(b, "bb")}) AND NOT EXISTS(SELECT [key],type,{Exact("value")} FROM {Each(b, "bb")} EXCEPT SELECT [key],type,{Exact("value")} FROM {Each(a, "aa")})";
        public string Limit(string sql, int n) => sqlite ? sql + $" LIMIT {n}" : $"SELECT TOP({n}) " + sql[7..];
        public string Prefix(string ctes, string rows, int limit = 128) => $"{ctes}, candidates AS ({Limit(rows, limit)}), sized AS (SELECT *,SUM({Bytes("payload")}+512) OVER(ORDER BY key) AS totalBytes,ROW_NUMBER() OVER(ORDER BY key) AS rn FROM candidates) SELECT key,CASE WHEN totalBytes<=58000 THEN payload ELSE NULL END FROM sized WHERE totalBytes<=58000 OR rn=1 ORDER BY key";
    }
    Dictionary<string, object?> Args(VerifiedCooperationScope scope, string generation = "", string after = "") => new() { ["@org"] = scope.OrganizationId, ["@season"] = scope.SeasonId, ["@generation"] = generation, ["@after"] = after, ["@builtin"] = BuiltInLibrary.OrganizationId };
    async Task<IReadOnlyList<T>> Query<T>(Func<Sql, string> sql, Dictionary<string, object?> args, Func<System.Data.Common.DbDataReader, T> read, CancellationToken ct)
    {
        return await reader.Query(sql(new(true)), sql(new(false)), args, read, ct);
    }
    static JsonElement Parse(string value) => JsonSerializer.Deserialize<JsonElement>(value);
    static string Payload(System.Data.Common.DbDataReader r) => r.IsDBNull(1) ? throw new PbeChapterLimitException("InputTooLarge") : r.GetString(1);
    static string T(string value) => "'" + value + "'";
    string Current(Sql q)
    {
        var sid = q.Id("u.Id"); var source = q.Id("s.Id"); var pack = q.Id("s.ContentPackId");
        string Range(string a) => $"{a}.ContentPackId=s.ContentPackId AND upper({a}.BookKey)=upper(s.BookKey) AND s.Chapter>={a}.StartChapter AND s.Chapter<={a}.EndChapter AND (s.Chapter<>{a}.StartChapter OR s.Verse>={a}.StartVerse) AND (s.Chapter<>{a}.EndChapter OR s.Verse<={a}.EndVerse)";
        string control(string family, string id, string tuple, string from) => $"SELECT r.studentId,{T(family)} family,{id} itemId,{tuple} tuple FROM roster r {from}";
        var scope = q.A(T("control"), T("scope"), q.Id("e.Id"), q.Id("e.ContentPackId"), "CASE WHEN e.Kind=1 THEN 'Include' ELSE 'Exclude' END", "e.BookKey", "#e.StartChapter", "#e.StartVerse", "#e.EndChapter", "#e.EndVerse");
        var assignment = q.A(T("control"), T("assignment"), q.Id("a.Id"), "CASE a.Type WHEN 1 THEN 'PrimarySpecialist' WHEN 2 THEN 'RequiredCoverage' ELSE 'OptionalReview' END");
        var assignmentScope = q.A(T("control"), T("assignment-scope"), q.Id("e.Id"), q.Id("e.AssignmentId"), q.Id("e.ContentPackId"), "e.BookKey", "#e.StartChapter", "#e.StartVerse", "#e.EndChapter", "#e.EndVerse");
        return $"""
        WITH {Saved(q).Replace("saved AS", "captured AS", StringComparison.Ordinal)}, roster AS (SELECT {sid} studentId,u.Id userId,u.DisplayName FROM Users u
          JOIN OrganizationMembers om ON om.UserId=u.Id AND om.OrganizationId=@org AND om.Role=3
          WHERE u.IsActive=1 AND u.Kind=2 AND EXISTS(SELECT 1 FROM CompetitionMembers cm WHERE cm.UserId=u.Id AND cm.OrganizationId=@org AND cm.SeasonId=@season)),
        sources AS (
          SELECT DISTINCT r.studentId,{source} sourceId,{pack} packId,CASE WHEN p.SourceType=2 THEN 'Commentary' ELSE 'Scripture' END kind,
            s.BookKey bookKey,s.Chapter chapter,s.Verse verse,s.Ordinal ordinal,s.CitationLabel citation,s.CanonicalText canonicalText
          FROM roster r JOIN SourceUnits s ON 1=1 JOIN ContentPacks p ON p.Id=s.ContentPackId
          WHERE ((s.OrganizationId=@org AND p.OrganizationId=@org) OR (s.OrganizationId=@builtin AND p.OrganizationId=@builtin AND p.IsBuiltIn=1))
            AND s.IsActive=1 AND s.IsRetired=0 AND p.IsActive=1 AND lower(p.LicensingStatus) IN ('development-sample','approved','public-domain','creative-commons')
            AND EXISTS(SELECT 1 FROM AssignmentScopes a JOIN Assignments pa ON pa.Id=a.AssignmentId WHERE pa.OrganizationId=@org AND pa.SeasonId=@season AND pa.StudentUserId=r.userId AND pa.Type IN(1,2,3) AND {Range("a")})
            AND EXISTS(SELECT 1 FROM ScopeEntries e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.Kind=1 AND {Range("e")})
            AND NOT EXISTS(SELECT 1 FROM ScopeEntries e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.Kind=2 AND {Range("e")})
          UNION
          SELECT DISTINCT r.studentId,lower({q.S("v.value", "$.id")}),lower(i.Id),'Commentary',{q.S("i.DataJson", "$.bookKey")},NULL,NULL,CAST(v.[key] AS int)+1,{q.S("v.value", "$.citation")},{q.S("v.value", "$.canonicalText")}
          FROM roster r JOIN PbeTrainingRecords i ON i.OrganizationId=@org AND i.SeasonId=@season AND i.OwnerId IS NULL AND i.Kind='pbe-introduction'
          {q.JoinEach(q.J("i.DataJson", "$.units"), "v")}
          WHERE {q.B("i.DataJson", "$.reviewed")}=1 AND {q.S("i.DataJson", "$.licensingStatus")} IN ('approved','public-domain','creative-commons')
            AND EXISTS(SELECT 1 FROM ScopeEntries e WHERE e.OrganizationId=@org AND e.SeasonId=@season AND e.Kind=1 AND upper(e.BookKey)={q.S("i.DataJson", "$.bookKey")})
            AND EXISTS(SELECT 1 FROM PbeTrainingRecords a WHERE a.OrganizationId=@org AND a.SeasonId=@season AND a.OwnerId=r.userId AND a.Kind='pbe-introduction-assignment' AND {q.S("a.DataJson", "$.contentPackId")}=i.Id)),
        controls AS (
          {control("scope", q.Id("e.Id"), scope, "JOIN ScopeEntries e ON e.OrganizationId=@org AND e.SeasonId=@season")}
          UNION ALL {control("assignment", q.Id("a.Id"), assignment, "JOIN Assignments a ON a.OrganizationId=@org AND a.SeasonId=@season AND a.StudentUserId=r.userId")}
          UNION ALL {control("assignment-scope", q.Id("e.Id"), assignmentScope, "JOIN Assignments a ON a.OrganizationId=@org AND a.SeasonId=@season AND a.StudentUserId=r.userId JOIN AssignmentScopes e ON e.AssignmentId=a.Id")}
          UNION ALL {control("intro-assignment", "a.Id", q.A(T("control"), T("intro-assignment"), "a.Id", "#a.Revision", q.S("a.DataJson", "$.contentPackId")), "JOIN PbeTrainingRecords a ON a.OrganizationId=@org AND a.SeasonId=@season AND a.OwnerId=r.userId AND a.Kind='pbe-introduction-assignment'")}
          UNION ALL {control("introduction", "i.Id", q.A(T("control"), T("introduction"), "i.Id", "#i.Revision"), $"JOIN PbeTrainingRecords i ON i.OrganizationId=@org AND i.SeasonId=@season AND i.Kind='pbe-introduction' AND i.OwnerId IS NULL WHERE EXISTS(SELECT 1 FROM PbeTrainingRecords a WHERE a.OrganizationId=@org AND a.SeasonId=@season AND a.OwnerId=r.userId AND a.Kind='pbe-introduction-assignment' AND {q.S("a.DataJson", "$.contentPackId")}=i.Id)")}
          UNION ALL {control("pack", q.Id("p.Id"), q.A(T("control"), T("pack"), q.Id("p.Id"), q.Id("p.OrganizationId"), "?p.IsActive", "?p.IsBuiltIn", "p.LicensingStatus", "CASE WHEN p.SourceType=2 THEN 'Supplemental' ELSE 'Scripture' END"), "JOIN ContentPacks p ON EXISTS(SELECT 1 FROM Assignments a JOIN AssignmentScopes e ON e.AssignmentId=a.Id WHERE a.OrganizationId=@org AND a.SeasonId=@season AND a.StudentUserId=r.userId AND e.ContentPackId=p.Id)")}
          UNION ALL {control("member", q.Id("m.Id"), q.A(T("control"), T("member"), q.Id("m.Id"), q.Id("m.UserId")), "JOIN CompetitionMembers m ON m.OrganizationId=@org AND m.SeasonId=@season AND m.UserId=r.userId")}),
        bank AS (SELECT DISTINCT s.studentId,b.Kind,b.Id,b.OwnerId,b.Revision,b.DataJson FROM sources s JOIN PbeTrainingRecords b ON b.OrganizationId=@org AND b.SeasonId=@season AND {q.Id("b.OwnerId")}=s.sourceId AND b.Kind IN ('pbe-target','pbe-question-head')),
        liveD1 AS (
          SELECT studentId,'control' family,{q.Cat("family", T(":"), "itemId")} itemId,tuple FROM controls
          UNION ALL SELECT {q.S("payload", "$[1]")},'source',{q.S(q.J("payload", "$[2]"), "$[1]")},{q.J("payload", "$[2]")} FROM captured WHERE key LIKE 'input:%:source:%'
          UNION ALL SELECT studentId,'bank',{q.Cat("Kind", T(":"), "Id")},{q.A(T("bank"), "Kind", "Id", q.Id("OwnerId"), "#Revision")} FROM bank),
        pointers AS (SELECT r.studentId,w.Id pointerId,w.Revision,w.DataJson,{q.S("w.DataJson", "$.id")} generationId,{q.S("w.DataJson", "$.scopeVersion")} scopeVersion,{q.S("w.DataJson", "$.state")} state FROM roster r LEFT JOIN PbeTrainingRecords w ON w.OrganizationId=@org AND w.SeasonId=@season AND w.OwnerId=r.userId AND w.Kind='pbe-chapter-work' AND w.Id={q.Cat("r.studentId", T(":"), q.Id("@season"))}),
        d1entries AS (SELECT p.studentId,e.value tuple,CASE WHEN {q.S("e.value", "$[0]")} IN ('control','bank') THEN {q.Cat(q.S("e.value", "$[1]"), T(":"), q.S("e.value", "$[2]"))} ELSE {q.S("e.value", "$[1]")} END guardId,{q.S("e.value", "$[0]")} family,{q.S("e.value", "$[1]")} itemId,{q.S("e.value", "$[2]")} payload
          FROM pointers p JOIN PbeTrainingRecords m ON m.OrganizationId=@org AND m.SeasonId=@season AND {q.Id("m.OwnerId")}=p.studentId AND m.Kind='pbe-chapter-manifest' AND m.Id LIKE {q.Cat("p.generationId", T(":inputs:%"))} {q.JoinEach("m.DataJson", "e")}),
        evidence AS (SELECT DISTINCT b.studentId,b.Id targetId,r.Id reviewId,r.Revision reviewRevision,r.DataJson reviewJson,d.Id dirtyId,d.Revision dirtyRevision,d.DataJson dirtyJson
          FROM bank b LEFT JOIN PbeTrainingRecords r ON r.OrganizationId=@org AND r.SeasonId=@season AND {q.Id("r.OwnerId")}=b.studentId AND r.Kind='pbe-target-review' AND r.Id={q.Cat("b.studentId", T(":"), q.Id("@season"), T(":"), "b.Id")}
          LEFT JOIN PbeTrainingRecords d ON d.OrganizationId=@org AND d.SeasonId=@season AND {q.Id("d.OwnerId")}=b.studentId AND d.Kind='pbe-evidence-dirty' AND d.Id={q.Cat("b.studentId", T(":"), q.Id("@season"), T(":"), "b.Id")} WHERE b.Kind='pbe-target'),
        d1pageStats AS (SELECT p.studentId,COUNT(m.Id) pageCount,COALESCE(SUM({q.Bytes("m.DataJson")}),0) pageBytes FROM pointers p LEFT JOIN PbeTrainingRecords m ON m.OrganizationId=@org AND m.SeasonId=@season AND {q.Id("m.OwnerId")}=p.studentId AND m.Kind='pbe-chapter-manifest' AND m.Id LIKE {q.Cat("p.generationId", T(":inputs:%"))} GROUP BY p.studentId),
        availability AS (SELECT p.*,CASE WHEN NOT EXISTS(SELECT 1 FROM sources s WHERE s.studentId=p.studentId) THEN 'Unassigned'
          WHEN p.state='Complete' AND p.scopeVersion IS NOT NULL AND {q.S("p.DataJson", "$.snapshotId")}=p.generationId
          AND EXISTS(SELECT 1 FROM d1pageStats ps WHERE ps.studentId=p.studentId AND ps.pageCount=CAST({q.S("p.DataJson", "$.inputPages")} AS int) AND ps.pageBytes=CAST({q.S("p.DataJson", "$.stagedBytes")} AS bigint)-CAST(COALESCE({q.S("p.DataJson", "$.proofBytes")},'0') AS bigint))
          AND (SELECT COUNT(*) FROM d1entries e WHERE e.studentId=p.studentId)=CAST({q.S("p.DataJson", "$.inputOffset")} AS int) AND NOT EXISTS(SELECT 1 FROM liveD1 l WHERE l.studentId=p.studentId AND NOT EXISTS(SELECT 1 FROM d1entries e WHERE e.studentId=l.studentId AND e.family=l.family AND e.guardId=l.itemId AND {q.TupleEqual("l.tuple", "e.tuple")}))
          AND NOT EXISTS(SELECT 1 FROM d1entries e WHERE e.studentId=p.studentId AND e.family IN('source','control','bank') AND NOT EXISTS(SELECT 1 FROM liveD1 l WHERE l.studentId=e.studentId AND l.family=e.family AND l.itemId=e.guardId AND {q.TupleEqual("l.tuple", "e.tuple")}))
          AND NOT EXISTS(SELECT itemId FROM d1entries e WHERE e.studentId=p.studentId AND e.family='target' EXCEPT SELECT itemId FROM d1entries e WHERE e.studentId=p.studentId AND e.family='retention') AND (SELECT COUNT(*) FROM d1entries e WHERE e.studentId=p.studentId AND e.family='target')=(SELECT COUNT(*) FROM d1entries e WHERE e.studentId=p.studentId AND e.family='retention')
          AND NOT EXISTS(SELECT 1 FROM d1entries e LEFT JOIN evidence v ON v.studentId=e.studentId AND v.targetId=e.itemId WHERE e.studentId=p.studentId AND e.family='retention' AND (v.reviewId IS NULL OR v.reviewRevision<>CAST({q.S("e.tuple", "$[3]")} AS bigint) OR {q.Exact("v.reviewJson")}<>{q.Exact("e.payload")} OR {q.S("v.reviewJson", "$.retention.ruleVersion")}<>'pbe-retention-v1' OR {q.B("v.reviewJson", "$.retention.dataGap")}=1 OR {q.B("v.reviewJson", "$.provisional")}=1 OR (v.dirtyId IS NOT NULL AND COALESCE({q.S("v.dirtyJson", "$.generation")},'-1')<>COALESCE({q.S("v.dirtyJson", "$.completedGeneration")},'-2')))) THEN 'Known' ELSE 'Unknown' END availability FROM pointers p),
        inputs AS (
          SELECT {q.Cat(T("roster:"), "studentId")} key,{q.A(T("roster"), "studentId", "DisplayName")} payload FROM roster
          UNION ALL SELECT 'season',{q.A(T("season"), "#s.Status", "?s.PbeEnabled")} FROM Seasons s WHERE s.OrganizationId=@org AND s.Id=@season
          UNION ALL SELECT {q.Cat(T("input:"), "studentId", T(":"), "family", T(":"), "itemId")},{q.A(T("input"), "studentId", "@tuple")} FROM liveD1 WHERE family<>'source'
          UNION ALL SELECT {q.Cat(T("evidence:"), "studentId", T(":"), "targetId")},{q.A(T("evidence"), "studentId", "targetId", "reviewId", "#reviewRevision", "reviewJson", "dirtyId", "#dirtyRevision", "dirtyJson")} FROM evidence
          UNION ALL SELECT {q.Cat(T("pointer:"), "studentId")},{q.A(T("pointer"), "studentId", "generationId", "scopeVersion", "availability", "CASE WHEN availability<>'Unknown' THEN NULL WHEN state IS NULL THEN 'NotStarted' WHEN state='Complete' THEN 'DataGap' WHEN state='Blocked' THEN 'Blocked' ELSE 'Working' END", "#Revision")} FROM availability)
        """;
    }
    string Saved(Sql q, string generation = "@generation") => $"""
        saved AS (SELECT e.value entry,{q.S("e.value", "$.key")} key,{q.J("e.value", "$.value")} payload
          FROM PbeTrainingRecords p {q.JoinEach(q.J("p.DataJson", "$.entries"), "e")}
          WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId IS NULL AND p.Kind='pbe-cooperation-manifest' AND {q.S("p.DataJson", "$.generationId")}={generation} AND {q.S("p.DataJson", "$.family")}='inputs')
        """;
    static CooperationInput GuardInput(string key, JsonElement value)
    {
        if (value[0].GetString() != "evidence") return new(key, value);
        var values = value.EnumerateArray().Select(x => (object?)x.Clone()).ToArray();
        values[5] = PbeCooperationService.Hash(value[5].GetString() ?? "null"); values[8] = PbeCooperationService.Hash(value[8].GetString() ?? "null");
        return new(key, Parse(PbeCooperationService.Serialize(values)));
    }
    static CooperationInput SourceInput(string key, JsonElement a)
    {
        var tuple = new object?[] { "source", a[1].GetString(), a[2].GetString(), a[3].GetString(), a[4].GetString(), a[5].ValueKind == JsonValueKind.Null ? null : a[5].GetInt32(), a[6].ValueKind == JsonValueKind.Null ? null : a[6].GetInt32(), a[7].GetInt32(), a[8].GetString(), PbeCooperationService.Hash(a[9].GetString()!) };
        return new(key, Parse(PbeCooperationService.Serialize(new object?[] { "input", a[0].GetString(), tuple })));
    }
    string SourceSelect(Sql q) => $"SELECT {q.Cat(T("input:"), "studentId", T(":source:"), "kind", T(":"), "packId", T(":"), "sourceId")} key,{q.A("studentId", "sourceId", "packId", "kind", "bookKey", "#chapter", "#verse", "#ordinal", "citation", "canonicalText")} payload FROM sources";
    public Task<IReadOnlyList<CooperationInput>> SourcePage(VerifiedCooperationScope scope, string after, CancellationToken ct) => Query(q => q.Prefix(Current(q), SourceSelect(q) + $" WHERE {q.Cat(T("input:"), "studentId", T(":source:"), "kind", T(":"), "packId", T(":"), "sourceId")}>@after ORDER BY key"), Args(scope, after: after), r => SourceInput(r.GetString(0), Parse(Payload(r))), ct);
    async Task<bool> SourcesCurrent(VerifiedCooperationScope scope, string generation, CancellationToken ct)
    {
        // Whole capped exact validation only: expected compact tuples plus one streaming current-source query.
        // Ordinary source text is selected by SourcePage's SQL byte prefix; no managed SQL hash callbacks exist.
        var expected = (await Query(q => "WITH " + Saved(q) + " SELECT key,payload FROM saved WHERE key LIKE 'input:%:source:%' ORDER BY key", Args(scope, generation), r => new CooperationInput(r.GetString(0), Parse(r.GetString(1))), ct)).ToDictionary(r => r.Key, r => PbeCooperationService.Serialize(r.Value), StringComparer.Ordinal);
        var connection = db.Database.GetDbConnection(); if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
        var sqlite = db.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite"; var dialect = new Sql(sqlite);
        await using var command = connection.CreateCommand(); command.CommandText = Current(dialect) + SourceSelect(dialect) + " ORDER BY key"; command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var (name, value) in Args(scope, generation)) { var parameter = command.CreateParameter(); parameter.ParameterName = name; parameter.Value = value is Guid guid && sqlite ? guid.ToString().ToUpperInvariant() : value ?? DBNull.Value; command.Parameters.Add(parameter); }
        var measure = PbeChapterJsonReader.Diagnostics.IsEnabled("Query"); long rows = 0, bytes = 0;
        await using var result = await command.ExecuteReaderAsync(ct); var valid = true;
        try
        {
            while (await result.ReadAsync(ct))
            {
                rows++; var key = result.GetString(0); var payload = result.GetString(1); if (measure) bytes += Encoding.UTF8.GetByteCount(key) + Encoding.UTF8.GetByteCount(payload);
                var input = SourceInput(key, Parse(payload)); if (!expected.Remove(key, out var value) || value != PbeCooperationService.Serialize(input.Value)) valid = false;
                if (rows > 50000) throw new PbeChapterLimitException("ScopeTooLarge");
            }
        }
        finally { if (measure) PbeChapterJsonReader.Diagnostics.Write("Query", new PbeChapterJsonReader.QueryMetric(1, rows, bytes, Math.Max(36, generation.Length))); }
        return valid && expected.Count == 0;
    }
    async Task<bool> EvidenceCurrent(VerifiedCooperationScope scope, string generation, CancellationToken ct)
    {
        // Final/current whole-set exception. Only one bounded projection record is live in managed code at a time.
        var expected = (await Query(q => "WITH " + Saved(q) + " SELECT key,payload FROM saved WHERE key LIKE 'evidence:%'", Args(scope, generation), r => new CooperationInput(r.GetString(0), Parse(r.GetString(1))), ct)).ToDictionary(r => r.Key, r => PbeCooperationService.Serialize(r.Value), StringComparer.Ordinal);
        var connection = db.Database.GetDbConnection(); if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
        var sqlite = db.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite"; var q = new Sql(sqlite);
        await using var command = connection.CreateCommand(); command.CommandText = Current(q) + " SELECT key,payload FROM inputs WHERE key LIKE 'evidence:%' ORDER BY key"; command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var (name, value) in Args(scope, generation)) { var p = command.CreateParameter(); p.ParameterName = name; p.Value = value is Guid guid && sqlite ? guid.ToString().ToUpperInvariant() : value ?? DBNull.Value; command.Parameters.Add(p); }
        var measure = PbeChapterJsonReader.Diagnostics.IsEnabled("Query"); long rows = 0, bytes = 0; var valid = true;
        await using var result = await command.ExecuteReaderAsync(ct);
        try
        {
            while (await result.ReadAsync(ct)) { rows++; var key = result.GetString(0); var payload = result.GetString(1); if (measure) bytes += Encoding.UTF8.GetByteCount(key) + Encoding.UTF8.GetByteCount(payload); var input = GuardInput(key, Parse(payload)); if (!expected.Remove(key, out var value) || value != PbeCooperationService.Serialize(input.Value)) valid = false; }
        }
        finally { if (measure) PbeChapterJsonReader.Diagnostics.Write("Query", new PbeChapterJsonReader.QueryMetric(1, rows, bytes, Math.Max(36, generation.Length))); }
        return valid && expected.Count == 0;
    }
    async Task<bool> EligibleMetadataSealsCurrent(VerifiedCooperationScope scope, string generation, CancellationToken ct)
    {
        // The accepted D1 portable scope seal covers the exact eligible target/question metadata,
        // including absence. Raw bank/control/source guards alone do not authenticate saved eligibility.
        var inputs = await Query(q => Current(q) + $" SELECT e.studentId,p.scopeVersion,e.tuple FROM d1entries e JOIN pointers p ON p.studentId=e.studentId JOIN availability a ON a.studentId=e.studentId WHERE a.availability='Known' AND e.family IN ('source','target','question','control') ORDER BY e.studentId,e.family,e.itemId", Args(scope, generation), r => (Student: r.GetString(0), Version: r.GetString(1), Entry: Parse(r.GetString(2))), ct);
        var json = new JsonSerializerOptions(PbeQuestionBank.Json) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        string SerializeLegacy(object value) => JsonSerializer.Serialize(value, json);
        foreach (var subject in inputs.GroupBy(x => x.Student, StringComparer.Ordinal))
        {
            var entries = subject.Select(x => x.Entry).ToArray();
            var sources = entries.Where(x => x[0].GetString() == "source").OrderBy(x => x[1].GetString(), StringComparer.Ordinal).Select(x => x.EnumerateArray().Skip(1).Select(y => (object?)y.Clone()).ToArray()).ToArray();
            var targets = entries.Where(x => x[0].GetString() == "target").Select(x => JsonSerializer.Deserialize<PbeTarget>(x[2].GetString()!, json)!).OrderBy(x => x.Id.ToString(), StringComparer.Ordinal).Select(t => new object[] { t.Id, t.SourceUnitIds.OrderBy(id => id.ToString(), StringComparer.Ordinal).ToArray(), t.Skill.ToString() }).ToArray();
            var questions = entries.Where(x => x[0].GetString() == "question").Select(x => JsonSerializer.Deserialize<PbeQuestion>(x[2].GetString()!, json)!).OrderBy(x => x.Id.ToString(), StringComparer.Ordinal).ThenBy(x => x.Version).Select(q => new object[] { q.Id, q.Version, q.SourceUnitIds.OrderBy(id => id.ToString(), StringComparer.Ordinal).ToArray(), q.Kind.ToString(), q.Ordered, q.Parts.Select(p => new object[] { p.TargetId, p.Points }).ToArray() }).ToArray();
            var controls = entries.Where(x => x[0].GetString() == "control").ToArray();
            var assignments = controls.Where(e => e[1].GetString() == "assignment-scope").Select(e => new object?[] { "assignment", e[3].GetGuid(), e[4].GetGuid(), e[5].GetString(), e[6].GetInt32(), e[7].GetInt32(), e[8].GetInt32(), e[9].GetInt32() }).Concat(controls.Where(e => e[1].GetString() == "intro-assignment").Select(e => new object?[] { "pbe-introduction-assignment", e[2].GetString(), e[4].GetGuid(), null, null, null, null, null })).OrderBy(a => a[0]!.ToString(), StringComparer.Ordinal).ThenBy(a => a[1]!.ToString(), StringComparer.Ordinal).ThenBy(a => SerializeLegacy(a), StringComparer.Ordinal).ToArray();
            var version = PbeCooperationService.Hash(SerializeLegacy(new object[] { PbeChapterProgressService.RuleVersion, PbeChapterProgressService.GroupRuleVersion, scope.SeasonId, Guid.Parse(subject.Key), sources, targets, questions, assignments }));
            if (subject.First().Version != version) return false;
        }
        return true;
    }
    public Task<IReadOnlyList<CooperationInput>> InputPage(VerifiedCooperationScope scope, string generation, string after, CancellationToken ct) => Query(q => q.Prefix(Current(q), "SELECT key,payload FROM inputs WHERE key>@after ORDER BY key"), Args(scope, generation, after), r => GuardInput(r.GetString(0), Parse(Payload(r))), ct);
    public async Task<string?> LimitReason(VerifiedCooperationScope scope, CancellationToken ct)
    {
        var rows = await Query(q => Current(q) + " SELECT CASE WHEN (SELECT COUNT(*) FROM roster)>32 OR (SELECT COUNT(*) FROM sources)>50000 OR (SELECT COUNT(*) FROM (SELECT DISTINCT kind,packId,sourceId FROM sources) u)>10000 OR EXISTS(SELECT 1 FROM controls WHERE family IN ('assignment','assignment-scope','intro-assignment') GROUP BY family HAVING COUNT(*)>10000) THEN 'ScopeTooLarge' ELSE NULL END", Args(scope), r => r.IsDBNull(0) ? null : r.GetString(0), ct);
        return rows.Single();
    }
    public async Task<bool> InputsCurrent(VerifiedCooperationScope scope, string generation, CancellationToken ct)
    {
        var rows = await Query(q =>
        {
            // Compare typed JSON values, not provider-specific escaping or collation.
            var equal = $"((l.key LIKE 'input:%' AND {q.S("l.payload", "$[1]")}={q.S("s.payload", "$[1]")} AND {q.TupleEqual(q.J("l.payload", "$[2]"), q.J("s.payload", "$[2]"))}) OR (l.key NOT LIKE 'input:%' AND {q.TupleEqual("l.payload", "s.payload")}))";
            return Current(q) + "," + Saved(q) + $" SELECT CASE WHEN EXISTS(SELECT 1 FROM inputs l WHERE l.key NOT LIKE 'evidence:%' AND NOT EXISTS(SELECT 1 FROM saved s WHERE s.key=l.key AND {equal})) OR EXISTS(SELECT 1 FROM saved s WHERE s.key NOT LIKE 'input:%:source:%' AND s.key NOT LIKE 'evidence:%' AND NOT EXISTS(SELECT 1 FROM inputs l WHERE l.key=s.key AND {equal})) THEN 0 ELSE 1 END";
        }, Args(scope, generation), r => Convert.ToInt32(r.GetValue(0)) == 1, ct);
        return rows.Single() && await SourcesCurrent(scope, generation, ct) && await EvidenceCurrent(scope, generation, ct) && await EligibleMetadataSealsCurrent(scope, generation, ct);
    }
    public Task<IReadOnlyList<CooperationInput>> Descriptors(VerifiedCooperationScope scope, string generation, CancellationToken ct) => Query(q => "WITH " + Saved(q) + " SELECT key,payload FROM saved WHERE key LIKE 'roster:%' OR key LIKE 'pointer:%' ORDER BY key", Args(scope, generation), r => new CooperationInput(r.GetString(0), Parse(r.GetString(1))), ct);
    string Facts(Sql q)
    {
        var sourceTuple = q.J("s.payload", "$[2]");
        var sourceSelect = $"SELECT {q.S("s.payload", "$[1]")} studentId,{q.S(sourceTuple, "$[1]")} sourceId,{q.S(sourceTuple, "$[2]")} packId,{q.S(sourceTuple, "$[3]")} kind FROM saved s WHERE {q.S("s.payload", "$[0]")}='input' AND {q.S(sourceTuple, "$[0]")}='source'";
        return $"""
        WITH {Saved(q)}, assigned AS ({sourceSelect}),
        selected AS ({q.Limit($"SELECT a.*, {q.Cat("kind", T(":"), "packId", T(":"), "sourceId", T(":"), "studentId")} key FROM assigned a WHERE {q.Cat("kind", T(":"), "packId", T(":"), "sourceId", T(":"), "studentId")}>@after ORDER BY kind,packId,sourceId,studentId", 128)}),
        descriptors AS (SELECT {q.S("payload", "$[1]")} studentId,{q.S("payload", "$[2]")} generationId,{q.S("payload", "$[4]")} availability FROM saved WHERE key LIKE 'pointer:%'),
        entries AS (SELECT d.studentId,{q.S("e.value", "$[0]")} family,{q.S("e.value", "$[1]")} id,{q.S("e.value", "$[2]")} payload
          FROM descriptors d JOIN PbeTrainingRecords p ON p.OrganizationId=@org AND p.SeasonId=@season AND {q.Id("p.OwnerId")}=d.studentId AND p.Kind='pbe-chapter-manifest' AND p.Id LIKE {q.Cat("d.generationId", T(":inputs:%"))}
          {q.JoinEach("p.DataJson", "e")} WHERE d.availability='Known'),
        targets AS (SELECT studentId,id,payload FROM entries WHERE family='target'),
        questions AS (SELECT studentId,id,payload FROM entries WHERE family='question'),
        headParts AS (SELECT q.studentId,q.id questionId,{q.S("q.payload", "$.kind")} kind,{q.S("p.value", "$.targetId")} targetId FROM questions q {q.JoinEach(q.J("q.payload", "$.parts"), "p")}),
        variants AS (SELECT t.studentId,t.id,COUNT(DISTINCT h.questionId) count FROM targets t LEFT JOIN headParts h ON h.studentId=t.studentId AND h.targetId=t.id AND h.kind<>'TrueFalse' AND ({q.S("t.payload", "$.skill")}<>'ExactWords' OR h.kind='ExactWords') GROUP BY t.studentId,t.id),
        edges AS (SELECT s.key,t.id,{q.B("r.payload", "$.retention.practiced")} practiced,
          CASE WHEN {q.B("r.payload", "$.retention.recalled")}=1 AND COALESCE(CAST({q.S("r.payload", "$.retention.pendingCount")} AS int),0)=0 AND {q.B("r.payload", "$.retention.dataGap")}=0 AND {q.B("r.payload", "$.provisional")}=0 THEN 1 ELSE 0 END recalled,
          CASE WHEN {q.S("r.payload", "$.retention.ruleVersion")}='pbe-retention-v1' AND (SELECT COUNT(*) FROM {q.Each(q.J("r.payload", "$.retention.witness"), "w")})=2 AND COALESCE(CAST({q.S("r.payload", "$.retention.pendingCount")} AS int),0)=0 AND {q.B("r.payload", "$.retention.dataGap")}=0 AND {q.B("r.payload", "$.provisional")}=0 AND v.count>=2 THEN 1 ELSE 0 END retained,
          {q.B("r.payload", "$.review.unresolved")} unresolved,CASE WHEN CAST({q.S("r.payload", "$.review.intervalIndex")} AS int)>=0 THEN CAST({q.S("r.payload", "$.review.dueAtMs")} AS bigint) END scheduled
          FROM selected s JOIN targets t ON t.studentId=s.studentId {q.JoinEach(q.J("t.payload", "$.sourceUnitIds"), "ts")}
          LEFT JOIN entries r ON r.studentId=t.studentId AND r.family='retention' AND r.id=t.id LEFT JOIN variants v ON v.studentId=t.studentId AND v.id=t.id WHERE ts.value=s.sourceId),
        counts AS (SELECT key,COUNT(*) targets,MAX(practiced) practiced,MIN(recalled) recalled,MIN(retained) retained,MAX(unresolved) unresolved,MIN(scheduled) scheduled FROM edges GROUP BY key),
        coverage AS (SELECT DISTINCT s.key FROM selected s JOIN questions q ON q.studentId=s.studentId {q.JoinEach(q.J("q.payload", "$.sourceUnitIds"), "qs")} WHERE qs.value=s.sourceId),
        facts AS (SELECT s.key,s.studentId,s.kind,s.packId,s.sourceId,CASE WHEN d.availability='Known' THEN 1 ELSE 0 END known,
          CASE WHEN d.availability='Known' THEN CASE WHEN cv.key IS NULL THEN 0 ELSE 1 END END covered,
          CASE WHEN d.availability='Known' THEN COALESCE(c.practiced,0) END practiced,
          CASE WHEN d.availability='Known' THEN CASE WHEN COALESCE(c.targets,0)>0 THEN c.recalled ELSE 0 END END recalled,
          CASE WHEN d.availability='Known' THEN CASE WHEN cv.key IS NOT NULL AND COALESCE(c.targets,0)>0 THEN c.retained ELSE 0 END END retained,
          CASE WHEN d.availability='Known' THEN COALESCE(c.unresolved,0) END unresolved,CASE WHEN d.availability='Known' THEN c.scheduled END scheduled
          FROM selected s JOIN descriptors d ON d.studentId=s.studentId LEFT JOIN counts c ON c.key=s.key LEFT JOIN coverage cv ON cv.key=s.key)
        """;
    }
    public Task<IReadOnlyList<CooperationFact>> FactPage(VerifiedCooperationScope scope, string generation, string after, CancellationToken ct) => Query<CooperationFact>(q => q.Prefix(Facts(q), $"SELECT key,{q.A("studentId", "kind", "packId", "sourceId", "#covered", "#practiced", "#recalled", "#retained", "#known", "#unresolved", "#scheduled")} payload FROM facts ORDER BY key"), Args(scope, generation, after), r =>
    {
        var a = Parse(Payload(r)); bool? B(int i) => a[i].ValueKind == JsonValueKind.Null ? null : a[i].GetInt32() == 1;
        return new(a[0].GetString()!, a[1].GetString()!, a[2].GetString()!, a[3].GetString()!, B(4), B(5), B(6), B(7), B(8) == true, B(9), a[10].ValueKind == JsonValueKind.Null ? null : a[10].GetInt64());
    }, ct);
    string SavedFacts(Sql q) => $"""
        WITH factRows AS (SELECT {q.S("f.value", "$.studentId")} studentId,{q.S("f.value", "$.sourceKind")} kind,{q.S("f.value", "$.contentPackId")} packId,{q.S("f.value", "$.sourceUnitId")} sourceId,
          CASE WHEN {q.S("f.value", "$.questionCovered")} IS NULL THEN NULL ELSE {q.B("f.value", "$.questionCovered")} END covered,
          CASE WHEN {q.S("f.value", "$.practiced")} IS NULL THEN NULL ELSE {q.B("f.value", "$.practiced")} END practiced,
          CASE WHEN {q.S("f.value", "$.retained")} IS NULL THEN NULL ELSE {q.B("f.value", "$.retained")} END retained,
          CASE WHEN {q.B("f.value", "$.unresolved")}=1 OR CAST({q.S("f.value", "$.scheduledAtMs")} AS bigint)<=@checked THEN 1 WHEN {q.B("f.value", "$.dueKnown")}=1 THEN 0 END due,
          CASE WHEN CAST({q.S("f.value", "$.scheduledAtMs")} AS bigint)>@checked THEN CAST({q.S("f.value", "$.scheduledAtMs")} AS bigint) END futureDue
          FROM PbeTrainingRecords p {q.JoinEach(q.J("p.DataJson", "$.entries"), "f")}
          WHERE p.OrganizationId=@org AND p.SeasonId=@season AND p.OwnerId IS NULL AND p.Kind='pbe-cooperation-manifest' AND {q.S("p.DataJson", "$.generationId")}=@generation AND {q.S("p.DataJson", "$.family")}='facts'),
        unionRows AS (SELECT '' studentId,kind,packId,sourceId,
          CASE WHEN MAX(covered)=1 THEN 1 WHEN COUNT(covered)<COUNT(*) THEN NULL ELSE 0 END covered,
          CASE WHEN MAX(practiced)=1 THEN 1 WHEN COUNT(practiced)<COUNT(*) THEN NULL ELSE 0 END practiced,
          CASE WHEN MAX(retained)=1 THEN 1 WHEN COUNT(retained)<COUNT(*) THEN NULL ELSE 0 END retained,
          CASE WHEN MAX(due)=1 THEN 1 WHEN COUNT(due)<COUNT(*) THEN NULL ELSE 0 END due,MIN(futureDue) futureDue FROM factRows GROUP BY kind,packId,sourceId),
        allRows AS (SELECT * FROM factRows UNION ALL SELECT * FROM unionRows)
        """;
    public Task<IReadOnlyList<CooperationMaterialRow>> Totals(VerifiedCooperationScope scope, string generation, long checkedAtMs, CancellationToken ct)
    {
        var args = Args(scope, generation); args["@checked"] = checkedAtMs;
        return Query<CooperationMaterialRow>(q => SavedFacts(q) + " SELECT studentId,kind,COUNT(*),SUM(CASE WHEN covered=1 THEN 1 ELSE 0 END),SUM(CASE WHEN covered=0 THEN 0 ELSE 1 END),SUM(CASE WHEN practiced=1 THEN 1 ELSE 0 END),SUM(CASE WHEN practiced=0 THEN 0 ELSE 1 END),SUM(CASE WHEN retained=1 THEN 1 ELSE 0 END),SUM(CASE WHEN retained=0 THEN 0 ELSE 1 END),SUM(CASE WHEN due=1 THEN 1 ELSE 0 END),SUM(CASE WHEN due=0 THEN 0 ELSE 1 END),MIN(futureDue) FROM allRows GROUP BY studentId,kind ORDER BY studentId,kind", args, r => new(r.GetString(0), r.GetString(1), Convert.ToInt32(r.GetValue(2)), Convert.ToInt32(r.GetValue(3)), Convert.ToInt32(r.GetValue(4)), Convert.ToInt32(r.GetValue(5)), Convert.ToInt32(r.GetValue(6)), Convert.ToInt32(r.GetValue(7)), Convert.ToInt32(r.GetValue(8)), Convert.ToInt32(r.GetValue(9)), Convert.ToInt32(r.GetValue(10)), r.IsDBNull(11) ? null : Convert.ToInt64(r.GetValue(11))), ct);
    }
    public async Task<string> ScopeVersion(VerifiedCooperationScope scope, string generation, CancellationToken ct)
    {
        // Only final publication calls this complete capped compact-set reader, inside the same exact-guard transaction.
        var tuples = await Query(q => "WITH " + Saved(q) + " SELECT key,payload FROM saved WHERE key LIKE 'roster:%' OR key LIKE 'pointer:%' OR key LIKE 'input:%:source:%' ORDER BY key", Args(scope, generation), r => Parse(r.GetString(1)), ct);
        var roster = tuples.Where(x => x[0].GetString() == "roster").Select(x => x[1].GetString()!).Order(StringComparer.Ordinal).ToArray();
        var assigned = tuples.Where(x => x[0].GetString() == "input").Select(x => new[] { x[1].GetString()!, x[2][3].GetString()!, x[2][2].GetString()!, x[2][1].GetString()! }).OrderBy(x => string.Join(':', x), StringComparer.Ordinal).ToArray();
        var descriptors = tuples.Where(x => x[0].GetString() == "pointer").OrderBy(x => x[1].GetString(), StringComparer.Ordinal).Select(x => new object?[] { x[1].GetString(), x[2].GetString(), x[3].GetString(), x[4].GetString(), x[5].GetString() }).ToArray();
        return PbeCooperationService.Hash(PbeCooperationService.Serialize(new object[] { PbeCooperationService.RuleVersion, scope.SeasonId.ToString(), roster, assigned, descriptors }));
    }
}
