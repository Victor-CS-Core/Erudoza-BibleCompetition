using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;

namespace Erudoza.IntegrationTests;

public sealed class FakeBibleTextClient : IBibleTextClient
{
    public Task<IReadOnlyList<ScriptureBookDto>> GetBooksAsync(string translationId, CancellationToken ct) => Task.FromResult<IReadOnlyList<ScriptureBookDto>>([new("DAN", "Daniel"), new("JUD", "Jude"), new("JOS", "Joshua")]);
    public Task<IReadOnlyList<int>> GetChaptersAsync(string translationId, string bookKey, CancellationToken ct) => Task.FromResult<IReadOnlyList<int>>(Enumerable.Range(1, bookKey == "JUD" ? 1 : bookKey == "JOS" ? 24 : 12).ToArray());

    public Task<BibleChapter> GetChapterAsync(
        string translationId,
        string bookKey,
        int chapter,
        CancellationToken cancellationToken)
    {
        var json = $$"""
            {
              "translation": {
                "identifier": "{{translationId}}",
                "name": "World English Bible",
                "license": "Public Domain"
              },
              "verses": [
                {
                  "book_id": "{{bookKey}}",
                  "book": "Daniel",
                  "chapter": {{chapter}},
                  "verse": 1,
                  "text": "Catalog sample verse {{chapter}}:1"
                },
                {
                  "book_id": "{{bookKey}}",
                  "book": "Daniel",
                  "chapter": {{chapter}},
                  "verse": 2,
                  "text": "Catalog sample verse {{chapter}}:2"
                }
              ]
            }
            """;
        return Task.FromResult(ScriptureCatalog.ParseChapter(json));
    }
}
