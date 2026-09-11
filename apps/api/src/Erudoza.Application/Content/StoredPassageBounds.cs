using Erudoza.Application.Contracts;
using Erudoza.Domain;

namespace Erudoza.Application.Content;

public static class StoredPassageBounds
{
    public static IReadOnlyList<SourceUnit> RequireRange(ScopeRangeDto range, IReadOnlyCollection<SourceUnit> units)
    {
        if (string.IsNullOrWhiteSpace(range.BookKey) || range.StartChapter < 1 || range.StartVerse < 1
            || range.EndChapter < range.StartChapter || range.EndVerse < 1
            || range.EndChapter == range.StartChapter && range.EndVerse < range.StartVerse)
            throw new DomainException("Choose a valid passage range.");
        var book = units.Where(u => string.Equals(u.BookKey, range.BookKey, StringComparison.OrdinalIgnoreCase)
            && u.IsActive && !u.IsRetired).ToList();
        var chapters = book.GroupBy(u => u.Chapter).ToDictionary(g => g.Key, g => g.ToDictionary(u => u.Verse));
        if (!chapters.TryGetValue(range.StartChapter, out var first) || !first.ContainsKey(range.StartVerse)
            || !chapters.TryGetValue(range.EndChapter, out var last) || !last.ContainsKey(range.EndVerse))
            throw new DomainException("The passage boundary does not exist in the stored book.");
        // Check the entire intended range, including intermediate chapters and missing verses.
        var selected = new List<SourceUnit>();
        for (var chapter = range.StartChapter; chapter <= range.EndChapter; chapter++)
        {
            if (!chapters.TryGetValue(chapter, out var verses)) throw new DomainException("The passage includes an unavailable chapter.");
            var start = chapter == range.StartChapter ? range.StartVerse : 1;
            var end = chapter == range.EndChapter ? range.EndVerse : verses.Keys.Max();
            for (var verse = start; verse <= end; verse++)
            {
                if (!verses.TryGetValue(verse, out var unit)) throw new DomainException("The passage includes an unavailable verse.");
                selected.Add(unit);
            }
        }
        return selected;
    }
}
