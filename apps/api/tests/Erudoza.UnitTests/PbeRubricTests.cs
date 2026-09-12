using System.Text.Json;
using System.Text.Json.Serialization;
using Erudoza.Domain.Practice;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class PbeRubricTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    [Fact]
    public void Shared_hand_authored_fixtures_match_native_grades()
    {
        var fixtures = LoadFixtures();
        foreach (var fixture in fixtures.Cases)
        {
            PbeRubric.Validate(fixture.Question, fixtures.Targets);
            PbeRubric.Grade(fixture.Question, fixture.Answers).Should().BeEquivalentTo(fixture.Expected, options => options.WithStrictOrdering(), fixture.Name);
        }
    }

    [Fact]
    public void Validation_enforces_source_union_exact_skill_and_point_bounds()
    {
        var fixtures = LoadFixtures();
        var question = fixtures.Cases[0].Question;
        question.SourceUnitIds.Add(Guid.Parse("00000000-0000-0000-0000-000000000099"));
        var act = () => PbeRubric.Validate(question, fixtures.Targets);
        act.Should().Throw<ArgumentException>().WithMessage("*coverage*");

        question = fixtures.Cases[0].Question;
        question.Kind = PbeQuestionKind.ExactWords;
        act = () => PbeRubric.Validate(question, fixtures.Targets);
        act.Should().Throw<ArgumentException>().WithMessage("*exact-words targets*");

        question = fixtures.Cases[0].Question;
        question.Kind = PbeQuestionKind.List;
        question.SourceUnitIds = [fixtures.Targets[0].SourceUnitIds[0]];
        question.Parts = [new PbeQuestionPart { TargetId = fixtures.Targets[0].Id, AcceptedAnswers = ["Alpha"], Points = 8 }];
        PbeRubric.Validate(question, [fixtures.Targets[0]]);
        question.Parts[0].Points = 9;
        act = () => PbeRubric.Validate(question, [fixtures.Targets[0]]);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Malformed_runtime_fields_and_extra_answers_are_rejected()
    {
        var fixtures = LoadFixtures();
        var question = fixtures.Cases[0].Question;
        question.Extra = new() { ["unexpected"] = JsonDocument.Parse("true").RootElement.Clone() };
        var act = () => PbeRubric.Validate(question, fixtures.Targets);
        act.Should().Throw<ArgumentException>().WithMessage("Malformed*");

        question = fixtures.Cases[0].Question;
        act = () => PbeRubric.Grade(question, ["Shared", "Alpha", "extra"]);
        act.Should().Throw<ArgumentException>().WithMessage("*exactly one answer*");
    }

    [Fact]
    public void Guid_identity_membership_is_case_insensitive_at_json_boundaries()
    {
        const string json = """
            {"schemaVersion":2,"id":"00000000-0000-0000-0000-000000000031","version":1,"contentPackId":"00000000-0000-0000-0000-000000000041","sourceUnitId":"AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA","sourceUnitIds":["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],"sourceKind":"Scripture","reference":"Fixture","evidence":"Alpha","kind":"ShortAnswer","prompt":"Name it.","ordered":false,"parts":[{"targetId":"00000000-0000-0000-0000-000000000011","acceptedAnswers":["Alpha"],"points":1}]}
            """;
        var question = JsonSerializer.Deserialize<PbeQuestion>(json, JsonOptions)!;
        var target = new PbeTarget { Id = question.Parts[0].TargetId, SourceUnitIds = [Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")], Skill = RecallSkill.FactualRecall, Label = "Alpha" };
        var act = () => PbeRubric.Validate(question, [target]);
        act.Should().NotThrow();
    }

    [Fact]
    public void Missing_json_fields_are_rejected_before_default_enum_or_boolean_values_can_be_used()
    {
        const string missingSourceKind = """
            {"schemaVersion":2,"id":"00000000-0000-0000-0000-000000000031","version":1,"contentPackId":"00000000-0000-0000-0000-000000000041","sourceUnitId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","sourceUnitIds":["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],"reference":"Fixture","evidence":"Alpha","kind":"ShortAnswer","prompt":"Name it.","ordered":false,"parts":[{"targetId":"00000000-0000-0000-0000-000000000011","acceptedAnswers":["Alpha"],"points":1}]}
            """;
        var act = () => JsonSerializer.Deserialize<PbeQuestion>(missingSourceKind, JsonOptions);
        act.Should().Throw<JsonException>();
    }

    [Theory]
    [InlineData(1, 25)]
    [InlineData(8, 60)]
    public void Response_window_follows_question_points(int points, int expected) => PbeRules.ResponseSeconds(points).Should().Be(expected);

    [Fact]
    public void Response_window_rejects_points_outside_one_through_eight()
    {
        var zero = () => PbeRules.ResponseSeconds(0);
        var nine = () => PbeRules.ResponseSeconds(9);
        zero.Should().Throw<ArgumentOutOfRangeException>();
        nine.Should().Throw<ArgumentOutOfRangeException>();
    }

    private static FixtureRoot LoadFixtures()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "pbe", "rubric-fixtures.json");
        return JsonSerializer.Deserialize<FixtureRoot>(File.ReadAllText(path), JsonOptions)!;
    }

    private sealed class FixtureRoot
    {
        public List<PbeTarget> Targets { get; set; } = [];
        public List<FixtureCase> Cases { get; set; } = [];
    }
    private sealed class FixtureCase
    {
        public string Name { get; set; } = "";
        public PbeQuestion Question { get; set; } = new();
        public List<string> Answers { get; set; } = [];
        public PbeGrade Expected { get; set; } = new(0, 0, []);
    }
}
