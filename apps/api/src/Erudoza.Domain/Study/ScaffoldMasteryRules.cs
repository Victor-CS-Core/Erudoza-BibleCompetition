namespace Erudoza.Domain.Study;

public sealed record MasteryScores(
    int Recognition,
    int ExactWording,
    int Reference,
    int Sequence,
    int FactualRecall,
    MasteryLevel Level);

public static class ScaffoldMasteryRules
{
    public const string AlgorithmVersion = "v1-scaffold";

    public static MasteryScores Apply(
        MasteryScores current,
        bool isCorrect,
        bool hintsUsed,
        string activityType)
    {
        var recognition = current.Recognition;
        var exact = current.ExactWording;

        if (isCorrect)
        {
            var exactCredit = activityType == MissingWordsGenerator.ActivityType && !hintsUsed ? 18 : 8;
            var recognitionCredit = hintsUsed ? 4 : 10;
            recognition = Bound(recognition + recognitionCredit);
            exact = Bound(exact + exactCredit);
        }
        else
        {
            recognition = Bound(recognition - 2);
            exact = Bound(exact - 6);
        }

        return current with
        {
            Recognition = recognition,
            ExactWording = exact,
            Level = ResolveLevel(recognition, exact, isCorrect)
        };
    }

    public static DateTimeOffset NextReview(DateTimeOffset nowUtc, bool isCorrect)
    {
        return isCorrect ? nowUtc.AddDays(2) : nowUtc.AddHours(1);
    }

    public static int Bound(int value) => Math.Clamp(value, 0, 100);

    private static MasteryLevel ResolveLevel(int recognition, int exact, bool lastCorrect)
    {
        if (exact >= 80 && recognition >= 70)
        {
            return MasteryLevel.Mastered;
        }

        if (exact >= 55)
        {
            return MasteryLevel.Strong;
        }

        if (!lastCorrect || exact > 0)
        {
            return exact == 0 && recognition == 0 ? MasteryLevel.Learning : MasteryLevel.Review;
        }

        return MasteryLevel.Learning;
    }
}
