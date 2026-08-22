using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Domain;

namespace Erudoza.Application.Competitions;

public static class RuleProfileReader
{
    public const string PbeStyleV1 = "PBE_STYLE_V1";

    public static readonly string PbeStyleV1Json = """
        {
          "key": "PBE_STYLE_V1",
          "version": 1,
          "simulation": {
            "allowMultipleChoice": false,
            "allowTrueFalse": true,
            "trueFalseMaxRatio": 0.10,
            "preferShortAnswer": true,
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
            simulation.GetProperty("preferShortAnswer").GetBoolean(),
            simulation.GetProperty("showReference").GetBoolean());
    }
}
