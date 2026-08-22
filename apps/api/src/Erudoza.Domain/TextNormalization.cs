using System.Text;
using System.Text.RegularExpressions;

namespace Erudoza.Domain;

public sealed record NormalizationProfile(
    bool IgnoreCase,
    bool TrimWhitespace,
    bool CollapseWhitespace,
    bool IgnoreConfiguredPunctuation)
{
    public static NormalizationProfile ExactText { get; } = new(true, true, true, true);
    public static NormalizationProfile ShortFact { get; } = new(true, true, true, true);
}

public static class TextNormalization
{
    private static readonly Regex ExtraSpace = new(@"\s+", RegexOptions.Compiled);
    private static readonly char[] Punctuation = ['.', ',', ';', ':', '!', '?', '"', '\'', '“', '”', '‘', '’'];

    public static string Normalize(string? value, NormalizationProfile profile)
    {
        var text = value ?? string.Empty;
        if (profile.TrimWhitespace)
        {
            text = text.Trim();
        }

        if (profile.IgnoreCase)
        {
            text = text.ToLowerInvariant();
        }

        if (profile.IgnoreConfiguredPunctuation)
        {
            var builder = new StringBuilder(text.Length);
            foreach (var ch in text)
            {
                if (Array.IndexOf(Punctuation, ch) >= 0)
                {
                    continue;
                }

                builder.Append(ch);
            }

            text = builder.ToString();
        }

        if (profile.CollapseWhitespace)
        {
            text = ExtraSpace.Replace(text, " ").Trim();
        }

        return text;
    }
}
