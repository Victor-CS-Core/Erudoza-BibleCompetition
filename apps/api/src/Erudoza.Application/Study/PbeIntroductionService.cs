using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

/// <summary>Dedicated coordinate-free sources, never materialized as legacy content rows.</summary>
public sealed class PbeIntroductionService(IErudozaDbContext db, ICurrentUser user, PbeSourceResolver resolver)
{
    private async Task Coach(Guid org, Guid season, CancellationToken ct)
    {
        if (!user.IsAdmin || user.Kind != UserKind.Adult) throw new UnauthorizedAccessException();
        await resolver.ResolveAsync(org, season, null, ct);
    }
    private static void Shape(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Any(p => !keys.Contains(p.Name))) throw new DomainException("Malformed introduction request.");
    }
    private static string Text(JsonElement value, string key, int max)
    {
        if (!value.TryGetProperty(key, out var prop) || prop.ValueKind != JsonValueKind.String || PbeQuestionBank.NormalizeEvidence(prop.GetString()!).Length == 0 || prop.GetString()!.Length > max) throw new DomainException($"Provide nonempty {key} of at most {max} characters.");
        return prop.GetString()!;
    }
    private static int Revision(JsonElement input)
    {
        if (!input.TryGetProperty("revision", out var prop) || prop.ValueKind != JsonValueKind.Number || !prop.TryGetInt32(out var value) || value < 1) throw new DomainException("Provide a valid revision.");
        return value;
    }
    private Task<bool> BookSelected(Guid org, Guid season, string book, CancellationToken ct) => db.ScopeEntries.AnyAsync(s => s.OrganizationId == org && s.SeasonId == season && s.Kind == ScopeEntryKind.Include && s.BookKey.ToUpper() == book, ct);
    private async Task<List<PbeTrainingRecord>> Assigned(Guid org, Guid season, Guid id, CancellationToken ct)
    {
        var prefix = $"{season}:{id}:";
        return await db.PbeTrainingRecords.Where(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == "pbe-introduction-assignment" && r.Id.StartsWith(prefix)).OrderBy(r => r.Id).ToListAsync(ct);
    }
    private async Task<PbeIntroductionDto> Dto(PbeIntroduction intro, long revision, CancellationToken ct) => new(intro.Id, intro.OrganizationId, intro.SeasonId, intro.BookKey, intro.SourceEdition, intro.Title, intro.Citation, intro.LicensingStatus, intro.Reviewed, intro.Units, revision, (await Assigned(intro.OrganizationId, intro.SeasonId, intro.Id, ct)).Select(r => r.OwnerId!.Value).ToList());
    public async Task<IReadOnlyList<PbeIntroductionDto>> List(Guid org, Guid season, CancellationToken ct)
    {
        await Coach(org, season, ct); var result = new List<PbeIntroductionDto>();
        foreach (var row in await resolver.IntroductionRows(org, season, ct)) result.Add(await Dto(JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!, row.Revision, ct));
        return result;
    }
    public async Task<PbeIntroductionDto> Create(Guid org, Guid season, JsonElement input, CancellationToken ct)
    {
        await using var transaction = await db.BeginSerializableTransactionAsync(ct);
        await Coach(org, season, ct); Shape(input, "bookKey", "sourceEdition", "title", "citation", "licensingStatus", "units");
        var book = PbeQuestionBank.NormalizeEvidence(Text(input, "bookKey", 20)).ToUpperInvariant(); if (!await BookSelected(org, season, book, ct)) throw new DomainException("Choose a book selected for this season.");
        var license = PbeQuestionBank.NormalizeEvidence(Text(input, "licensingStatus", 40)).ToLowerInvariant(); if (license != "pending" && !PbeSourceResolver.Licensed(license)) throw new DomainException("Choose pending, approved, public-domain or creative-commons licensing.");
        if (!input.TryGetProperty("units", out var units) || units.ValueKind != JsonValueKind.Array || units.GetArrayLength() is < 1 or > 20) throw new DomainException("Provide 1–20 introduction units.");
        var sources = units.EnumerateArray().Select(u => { Shape(u, "citation", "canonicalText"); return new PbeIntroductionUnit(Guid.NewGuid(), Text(u, "citation", 500), Text(u, "canonicalText", 10000)); }).ToList();
        if (sources.Sum(u => u.CanonicalText.Length) > 100000) throw new DomainException("An introduction may contain at most 100,000 text characters.");
        var intro = new PbeIntroduction(Guid.NewGuid(), org, season, book, Text(input, "sourceEdition", 200), Text(input, "title", 200), Text(input, "citation", 500), license, false, sources);
        db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = "pbe-introduction", Id = intro.Id.ToString(), DataJson = JsonSerializer.Serialize(intro, PbeQuestionBank.Json) });
        await db.SaveChangesAsync(ct); var result = await Dto(intro, 1, ct); await transaction.CommitAsync(ct); return result;
    }
    public async Task<PbeIntroductionDto> Update(Guid org, Guid season, Guid id, bool review, JsonElement input, CancellationToken ct)
    {
        await using var transaction = await db.BeginSerializableTransactionAsync(ct);
        await Coach(org, season, ct); Shape(input, review ? ["revision", "reviewed"] : ["revision", "studentIds"]); var expected = Revision(input);
        var row = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.SeasonId == season && r.Kind == "pbe-introduction" && r.Id == id.ToString(), ct) ?? throw new KeyNotFoundException("Introduction not found in this season.");
        var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
        if (review)
        {
            if (expected != row.Revision) throw new PbeBankConflictException("The introduction changed. Refresh and retry.");
            if (!input.TryGetProperty("reviewed", out var prop) || prop.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new DomainException("Provide a reviewed flag.");
            var reviewed = prop.GetBoolean(); if (reviewed && (!PbeSourceResolver.Licensed(intro.LicensingStatus) || !await BookSelected(org, season, intro.BookKey, ct))) throw new DomainException("Review requires licensed content and a selected season book.");
            if (reviewed == intro.Reviewed) return await Dto(intro, row.Revision, ct);
            intro = intro with { Reviewed = reviewed };
        }
        else
        {
            if (!input.TryGetProperty("studentIds", out var prop) || prop.ValueKind != JsonValueKind.Array || prop.GetArrayLength() > 500) throw new DomainException("Choose at most 500 active season students.");
            var ids = prop.EnumerateArray().Select(p => p.ValueKind == JsonValueKind.String && p.TryGetGuid(out var value) && value != Guid.Empty ? value : throw new DomainException("Provide a valid nonempty GUID.")).Distinct().Order().ToArray();
            if (ids.Length > 0 && !await BookSelected(org, season, intro.BookKey, ct)) throw new DomainException("Choose a book selected for this season.");
            foreach (var student in ids)
                if (!await db.Users.AnyAsync(u => u.Id == student && u.Kind == UserKind.Student && u.IsActive && db.OrganizationMembers.Any(m => m.UserId == student && m.OrganizationId == org && m.Role == OrganizationRole.Student), ct) || !await db.CompetitionMembers.AnyAsync(m => m.UserId == student && m.OrganizationId == org && m.SeasonId == season, ct)) throw new DomainException("Choose active student members of this season.");
            var prior = await Assigned(org, season, id, ct);
            if (prior.Select(r => r.OwnerId!.Value).Order().SequenceEqual(ids)) return await Dto(intro, row.Revision, ct);
            if (expected != row.Revision) throw new PbeBankConflictException("The introduction changed. Refresh and retry.");
            // Retain rows for students still assigned; stable deterministic IDs avoid duplicate tracking and retries.
            db.PbeTrainingRecords.RemoveRange(prior.Where(r => !ids.Contains(r.OwnerId!.Value)));
            foreach (var student in ids.Where(student => prior.All(r => r.OwnerId != student)))
            {
                var assignment = new PbeIntroductionAssignment($"{season}:{id}:{student}", season, id, student);
                db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, OwnerId = student, Kind = "pbe-introduction-assignment", Id = assignment.Id, DataJson = JsonSerializer.Serialize(assignment, PbeQuestionBank.Json) });
            }
        }
        row.DataJson = JsonSerializer.Serialize(intro, PbeQuestionBank.Json); row.Revision++;
        await db.SaveChangesAsync(ct); var result = await Dto(intro, row.Revision, ct); await transaction.CommitAsync(ct); return result;
    }
    public async Task<object> Reader(Guid org, Guid season, Guid id, CancellationToken ct)
    {
        var student = user.Kind == UserKind.Student ? user.UserId : (Guid?)null;
        var scope = await resolver.ResolveAsync(org, season, student, ct); var sources = scope.Sources.Where(s => s.ContentPackId == id && s.Chapter is null).ToList();
        if (sources.Count == 0) throw new UnauthorizedAccessException("This introduction is outside your current approved assignment.");
        if ((await resolver.ResolveAsync(org, season, student, ct)).Fingerprint != scope.Fingerprint) throw new PbeBankConflictException("The PBE scope changed. Refresh and retry.");
        return new { contentPackId = id, sources = sources.Select(s => new { s.Id, s.ContentPackId, sourceKind = s.SourceKind.ToString(), s.BookKey, s.Chapter, s.Verse, s.Ordinal, citation = s.CitationLabel, s.CanonicalText }) };
    }
}
