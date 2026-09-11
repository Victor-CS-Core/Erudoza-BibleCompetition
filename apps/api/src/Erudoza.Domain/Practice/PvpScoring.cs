namespace Erudoza.Domain.Practice;

public sealed record ScoreBreakdown(int AccuracyHundredths, int SpeedHundredths)
{
    public int TotalHundredths => checked(AccuracyHundredths + SpeedHundredths);
}

public static class PvpScoring
{
    public static ScoreBreakdown Score(int earnedPoints, int durationSeconds, TimeSpan elapsed, bool deadlineDraft = false)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(earnedPoints);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(durationSeconds);
        ArgumentOutOfRangeException.ThrowIfLessThan(elapsed, TimeSpan.Zero);
        if (elapsed > TimeSpan.FromSeconds(durationSeconds)) return new(0, 0);
        var accuracy = checked(earnedPoints * 100);
        // Integer ticks avoid floating-point changes at one-second boundaries.
        var seconds = elapsed.Ticks / TimeSpan.TicksPerSecond + (elapsed.Ticks % TimeSpan.TicksPerSecond == 0 ? 0 : 1);
        var bonus = deadlineDraft ? 0 : checked((int)((long)accuracy * (durationSeconds - seconds) / (4L * durationSeconds)));
        return new(accuracy, bonus);
    }
}
