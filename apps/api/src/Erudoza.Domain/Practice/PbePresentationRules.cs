namespace Erudoza.Domain.Practice;

public static class PbePresentationRules
{
    public static int RehearsalPoints(int earned, double elapsedMs, int points)
    {
        if (points < 1 || earned < 0 || earned > points || !double.IsFinite(elapsedMs) || elapsedMs < 0)
            throw new ArgumentException("Invalid rehearsal score.");
        return elapsedMs <= PbeRules.ResponseSeconds(points) * 1000 ? earned : 0;
    }
}
