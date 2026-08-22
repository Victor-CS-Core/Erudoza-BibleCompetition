using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class MissingWordsAndMasteryTests
{
    [Fact]
    public void Missing_words_preserve_visible_canonical_text_and_match_the_answer_key()
    {
        var unit = new SourceUnit
        {
            Id = Guid.NewGuid(),
            CitationLabel = "Daniel 1:8",
            CanonicalText = "Development sample: Daniel purposed in his heart that he would not defile himself."
        };

        var first = MissingWordsGenerator.Create(unit, 1, seed: 42);
        var second = MissingWordsGenerator.Create(unit, 1, seed: 42);
        first.PayloadJson.Should().Be(second.PayloadJson);
        first.Payload.Prompt.Should().Contain("____");
        foreach (var token in first.Payload.Tokens.Where(item => !item.Hidden))
        {
            first.Payload.Prompt.Should().Contain(token.Text);
        }

        first.AnswerKey.HiddenWords.Should().NotBeEmpty();
        string.Join(' ', first.Payload.Tokens.Select(item => item.Text)).Should().Be(unit.CanonicalText);
    }

    [Fact]
    public void Exact_text_normalization_ignores_case_but_not_substituted_words()
    {
        var correct = ExactTextEvaluator.Evaluate("  Defile Himself. ", "defile himself");
        correct.IsCorrect.Should().BeTrue();
        correct.EvaluatorVersion.Should().Be(ExactTextEvaluator.Version);

        var wrong = ExactTextEvaluator.Evaluate("defile themselves", "defile himself");
        wrong.IsCorrect.Should().BeFalse();
    }

    [Fact]
    public void Mastery_values_stay_bounded_and_incorrect_answers_schedule_review()
    {
        var current = new MasteryScores(0, 0, 0, 0, 0, MasteryLevel.Unseen);
        var afterWrong = ScaffoldMasteryRules.Apply(current, false, false, MissingWordsGenerator.ActivityType);
        afterWrong.ExactWording.Should().BeGreaterThanOrEqualTo(0);
        ScaffoldMasteryRules.NextReview(DateTimeOffset.Parse("2026-08-22T00:00:00Z"), false)
            .Should().Be(DateTimeOffset.Parse("2026-08-22T01:00:00Z"));

        var afterEasy = ScaffoldMasteryRules.Apply(current, true, true, "SelectedChoice");
        var afterExact = ScaffoldMasteryRules.Apply(current, true, false, MissingWordsGenerator.ActivityType);
        afterExact.ExactWording.Should().BeGreaterThan(afterEasy.ExactWording);
        afterExact.ExactWording.Should().BeLessThanOrEqualTo(100);
    }

    [Fact]
    public void Pbe_style_profile_rejects_multiple_choice_in_simulation()
    {
        var profile = new RuleProfile
        {
            Key = RuleProfileReader.PbeStyleV1,
            Version = 1,
            ConfigurationJson = RuleProfileReader.PbeStyleV1Json
        };
        var snapshot = RuleProfileReader.Read(profile);
        snapshot.AllowsActivity(StudyMode.Practice, "SelectedChoice", isMultipleChoice: true).Should().BeTrue();
        snapshot.AllowsActivity(StudyMode.Simulation, "SelectedChoice", isMultipleChoice: true).Should().BeFalse();
        snapshot.Version.Should().Be(1);
    }
}
