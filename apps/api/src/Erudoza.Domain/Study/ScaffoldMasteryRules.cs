namespace Erudoza.Domain.Study;

public sealed record MasteryScores(int Recognition, int ExactWording, int Reference, int Sequence, int FactualRecall, MasteryLevel Level);

public static class ScaffoldMasteryRules
{
    public const string AlgorithmVersion = "v2-skill-evidence";

    public static MasteryScores Apply(MasteryScores current, bool isCorrect, bool hintsUsed,
        string activityType, AnswerMode answerMode = AnswerMode.ExactText, int difficulty = 3)
    {
        var recognition = Bound(current.Recognition + (isCorrect ? hintsUsed ? 4 : 10 : -2));
        var exact = current.ExactWording;
        var reference = current.Reference;
        var sequence = current.Sequence;
        var fact = current.FactualRecall;
        var delta = isCorrect ? (hintsUsed ? 0 : 18) : -6;
        // Award only the skill demonstrated. Choice answers establish recognition only.
        if (answerMode != AnswerMode.SelectedChoice)
        {
            switch (activityType)
            {
                case "MissingWords" when answerMode == AnswerMode.ExactText:
                    var ceiling = difficulty >= 5 ? 100 : difficulty >= 3 ? 70 : 40;
                    exact = isCorrect
                        ? Math.Max(exact, Math.Min(ceiling, Bound(exact + delta)))
                        : Bound(exact + delta);
                    break;
                case "ReferenceMatch": reference = Bound(reference + delta); break;
                case "WhatComesNext":
                case "VerseBuilder": sequence = Bound(sequence + delta); break;
                case "ShortAnswer": fact = Bound(fact + delta); break;
            }
        }
        return new MasteryScores(recognition, exact, reference, sequence, fact,
            exact >= 80 && recognition >= 70 ? MasteryLevel.Mastered : exact >= 55 ? MasteryLevel.Strong
            : exact > 0 || !isCorrect && recognition > 0 ? MasteryLevel.Review : MasteryLevel.Learning);
    }

    public static DateTimeOffset NextReview(DateTimeOffset nowUtc, bool isCorrect) => isCorrect ? nowUtc.AddDays(2) : nowUtc;
    public static int Bound(int value) => Math.Clamp(value, 0, 100);
}
