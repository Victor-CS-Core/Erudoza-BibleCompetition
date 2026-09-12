namespace Erudoza.Domain.Study;

public static class VerseBuilderGenerator
{
    public const string ActivityType = "VerseBuilder";
    public const string ProviderType = "VerseBuilderActivityProvider";

    public static (ActivityPayload Payload, string AnswerKeyJson) Create(SourceUnit unit, int seed, int difficulty = 3, string? generatorVersion = null, string? evidenceProfile = null)
    {
        ArgumentNullException.ThrowIfNull(unit);
        var words = unit.CanonicalText.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (words.Length < 4)
        {
            throw new DomainException("Verse Builder needs a longer stored verse.");
        }

        var chunks = Chunk(words, difficulty, generatorVersion);
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
            difficulty, GeneratorVersion: generatorVersion, EvidenceProfile: evidenceProfile);
        return (payload, ActivitySerialization.AnswerKey(unit.CanonicalText));
    }

    public static IReadOnlyList<string> Chunk(IReadOnlyList<string> words, int difficulty = 3, string? generatorVersion = null)
    {
        var size = difficulty <= 1 ? Math.Min(4, Math.Max(2, words.Count / 2)) : difficulty >= 5 ? 1 : 2;
        if (generatorVersion == "memory-v3") size = Math.Max(size, (int)Math.Ceiling(words.Count / 12.0));
        var chunks = new List<string>();
        for (var index = 0; index < words.Count; index += size)
        {
            chunks.Add(string.Join(' ', words.Skip(index).Take(size)));
        }

        return chunks;
    }
}
