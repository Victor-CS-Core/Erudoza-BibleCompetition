using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;

namespace Erudoza.Application.Content;

public static class ScriptureCatalog
{
    public const int MaxChaptersPerImport = 8;

    public static readonly IReadOnlyList<ScriptureTranslationDto> Translations =
    [
        new("web", "World English Bible", "Public Domain", "English"),
        new("kjv", "King James Version", "Public Domain", "English"),
        new("asv", "American Standard Version (1901)", "Public Domain", "English"),
        new("bbe", "Bible in Basic English", "Public Domain", "English"),
        new("webbe", "World English Bible, British Edition", "Public Domain", "English"),
        new("oeb-us", "Open English Bible, US Edition", "Public Domain", "English")
    ];

    public static readonly IReadOnlyList<ScriptureBookDto> Books =
    [
        new("GEN", "Genesis"),
        new("EXO", "Exodus"),
        new("LEV", "Leviticus"),
        new("NUM", "Numbers"),
        new("DEU", "Deuteronomy"),
        new("JOS", "Joshua"),
        new("JDG", "Judges"),
        new("RUT", "Ruth"),
        new("1SA", "1 Samuel"),
        new("2SA", "2 Samuel"),
        new("1KI", "1 Kings"),
        new("2KI", "2 Kings"),
        new("EZR", "Ezra"),
        new("NEH", "Nehemiah"),
        new("EST", "Esther"),
        new("JOB", "Job"),
        new("PSA", "Psalms"),
        new("PRO", "Proverbs"),
        new("ECC", "Ecclesiastes"),
        new("SNG", "Song of Songs"),
        new("ISA", "Isaiah"),
        new("JER", "Jeremiah"),
        new("LAM", "Lamentations"),
        new("EZK", "Ezekiel"),
        new("DAN", "Daniel"),
        new("HOS", "Hosea"),
        new("JOL", "Joel"),
        new("AMO", "Amos"),
        new("OBA", "Obadiah"),
        new("JON", "Jonah"),
        new("MIC", "Micah"),
        new("NAM", "Nahum"),
        new("HAB", "Habakkuk"),
        new("ZEP", "Zephaniah"),
        new("HAG", "Haggai"),
        new("ZEC", "Zechariah"),
        new("MAL", "Malachi"),
        new("MAT", "Matthew"),
        new("MRK", "Mark"),
        new("LUK", "Luke"),
        new("JHN", "John"),
        new("ACT", "Acts"),
        new("ROM", "Romans"),
        new("1CO", "1 Corinthians"),
        new("2CO", "2 Corinthians"),
        new("GAL", "Galatians"),
        new("EPH", "Ephesians"),
        new("PHP", "Philippians"),
        new("COL", "Colossians"),
        new("1TH", "1 Thessalonians"),
        new("2TH", "2 Thessalonians"),
        new("1TI", "1 Timothy"),
        new("2TI", "2 Timothy"),
        new("TIT", "Titus"),
        new("PHM", "Philemon"),
        new("HEB", "Hebrews"),
        new("JAS", "James"),
        new("1PE", "1 Peter"),
        new("2PE", "2 Peter"),
        new("1JN", "1 John"),
        new("2JN", "2 John"),
        new("3JN", "3 John"),
        new("JUD", "Jude"),
        new("REV", "Revelation")
    ];

    public static ScriptureCatalogDto List() => new(Translations, Books);

    public static ScriptureTranslationDto RequireTranslation(string translationId)
    {
        var match = Translations.FirstOrDefault(item =>
            string.Equals(item.Id, translationId, StringComparison.OrdinalIgnoreCase));
        return match ?? throw new DomainException("That translation is not in the public-domain catalog.");
    }

    public static ScriptureBookDto RequireBook(string bookKey)
    {
        var match = Books.FirstOrDefault(item =>
            string.Equals(item.BookKey, bookKey, StringComparison.OrdinalIgnoreCase));
        return match ?? throw new DomainException("That book is not available in the catalog.");
    }

    public static void EnsureChapterRange(int startChapter, int endChapter)
    {
        if (startChapter < 1 || endChapter < startChapter)
        {
            throw new DomainException("End chapter must be at or after the start chapter.");
        }

        if (endChapter - startChapter + 1 > MaxChaptersPerImport)
        {
            throw new DomainException($"Import at most {MaxChaptersPerImport} chapters at a time.");
        }
    }

    public static BibleChapter ParseChapter(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (!root.TryGetProperty("translation", out var translation) || !root.TryGetProperty("verses", out var verses))
        {
            throw new DomainException("The Scripture catalog returned an unexpected chapter payload.");
        }

        var license = translation.TryGetProperty("license", out var licenseNode) ? licenseNode.GetString() : null;
        if (string.IsNullOrWhiteSpace(license) ||
            !(license.Contains("Public Domain", StringComparison.OrdinalIgnoreCase)
              || license.Contains("Creative Commons", StringComparison.OrdinalIgnoreCase)))
        {
            throw new DomainException("Only public-domain or Creative Commons translations can be imported.");
        }

        var parsedVerses = new List<BibleChapterVerse>();
        foreach (var verse in verses.EnumerateArray())
        {
            var text = verse.GetProperty("text").GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            parsedVerses.Add(new BibleChapterVerse(
                verse.GetProperty("book_id").GetString() ?? "",
                verse.GetProperty("book").GetString() ?? "",
                verse.GetProperty("chapter").GetInt32(),
                verse.GetProperty("verse").GetInt32(),
                text));
        }

        if (parsedVerses.Count == 0)
        {
            throw new DomainException("The selected chapter has no stored verses.");
        }

        return new BibleChapter(
            translation.GetProperty("identifier").GetString() ?? "",
            translation.GetProperty("name").GetString() ?? "",
            license,
            parsedVerses);
    }

    public static ImportContentPackRequest ToImportRequest(
        ScriptureTranslationDto translation,
        ScriptureBookDto book,
        int startChapter,
        int endChapter,
        IReadOnlyList<BibleChapter> chapters)
    {
        var units = new List<ImportUnitDto>();
        var ordinal = 1;
        foreach (var chapter in chapters.OrderBy(item => item.Verses[0].Chapter))
        {
            foreach (var verse in chapter.Verses.OrderBy(item => item.Verse))
            {
                units.Add(new ImportUnitDto(
                    $"{book.Name} {verse.Chapter}:{verse.Verse}",
                    book.BookKey,
                    verse.Chapter,
                    verse.Verse,
                    ordinal,
                    verse.Text));
                ordinal++;
            }
        }

        return new ImportContentPackRequest(
            $"{translation.Id}-{book.BookKey}-{startChapter}-{endChapter}".ToLowerInvariant(),
            1,
            "en",
            nameof(SourceType.Scripture),
            [new ImportDocumentDto(book.Name, units)],
            "public-domain");
    }
}
