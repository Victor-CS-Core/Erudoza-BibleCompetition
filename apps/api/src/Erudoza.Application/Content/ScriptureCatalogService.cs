using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;

namespace Erudoza.Application.Content;

public sealed class ScriptureCatalogService(IBibleTextClient bible, ContentImportService importer)
{
    public ScriptureCatalogDto List() => ScriptureCatalog.List();

    public async Task<IReadOnlyList<ScriptureBookDto>> BooksAsync(string translationId, CancellationToken ct)
    {
        var translation = ScriptureCatalog.RequireTranslation(translationId);
        return await bible.GetBooksAsync(translation.Id, ct);
    }

    public async Task<ScriptureChaptersDto> ChaptersAsync(string translationId, string bookKey, CancellationToken ct)
    {
        var translation = ScriptureCatalog.RequireTranslation(translationId);
        var books = await bible.GetBooksAsync(translation.Id, ct);
        var book = books.FirstOrDefault(item => string.Equals(item.BookKey, bookKey, StringComparison.OrdinalIgnoreCase))
            ?? throw new DomainException("Choose a book available in the selected translation.");
        return new(await bible.GetChaptersAsync(translation.Id, book.BookKey, ct), ScriptureCatalog.MaxChaptersPerImport);
    }

    public async Task<ContentPack> ImportAsync(
        Guid organizationId,
        ImportScriptureCatalogRequest request,
        CancellationToken cancellationToken)
    {
        var translation = ScriptureCatalog.RequireTranslation(request.TranslationId);
        ScriptureCatalog.EnsureChapterRange(request.StartChapter, request.EndChapter);
        var books = await bible.GetBooksAsync(translation.Id, cancellationToken);
        var book = books.FirstOrDefault(item => string.Equals(item.BookKey, request.BookKey, StringComparison.OrdinalIgnoreCase))
            ?? throw new DomainException("Choose a book available in the selected translation.");
        var available = await bible.GetChaptersAsync(translation.Id, book.BookKey, cancellationToken);
        if (Enumerable.Range(request.StartChapter, request.EndChapter - request.StartChapter + 1).Any(chapter => !available.Contains(chapter)))
            throw new DomainException($"Choose chapters available in {book.Name} for this translation.");

        var chapters = new List<BibleChapter>();
        for (var chapter = request.StartChapter; chapter <= request.EndChapter; chapter++)
        {
            chapters.Add(await bible.GetChapterAsync(translation.Id, book.BookKey, chapter, cancellationToken));
        }

        var import = ScriptureCatalog.ToImportRequest(
            translation,
            book,
            request.StartChapter,
            request.EndChapter,
            chapters);
        return await importer.ImportAsync(organizationId, import, cancellationToken);
    }
}
