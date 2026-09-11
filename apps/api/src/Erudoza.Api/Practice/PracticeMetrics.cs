using System.Diagnostics.Metrics;

namespace Erudoza.Api.Practice;

public static class PracticeMetrics
{
    public const string MeterName = "Erudoza.Practice";
    private static readonly Meter Meter = new(MeterName, "1.0");
    public static readonly Histogram<double> CommandMilliseconds = Meter.CreateHistogram<double>("practice.command.duration", "ms");
    public static readonly Counter<long> RejectedCommands = Meter.CreateCounter<long>("practice.command.rejected");
    public static readonly Counter<long> PhaseTransitions = Meter.CreateCounter<long>("practice.phase.transitions");
    public static readonly Counter<long> RescheduledStarts = Meter.CreateCounter<long>("practice.start.rescheduled");
    public static readonly Counter<long> Restarts = Meter.CreateCounter<long>("practice.match.recovered");
}
