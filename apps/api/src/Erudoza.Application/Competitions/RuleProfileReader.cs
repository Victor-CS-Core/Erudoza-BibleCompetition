using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Competitions;

public static class RuleProfileReader
{
    public static RuleProfileSnapshot ReadSession(StudySession session, RuleProfile profile)
    {
        var snapshot = string.IsNullOrWhiteSpace(session.RuleProfileSnapshotJson) ? Read(profile)
            : JsonSerializer.Deserialize<RuleProfileSnapshot>(session.RuleProfileSnapshotJson)
                ?? throw new DomainException("The session rule snapshot is invalid.");
        if (snapshot.MemoryChallenge is null && snapshot.GeneratorVersion is null && snapshot.EvidenceProfile is null) return snapshot;
        if (snapshot.GeneratorVersion != "memory-v3" || snapshot.MemoryChallenge is not ("Warmup" or "Advanced")
            || snapshot.EvidenceProfile != (snapshot.MemoryChallenge == "Warmup" ? "memory-cued-v3" : "memory-honor-v2")
            || snapshot.MemoryChallenge == "Advanced" && session.Difficulty != TrainingDifficulty.Advanced)
            throw new DomainException("The saved Memory purpose is invalid.");
        return snapshot;
    }

    public static void ValidateCard(StudySession session, RuleProfile profile, ActivityPayload payload)
    {
        var snapshot = ReadSession(session, profile);
        var versioned = snapshot.MemoryChallenge is not null || snapshot.GeneratorVersion is not null || snapshot.EvidenceProfile is not null;
        if (!versioned)
        {
            if (payload.GeneratorVersion is not null || payload.EvidenceProfile is not null)
                throw new DomainException("The saved Memory card snapshot is invalid.");
            return;
        }
        if (payload.GeneratorVersion != "memory-v3" || payload.EvidenceProfile != snapshot.EvidenceProfile)
            throw new DomainException("The saved Memory card snapshot is invalid.");
    }
    public const string PbeStyleV1 = "PBE_STYLE_V1";

    public static readonly string PbeStyleV1Json = """
        {
          "key": "PBE_STYLE_V1",
          "version": 1,
          "simulation": {
            "allowMultipleChoice": false,
            "allowTrueFalse": true,
            "trueFalseMaxRatio": 0.10,
            "showReference": true
          },
          "study": {
            "allowMultipleChoice": true
          }
        }
        """;

    public static RuleProfileSnapshot Read(RuleProfile profile)
    {
        using var document = JsonDocument.Parse(profile.ConfigurationJson);
        var root = document.RootElement;
        var simulation = root.GetProperty("simulation");
        var study = root.GetProperty("study");

        return new RuleProfileSnapshot(
            profile.Key,
            profile.Version,
            study.GetProperty("allowMultipleChoice").GetBoolean(),
            simulation.GetProperty("allowMultipleChoice").GetBoolean(),
            simulation.GetProperty("allowTrueFalse").GetBoolean(),
            simulation.GetProperty("showReference").GetBoolean(),
            simulation.GetProperty("trueFalseMaxRatio").GetDouble());
    }
}
