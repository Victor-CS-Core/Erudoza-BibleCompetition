using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class ScriptureCatalogTests
{
    private const string WebDaniel1 = """
        {
          "translation": {
            "identifier": "web",
            "name": "World English Bible",
            "license": "Public Domain"
          },
          "verses": [
            {
              "book_id": "DAN",
              "book": "Daniel",
              "chapter": 1,
              "verse": 1,
              "text": "In the third year of the reign of Jehoiakim king of Judah Nebuchadnezzar king of Babylon came to Jerusalem and besieged it.\n"
            },
            {
              "book_id": "DAN",
              "book": "Daniel",
              "chapter": 1,
              "verse": 2,
              "text": "The Lord gave Jehoiakim king of Judah into his hand.\n"
            }
          ]
        }
        """;

    [Fact]
    public void Parser_keeps_public_domain_chapter_text()
    {
        var chapter = ScriptureCatalog.ParseChapter(WebDaniel1);
        chapter.TranslationId.Should().Be("web");
        chapter.License.Should().Be("Public Domain");
        chapter.Verses.Should().HaveCount(2);
        chapter.Verses[0].Text.Should().StartWith("In the third year");
    }

    [Fact]
    public void Parser_rejects_copyrighted_payloads()
    {
        var json = """
            {
              "translation": { "identifier": "niv", "name": "NIV", "license": "All rights reserved" },
              "verses": [{ "book_id": "DAN", "book": "Daniel", "chapter": 1, "verse": 1, "text": "Nope." }]
            }
            """;

        var act = () => ScriptureCatalog.ParseChapter(json);
        act.Should().Throw<DomainException>().WithMessage("*public-domain*");
    }

    [Fact]
    public void Import_request_uses_a_versioned_pack_key_and_public_domain_license()
    {
        var chapter = ScriptureCatalog.ParseChapter(WebDaniel1);
        var request = ScriptureCatalog.ToImportRequest(
            ScriptureCatalog.RequireTranslation("web"),
            ScriptureCatalog.RequireBook("DAN"),
            1,
            1,
            [chapter]);

        request.PackKey.Should().Be("web-dan-1-1");
        request.LicensingStatus.Should().Be("public-domain");
        request.Documents[0].Units.Should().HaveCount(2);
        request.Documents[0].Units[0].Citation.Should().Be("Daniel 1:1");
        request.Documents[0].Units[0].BookKey.Should().Be("DAN");
    }

    [Fact]
    public void Chapter_range_is_capped()
    {
        var act = () => ScriptureCatalog.EnsureChapterRange(1, 12);
        act.Should().Throw<DomainException>().WithMessage("*8*");
    }
}
