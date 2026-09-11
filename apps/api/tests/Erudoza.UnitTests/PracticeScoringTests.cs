using Erudoza.Domain.Practice;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class PracticeScoringTests
{
    [Theory]
    [InlineData(1, 25, 5000, 100, 20)]
    [InlineData(1, 25, 5001, 100, 19)]
    [InlineData(1, 25, 15000, 100, 10)]
    [InlineData(1, 25, 25000, 100, 0)]
    [InlineData(1, 25, 25001, 0, 0)]
    [InlineData(0, 25, 5000, 0, 0)]
    [InlineData(2, 35, 1000, 200, 48)]
    public void Scores_only_correct_points_with_ceiling_seconds_and_floor_hundredths(int points, int seconds, int milliseconds, int accuracy, int speed)
    {
        var score = PvpScoring.Score(points, seconds, TimeSpan.FromMilliseconds(milliseconds));
        score.AccuracyHundredths.Should().Be(accuracy);
        score.SpeedHundredths.Should().Be(speed);
        score.TotalHundredths.Should().Be(accuracy + speed);
    }

    [Fact]
    public void Deadline_draft_never_receives_a_speed_bonus() =>
        PvpScoring.Score(2, 30, TimeSpan.FromSeconds(3), true).Should().Be(new ScoreBreakdown(200, 0));

    [Theory]
    [InlineData(-1, 25, 0)]
    [InlineData(1, 0, 0)]
    [InlineData(1, 25, -1)]
    public void Invalid_scoring_inputs_are_rejected(int points, int seconds, int milliseconds)
    {
        var act = () => PvpScoring.Score(points, seconds, TimeSpan.FromMilliseconds(milliseconds));
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Unordered_parts_match_variants_without_duplicate_credit()
    {
        var question = Question(false, new AnswerPart { AcceptedAnswers = ["Peter", "Simon Peter"] }, new AnswerPart { AcceptedAnswers = ["John"] });
        PbeQuestionEvaluator.Evaluate(question, [" john ", "SIMON   PETER"]).Should().Be(2);
        PbeQuestionEvaluator.Evaluate(question, ["Peter", "Peter"]).Should().Be(1);
    }

    [Fact]
    public void Overlapping_variants_use_best_one_to_one_assignment()
    {
        var question = Question(false, new AnswerPart { AcceptedAnswers = ["Peter", "Simon"] }, new AnswerPart { AcceptedAnswers = ["Peter"], Points = 2 });
        PbeQuestionEvaluator.Evaluate(question, ["Peter", "Simon"]).Should().Be(3);
        PbeQuestionEvaluator.Evaluate(question, ["Peter"]).Should().Be(2);
    }

    [Fact]
    public void Ordered_parts_and_exact_words_do_not_ignore_word_order_or_missing_words()
    {
        var question = Question(true, new AnswerPart { AcceptedAnswers = ["Peter"] }, new AnswerPart { AcceptedAnswers = ["John"] });
        PbeQuestionEvaluator.Evaluate(question, ["John", "Peter"]).Should().Be(0);
        question.Kind = "ExactWords";
        question.Parts = [new AnswerPart { AcceptedAnswers = ["In the beginning"] }];
        PbeQuestionEvaluator.Evaluate(question, ["in beginning"]).Should().Be(0);
        PbeQuestionEvaluator.Evaluate(question, ["Beginning in the"]).Should().Be(0);
    }

    [Fact]
    public void Invalid_or_unsupported_question_definitions_are_rejected()
    {
        var question = Question(false, new AnswerPart { AcceptedAnswers = ["Peter"] });
        question.Kind = "MultipleChoice";
        var act = () => PbeQuestionEvaluator.Validate(question);
        act.Should().Throw<ArgumentException>();
        question.Kind = "ShortAnswer";
        question.Parts[0].AcceptedAnswers = [" "];
        act.Should().Throw<ArgumentException>();
    }

    private static PracticeQuestion Question(bool ordered, params AnswerPart[] parts) => new()
    {
        Id = Guid.NewGuid(),
        ContentPackId = Guid.NewGuid(),
        SourceUnitId = Guid.NewGuid(),
        Prompt = "Name the disciples",
        Evidence = "Peter and John",
        Reference = "Acts 3:1",
        Version = 1,
        Kind = "List",
        Ordered = ordered,
        Parts = [.. parts]
    };
}
