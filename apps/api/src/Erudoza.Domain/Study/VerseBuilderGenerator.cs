namespace Erudoza.Domain.Study;

public static class VerseBuilderGenerator
{
    public const string ActivityType = "VerseBuilder";
    public const string ProviderType = "VerseBuilderActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(SourceUnit unit, int seed)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var words = unit.CanonicalText.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (words.Length < 4)
        {
            throw new DomainException("Verse Builder needs a longer stored verse.");
        }

        var chunks = Chunk(words);
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
            2);
        return (payload, ActivitySerialization.AnswerKey(unit.CanonicalText));
    }

    public static IReadOnlyList<string> Chunk(IReadOnlyList<string> words)
    {
        var size = words.Count <= 8 ? 2 : 3;
        var chunks = new List<string>();
        for (var index = 0; index < words.Count; index += size)
        {
            chunks.Add(string.Join(' ', words.Skip(index).Take(size)));
        }

        return chunks;
    }
}
