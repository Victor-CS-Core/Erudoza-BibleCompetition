namespace Erudoza.Domain.Study;

public static class VerseBuilderGenerator
{
    public const string ActivityType = "VerseBuilder";
    public const string ProviderType = "VerseBuilderActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(SourceUnit unit, int seed, int difficulty = 3)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var words = unit.CanonicalText.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (words.Length < 4)
        {
            throw new DomainException("Verse Builder needs a longer stored verse.");
        }

        var chunks = Chunk(words, difficulty);
        var random = new Random(seed);
        var shuffled = chunks
            .Select((text, correctIndex) => new { text, correctIndex })
            .OrderBy(_ => random.Next())
            .Select((item, displayIndex) => new MissingWordsToken(item.text, false, displayIndex))
            .ToList();

        var payload = new ActivityPayload(
            unit.CitationLabel,
            "Build the verse in the correct order.",
            shuffled,
            difficulty);
        return (payload, ActivitySerialization.AnswerKey(unit.CanonicalText));
    }

    public static IReadOnlyList<string> Chunk(IReadOnlyList<string> words, int difficulty = 3)
    {
        var size = difficulty <= 1 ? Math.Min(4, Math.Max(2, words.Count / 2)) : difficulty >= 5 ? 1 : 2;
        var chunks = new List<string>();
        for (var index = 0; index < words.Count; index += size)
        {
            chunks.Add(string.Join(' ', words.Skip(index).Take(size)));
        }

        return chunks;
    }
}
