using System.Text;
using System.Text.RegularExpressions;

namespace Erudoza.Domain.Practice;

public sealed class PracticeQuestion
{
    public Guid Id { get; set; }
    public Guid ContentPackId { get; set; }
    public Guid SourceUnitId { get; set; }
    public string Prompt { get; set; } = "";
    public string Kind { get; set; } = "ShortAnswer";
    public List<AnswerPart> Parts { get; set; } = [];
    public bool Ordered { get; set; }
    public string Evidence { get; set; } = "";
    public string Reference { get; set; } = "";
    public int Version { get; set; } = 1;
}

public sealed class AnswerPart
{
    public List<string> AcceptedAnswers { get; set; } = [];
    public int Points { get; set; } = 1;
}

public static partial class PbeQuestionEvaluator
{
    public static void Validate(PracticeQuestion question)
    {
        ArgumentNullException.ThrowIfNull(question);
        if (question.Id == Guid.Empty || question.ContentPackId == Guid.Empty || question.SourceUnitId == Guid.Empty ||
            string.IsNullOrWhiteSpace(question.Prompt) || string.IsNullOrWhiteSpace(question.Evidence) ||
            string.IsNullOrWhiteSpace(question.Reference) || question.Version < 1)
            throw new ArgumentException("Question identity, version, prompt and source evidence are required.");
        if (question.Kind is not ("ShortAnswer" or "List" or "ExactWords" or "TrueFalse"))
            throw new ArgumentException("Unsupported PBE question kind.");
        if (question.Parts is null || question.Parts.Count is < 1 or > 50 || question.Parts.Any(p => p is null || p.Points is < 1 or > 100 ||
            p.AcceptedAnswers is null || p.AcceptedAnswers.Count is < 1 or > 50 || p.AcceptedAnswers.Any(string.IsNullOrWhiteSpace)))
            throw new ArgumentException("Provide 1–50 scoring parts with positive points and explicit accepted answers.");
        if (question.Kind == "TrueFalse" && (question.Parts.Count != 1 || question.Parts[0].AcceptedAnswers.Any(a => Normalize(a) is not ("TRUE" or "FALSE")) ||
            question.Parts[0].AcceptedAnswers.Select(Normalize).Distinct().Count() != 1))
            throw new ArgumentException("True/false questions require one unambiguous boolean answer.");
    }

    public static int Evaluate(PracticeQuestion question, string[] submitted)
    {
        Validate(question);
        ArgumentNullException.ThrowIfNull(submitted);
        if (submitted.Length > 50 || submitted.Any(s => s is null || s.Length > 10000))
            throw new ArgumentException("Answer exceeds question limits.");
        var answers = submitted.Select(Normalize).ToArray();
        var accepted = question.Parts.Select(p => p.AcceptedAnswers.Select(Normalize).ToHashSet(StringComparer.Ordinal)).ToArray();
        if (question.Ordered || question.Kind == "ExactWords")
            return question.Parts.Select((p, i) => i < answers.Length && accepted[i].Contains(answers[i]) ? p.Points : 0).Sum();

        // Weighted bipartite matching: prioritize higher-value parts, while augmenting
        // existing assignments so overlapping answer variants do not lose valid credit.
        var assignments = Enumerable.Repeat(-1, answers.Length).ToArray();
        bool Assign(int part, bool[] visited)
        {
            for (var i = 0; i < answers.Length; i++)
            {
                if (visited[i] || !accepted[part].Contains(answers[i])) continue;
                visited[i] = true;
                if (assignments[i] < 0 || Assign(assignments[i], visited))
                {
                    assignments[i] = part;
                    return true;
                }
            }
            return false;
        }
        var points = 0;
        foreach (var part in Enumerable.Range(0, question.Parts.Count).OrderByDescending(i => question.Parts[i].Points))
            if (Assign(part, new bool[answers.Length])) points += question.Parts[part].Points;
        return points;
    }

    // Only case, Unicode representation and whitespace normalize; no words,
    // punctuation or word order are discarded or guessed.
    private static string Normalize(string text) => Whitespace().Replace(text.Normalize(NormalizationForm.FormC).Trim(), " ").ToUpperInvariant();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
