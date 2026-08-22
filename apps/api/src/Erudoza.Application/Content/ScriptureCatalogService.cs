using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;

namespace Erudoza.Application.Content;

public sealed class ScriptureCatalogService(IBibleTextClient bible, ContentImportService importer)
{
    public ScriptureCatalogDto List() => ScriptureCatalog.List();

    public async Task<ContentPack> ImportAsync(
        Guid organizationId,
        ImportScriptureCatalogRequest request,
        CancellationToken cancellationToken)
    {
        var translation = ScriptureCatalog.RequireTranslation(request.TranslationId);
        var book = ScriptureCatalog.RequireBook(request.BookKey);
        ScriptureCatalog.EnsureChapterRange(request.StartChapter, request.EndChapter);

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
