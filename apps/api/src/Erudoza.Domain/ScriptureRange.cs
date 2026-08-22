namespace Erudoza.Domain;

public readonly record struct ScriptureLocator(string BookKey, int Chapter, int Verse, int Ordinal);

public readonly record struct ScriptureRange(
    string BookKey,
    int StartChapter,
    int StartVerse,
    int EndChapter,
    int EndVerse)
{
    public bool Contains(ScriptureLocator locator)
    {
        if (!string.Equals(BookKey, locator.BookKey, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (locator.Chapter < StartChapter || locator.Chapter > EndChapter)
        {
            return false;
        }

        if (locator.Chapter == StartChapter && locator.Verse < StartVerse)
        {
            return false;
        }

        if (locator.Chapter == EndChapter && locator.Verse > EndVerse)
        {
            return false;
        }

        return true;
    }
}
