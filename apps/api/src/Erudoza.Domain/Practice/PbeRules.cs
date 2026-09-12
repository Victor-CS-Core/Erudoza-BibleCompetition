namespace Erudoza.Domain.Practice;

public static class PbeRules
{
    public const string RuleVersion = "nad-pbe-2023-24-v2";
    public const string ScoringVersion = "pbe-rubric-v2";

    public static int ResponseSeconds(int points)
    {
        if (points is < 1 or > 8) throw new ArgumentOutOfRangeException(nameof(points), "PBE questions require 1–8 points.");
        return 20 + 5 * points;
    }
}
