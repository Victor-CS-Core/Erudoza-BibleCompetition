using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;

namespace Erudoza.IntegrationTests;

public sealed class FakeBibleTextClient : IBibleTextClient
{
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
