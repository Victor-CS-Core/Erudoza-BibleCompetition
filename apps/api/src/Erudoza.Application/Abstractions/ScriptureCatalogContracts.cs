using Erudoza.Application.Contracts;

namespace Erudoza.Application.Abstractions;

public sealed record ScriptureTranslationDto(
    string Id,
    string Name,
    string License,
    string Language);

public sealed record ScriptureBookDto(string BookKey, string Name);

public sealed record ScriptureCatalogDto(
    IReadOnlyList<ScriptureTranslationDto> Translations,
    IReadOnlyList<ScriptureBookDto> Books);

public sealed record ImportScriptureCatalogRequest(
    string TranslationId,
    string BookKey,
    int StartChapter,
    int EndChapter);

public sealed record BibleChapterVerse(
    string BookKey,
    string BookName,
    int Chapter,
    int Verse,
    string Text);

public sealed record BibleChapter(
    string TranslationId,
    string TranslationName,
    string License,
    IReadOnlyList<BibleChapterVerse> Verses);

public sealed record ScriptureChaptersDto(IReadOnlyList<int> Chapters, int MaxChaptersPerImport);

public interface IBibleTextClient
{
    Task<IReadOnlyList<ScriptureBookDto>> GetBooksAsync(string translationId, CancellationToken cancellationToken);
    Task<IReadOnlyList<int>> GetChaptersAsync(string translationId, string bookKey, CancellationToken cancellationToken);
    Task<BibleChapter> GetChapterAsync(string translationId, string bookKey, int chapter, CancellationToken cancellationToken);
}
