using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
using Erudoza.Domain;
using Microsoft.Extensions.Caching.Memory;

namespace Erudoza.Infrastructure.Content;

public sealed class BibleApiTextClient(IHttpClientFactory httpFactory, IMemoryCache cache) : IBibleTextClient
{
    public async Task<IReadOnlyList<ScriptureBookDto>> GetBooksAsync(string translationId, CancellationToken cancellationToken)
    {
        var key = $"scripture-books:{translationId}";
        if (cache.TryGetValue<IReadOnlyList<ScriptureBookDto>>(key, out var saved)) return saved!;
        using var data = await GetMetadataAsync($"data/{Uri.EscapeDataString(translationId)}", cancellationToken);
        if (data.RootElement.ValueKind != JsonValueKind.Object ||
            !data.RootElement.TryGetProperty("books", out var items) || items.ValueKind != JsonValueKind.Array)
            throw UnreadableMetadata("book");
        var books = new List<ScriptureBookDto>();
        foreach (var item in items.EnumerateArray())
        {
            if (!TryMetadataString(item, "id", out var id) || !TryMetadataString(item, "name", out var name) ||
                id.Length is < 3 or > 4 || !id.All(character => character is >= 'A' and <= 'Z' or >= '0' and <= '9'))
                throw UnreadableMetadata("book");
            books.Add(new ScriptureBookDto(id, name));
        }
        if (books.Count == 0) throw new DomainException("This translation has no available books.");
        var result = books.ToArray();
        cache.Set(key, (IReadOnlyList<ScriptureBookDto>)result, TimeSpan.FromHours(6));
        return result;
    }

    public async Task<IReadOnlyList<int>> GetChaptersAsync(string translationId, string bookKey, CancellationToken cancellationToken)
    {
        var key = $"scripture-chapters:{translationId}:{bookKey}";
        if (cache.TryGetValue<IReadOnlyList<int>>(key, out var saved)) return saved!;
        using var data = await GetMetadataAsync($"data/{Uri.EscapeDataString(translationId)}/{Uri.EscapeDataString(bookKey)}", cancellationToken);
        if (data.RootElement.ValueKind != JsonValueKind.Object ||
            !data.RootElement.TryGetProperty("chapters", out var items) || items.ValueKind != JsonValueKind.Array)
            throw UnreadableMetadata("chapter");
        var chapters = new SortedSet<int>();
        foreach (var item in items.EnumerateArray())
        {
            if (!TryMetadataString(item, "book_id", out var id) || id != bookKey ||
                !item.TryGetProperty("chapter", out var value) || value.ValueKind != JsonValueKind.Number ||
                !value.TryGetInt32(out var chapter) || chapter < 1)
                throw UnreadableMetadata("chapter");
            chapters.Add(chapter);
        }
        if (chapters.Count == 0) throw new DomainException("This book has no available chapters in the selected translation.");
        var result = chapters.ToArray();
        cache.Set(key, (IReadOnlyList<int>)result, TimeSpan.FromHours(6));
        return result;
    }

    private static DomainException UnreadableMetadata(string kind) =>
        new($"The Scripture catalog returned unreadable {kind} information. Try again later.");

    private static bool TryMetadataString(JsonElement item, string property, out string value)
    {
        value = "";
        if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty(property, out var field) ||
            field.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(field.GetString())) return false;
        value = field.GetString()!;
        return true;
    }

    private async Task<JsonDocument> GetMetadataAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            var client = httpFactory.CreateClient("bible-api");
            using var response = await client.GetAsync(path, cancellationToken);
            if (!response.IsSuccessStatusCode) throw new DomainException("Available books or chapters could not load. Try again in a moment.");
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new DomainException("The Scripture catalog timed out. Try again in a moment."); }
        catch (HttpRequestException) { throw new DomainException("The Scripture catalog is unavailable. Try again in a moment."); }
        catch (JsonException) { throw new DomainException("The Scripture catalog returned unreadable book information. Try again later."); }
    }

    public async Task<BibleChapter> GetChapterAsync(
        string translationId,
        string bookKey,
        int chapter,
        CancellationToken cancellationToken)
    {
        var client = httpFactory.CreateClient("bible-api");
        var path = $"data/{Uri.EscapeDataString(translationId)}/{Uri.EscapeDataString(bookKey)}/{chapter}";
        using var response = await client.GetAsync(path, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new DomainException("The public-domain Scripture catalog could not load that chapter.");
        }

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        return ScriptureCatalog.ParseChapter(json);
    }
}
