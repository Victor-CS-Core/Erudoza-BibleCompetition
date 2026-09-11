using Erudoza.Application.Competitions;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class LegacyRuleSnapshotTests
{
    [Fact]
    public void Older_snapshot_ignores_removed_preference_and_preserves_actual_restrictions()
    {
        var session = new StudySession { RuleProfileSnapshotJson = """
            {"Key":"historical","Version":7,"StudyAllowMultipleChoice":false,
             "SimulationAllowMultipleChoice":false,"SimulationAllowTrueFalse":false,
             "PreferShortAnswer":true,"ShowReference":false,"TrueFalseMaxRatio":0.05}
            """ };
        var snapshot = RuleProfileReader.ReadSession(session, new RuleProfile
        {
            Key = RuleProfileReader.PbeStyleV1,
            Version = 1,
            ConfigurationJson = RuleProfileReader.PbeStyleV1Json
        });
        snapshot.Key.Should().Be("historical");
        snapshot.Version.Should().Be(7);
        snapshot.StudyAllowMultipleChoice.Should().BeFalse();
        snapshot.SimulationAllowMultipleChoice.Should().BeFalse();
        snapshot.SimulationAllowTrueFalse.Should().BeFalse();
        snapshot.ShowReference.Should().BeFalse();
        snapshot.TrueFalseMaxRatio.Should().Be(0.05);
    }
}
