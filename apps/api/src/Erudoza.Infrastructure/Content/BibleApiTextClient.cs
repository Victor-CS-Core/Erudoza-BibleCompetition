using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
using Erudoza.Domain;

namespace Erudoza.Infrastructure.Content;

public sealed class BibleApiTextClient(IHttpClientFactory httpFactory) : IBibleTextClient
{
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
