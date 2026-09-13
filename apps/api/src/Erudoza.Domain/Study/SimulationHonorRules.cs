namespace Erudoza.Domain.Study;

public static class SimulationHonorRules
{
    public const string Version = "simulation-v1";
    public static readonly IReadOnlyList<MasteryHonorDefinition> Catalog = [
        new("simulation:first-rehearsal", "First Rehearsal", "Complete one simulation.", "Simulation"),
        new("simulation:event-ready", "Event Ready", "Complete a 90-question Full Event at 1× with halftime and two readings.", "Simulation"),
        new("simulation:steady-team", "Steady Team", "Complete five simulations across at least three UTC dates.", "Simulation"),
        new("simulation:trusted-scribe", "Trusted Scribe", "Explicitly submit 30 distinct questions as scribe in completed simulations.", "Simulation"),
        new("simulation:team-precision", "Team Precision", "Resolve at least 30 distinct questions with aggregate accuracy of 90% or higher; latest results count and pending reviews block qualification.", "Simulation")
    ];
}
