using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Study;

public sealed class ScriptureNotebookConflictException(string message = "The notebook changed. Reload it before retrying.") : Exception(message);
public sealed class ScriptureNotebookEntryNotFoundException() : Exception("Notebook entry not found.");

public sealed class ScriptureNotebookService(IErudozaDbContext db, TimeProvider time)
{
    private const string Kind = "scripture-notebook";
    private const int MaxEntries = 200;
    private const long MaxSafeVersion = 9_007_199_254_740_991;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict,
        PropertyNameCaseInsensitive = false
    };
    private sealed record StoredNotebook(IReadOnlyList<NotebookEntryDto> Entries);

    public async Task<StudyNotebookDto> GetAsync(Guid organizationId, Guid userId, CancellationToken ct)
    {
        var row = await Row(organizationId, userId).AsNoTracking().SingleOrDefaultAsync(ct);
        return Read(row);
    }

    public async Task<StudyNotebookDto> PutAsync(Guid organizationId, Guid userId, Guid entryId, JsonElement request, CancellationToken ct)
    {
        var (version, input) = ParseWrite(request);
        return await Mutate(organizationId, userId, version, async (entries, token) =>
        {
            var anchor = await ResolveAnchor(input, token);
            var saved = new NotebookEntryDto(entryId, input.Kind, input.ContentPackId, input.Chapter, input.SourceUnitId,
                input.StartOffset, input.EndOffset, input.Color, input.Note, anchor.BookName, anchor.Citation, anchor.Quote, time.GetUtcNow());
            var priorIndex = entries.FindIndex(entry => entry.Id == entryId);
            if (priorIndex >= 0) entries[priorIndex] = saved;
            else entries.Add(saved);
            entries.RemoveAll(entry => entry.Id != entryId && (input.Kind == NotebookKind.Bookmark && entry.Kind == NotebookKind.Bookmark
                && entry.ContentPackId == input.ContentPackId && entry.Chapter == input.Chapter
                || input.Kind == NotebookKind.Highlight && entry.Kind == NotebookKind.Highlight && entry.SourceUnitId == input.SourceUnitId
                    && entry.StartOffset == input.StartOffset && entry.EndOffset == input.EndOffset));
            if (entries.Count > MaxEntries)
                throw new ScriptureNotebookConflictException("Your notebook already has 200 entries. Edit or delete an entry before adding another.");
        }, ct);
    }

    public Task<StudyNotebookDto> DeleteAsync(Guid organizationId, Guid userId, Guid entryId, long version, CancellationToken ct)
    {
        if (version is < 0 or > MaxSafeVersion) throw Invalid("Notebook version must be a nonnegative safe integer.");
        return Mutate(organizationId, userId, version, (entries, _) =>
        {
            if (entries.RemoveAll(entry => entry.Id == entryId) == 0) throw new ScriptureNotebookEntryNotFoundException();
            return Task.CompletedTask;
        }, ct);
    }

    private async Task<StudyNotebookDto> Mutate(Guid organizationId, Guid userId, long expectedVersion,
        Func<List<NotebookEntryDto>, CancellationToken, Task> change, CancellationToken ct)
    {
        await using var transaction = await db.BeginSerializableTransactionAsync(ct);
        try
        {
            var row = await Row(organizationId, userId).SingleOrDefaultAsync(ct);
            var current = Read(row);
            if (current.Version != expectedVersion) throw new ScriptureNotebookConflictException();
            var entries = current.Entries.ToList();
            await change(entries, ct);
            var nextVersion = expectedVersion + 1;
            if (row is null)
            {
                row = new PbeTrainingRecord
                {
                    OrganizationId = organizationId,
                    SeasonId = Guid.Empty,
                    OwnerId = userId,
                    Kind = Kind,
                    Id = userId.ToString(),
                    Revision = nextVersion,
                    DataJson = JsonSerializer.Serialize(new StoredNotebook(entries), Json)
                };
                db.PbeTrainingRecords.Add(row);
            }
            else
            {
                row.DataJson = JsonSerializer.Serialize(new StoredNotebook(entries), Json);
                row.Revision = nextVersion;
            }
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return new(nextVersion, entries);
        }
        catch (Exception exception) when (IsWriteConflict(exception))
        {
            await transaction.RollbackAsync(ct);
            throw new ScriptureNotebookConflictException();
        }
    }

    private IQueryable<PbeTrainingRecord> Row(Guid organizationId, Guid userId) => db.PbeTrainingRecords.Where(record =>
        record.OrganizationId == organizationId && record.Kind == Kind && record.Id == userId.ToString() && record.OwnerId == userId);

    private static StudyNotebookDto Read(PbeTrainingRecord? row)
    {
        if (row is null) return new(0, []);
        var stored = JsonSerializer.Deserialize<StoredNotebook>(row.DataJson, Json)
            ?? throw new InvalidOperationException("Stored notebook is invalid.");
        if (stored.Entries.Count > MaxEntries) throw new InvalidOperationException("Stored notebook exceeds its capacity.");
        return new(row.Revision, stored.Entries);
    }

    private async Task<(string BookName, string Citation, string Quote)> ResolveAnchor(NotebookEntryInput input, CancellationToken ct)
    {
        var pack = await db.ContentPacks.AsNoTracking().Where(item => item.Id == input.ContentPackId
                && item.OrganizationId == BuiltInLibrary.OrganizationId && item.IsBuiltIn && item.IsActive
                && item.SourceType == SourceType.Scripture)
            .Select(item => new { Name = item.Documents.Select(document => document.Name).Single(), item.Id })
            .SingleOrDefaultAsync(ct);
        if (pack is null) throw Invalid("Choose an active book from the built-in Scripture library.");
        if (input.Kind == NotebookKind.Bookmark)
        {
            if (!await db.SourceUnits.AsNoTracking().AnyAsync(unit => unit.OrganizationId == BuiltInLibrary.OrganizationId
                    && unit.ContentPackId == pack.Id && unit.Chapter == input.Chapter && unit.IsActive && !unit.IsRetired, ct))
                throw Invalid("Choose a valid chapter in this book.");
            return (pack.Name, $"{pack.Name} {input.Chapter}", "");
        }
        var source = await db.SourceUnits.AsNoTracking().Where(unit => unit.Id == input.SourceUnitId
                && unit.OrganizationId == BuiltInLibrary.OrganizationId && unit.ContentPackId == pack.Id
                && unit.Chapter == input.Chapter && unit.IsActive && !unit.IsRetired)
            .Select(unit => new { unit.CitationLabel, unit.CanonicalText }).SingleOrDefaultAsync(ct);
        if (source is null) throw Invalid("The selection does not match this built-in book and chapter.");
        if (input.EndOffset > source.CanonicalText.Length) throw Invalid("Choose a nonempty selection inside one verse.");
        var quote = source.CanonicalText[input.StartOffset!.Value..input.EndOffset!.Value];
        if (string.IsNullOrWhiteSpace(quote)) throw Invalid("Choose a nonempty selection inside one verse.");
        return (pack.Name, source.CitationLabel, quote);
    }

    private static (long Version, NotebookEntryInput Entry) ParseWrite(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object || !request.TryGetProperty("version", out var version)
            || version.ValueKind != JsonValueKind.Number || !version.TryGetInt64(out var expected) || expected is < 0 or > MaxSafeVersion
            || !request.TryGetProperty("entry", out var entry) || entry.ValueKind != JsonValueKind.Object)
            throw Invalid("A valid notebook version and entry are required.");
        return (expected, ParseEntry(entry));
    }

    private static NotebookEntryInput ParseEntry(JsonElement entry)
    {
        static bool Null(JsonElement value) => value.ValueKind == JsonValueKind.Null;
        if (!TryString(entry, "kind", out var rawKind) || !TryKind(rawKind, out var kind)
            || !TryGuid(entry, "contentPackId", out var packId) || !TryInt(entry, "chapter", out var chapter) || chapter < 1
            || !entry.TryGetProperty("sourceUnitId", out var rawSource) || !entry.TryGetProperty("startOffset", out var rawStart)
            || !entry.TryGetProperty("endOffset", out var rawEnd) || !entry.TryGetProperty("color", out var rawColor)
            || !entry.TryGetProperty("note", out var rawNote))
            throw Invalid("A complete notebook entry is required.");
        if (kind == NotebookKind.Bookmark)
        {
            if (!Null(rawSource) || !Null(rawStart) || !Null(rawEnd) || !Null(rawColor) || !Null(rawNote))
                throw Invalid("Bookmarks must identify only a book and chapter.");
            return new(kind, packId, chapter, null, null, null, null, null);
        }
        if (rawSource.ValueKind != JsonValueKind.String || !Guid.TryParseExact(rawSource.GetString(), "D", out var sourceId) || sourceId == Guid.Empty
            || rawStart.ValueKind != JsonValueKind.Number || !rawStart.TryGetInt32(out var start) || start < 0
            || rawEnd.ValueKind != JsonValueKind.Number || !rawEnd.TryGetInt32(out var end) || end <= start)
            throw Invalid("Choose a nonempty selection inside one verse.");
        if (kind == NotebookKind.Note)
        {
            if (!Null(rawColor) || rawNote.ValueKind != JsonValueKind.String) throw Invalid("Notes require text and cannot have a highlight color.");
            var note = rawNote.GetString()!.Trim();
            if (note.Length is < 1 or > 2000) throw Invalid("Notes must contain between 1 and 2,000 characters.");
            return new(kind, packId, chapter, sourceId, start, end, null, note);
        }
        if (!Null(rawNote) || rawColor.ValueKind != JsonValueKind.String
            || !TryColor(rawColor.GetString()!, out var color))
            throw Invalid("Highlights require Promises, People, or Review and cannot contain a note.");
        return new(kind, packId, chapter, sourceId, start, end, color, null);
    }

    private static bool TryString(JsonElement value, string name, out string text)
    {
        text = "";
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) return false;
        text = property.GetString()!;
        return true;
    }
    private static bool TryGuid(JsonElement value, string name, out Guid id)
    {
        id = Guid.Empty;
        return TryString(value, name, out var text) && Guid.TryParseExact(text, "D", out id) && id != Guid.Empty;
    }
    private static bool TryKind(string value, out NotebookKind kind)
    {
        kind = value switch
        {
            "highlight" => NotebookKind.Highlight,
            "note" => NotebookKind.Note,
            "bookmark" => NotebookKind.Bookmark,
            _ => (NotebookKind)(-1)
        };
        return (int)kind >= 0;
    }
    private static bool TryColor(string value, out HighlightColor color)
    {
        color = value switch
        {
            "Promises" => HighlightColor.Promises,
            "People" => HighlightColor.People,
            "Review" => HighlightColor.Review,
            _ => (HighlightColor)(-1)
        };
        return (int)color >= 0;
    }
    private static bool TryInt(JsonElement value, string name, out int number)
    {
        number = 0;
        return value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out number);
    }
    private static DomainException Invalid(string message) => new(message);
    private static bool IsWriteConflict(Exception exception) => exception is DbUpdateConcurrencyException
        || exception is DbUpdateException update && (update.InnerException?.Message.Contains("UNIQUE constraint failed", StringComparison.OrdinalIgnoreCase) == true
            || update.InnerException?.Message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase) == true
            || update.InnerException?.Message.Contains("database is locked", StringComparison.OrdinalIgnoreCase) == true)
        || exception.Message.Contains("database is locked", StringComparison.OrdinalIgnoreCase);
}
