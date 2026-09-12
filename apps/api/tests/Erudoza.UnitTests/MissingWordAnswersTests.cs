using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class MissingWordAnswersTests
{
    [Fact]
    public void Evaluates_correct_answers_in_saved_token_order()
    {
        var tokens = Tokens(
            new("shown", false, 1),
            new("in", true, 8),
            new("the", true, 4));

        var evaluation = MissingWordAnswers.Evaluate(tokens,
        [
            new(4, " THE "),
            new(8, "In")
        ]);

        evaluation.Should().BeEquivalentTo(new MissingWordEvaluation(true,
        [
            new(8, true, "in"),
            new(4, true, "the")
        ]), options => options.WithStrictOrdering());
    }

    [Fact]
    public void Does_not_move_words_across_an_empty_blank()
    {
        var evaluation = MissingWordAnswers.Evaluate(
            Tokens(new("in", true, 2), new("the", true, 3)),
            [new(2, "in the"), new(3, "")]);

        evaluation.IsCorrect.Should().BeFalse();
        evaluation.Results.Should().Equal(
            new MissingWordResult(2, false, "in"),
            new MissingWordResult(3, false, "the"));
    }

    [Fact]
    public void Keeps_empty_middle_swapped_and_repeated_slots_positional()
    {
        var middle = MissingWordAnswers.Evaluate(
            Tokens(new("alpha", true, 2), new("beta", true, 3), new("gamma", true, 4)),
            [new(2, "alpha"), new(3, ""), new(4, "beta gamma")]);
        middle.Results.Should().Equal(
            new MissingWordResult(2, true, "alpha"),
            new MissingWordResult(3, false, "beta"),
            new MissingWordResult(4, false, "gamma"));

        MissingWordAnswers.Evaluate(
            Tokens(new("alpha", true, 2), new("beta", true, 3)),
            [new(2, "beta"), new(3, "alpha")]).IsCorrect.Should().BeFalse();

        var repeated = MissingWordAnswers.Evaluate(
            Tokens(new("again", true, 8), new("then", true, 4), new("again", true, 9)),
            [new(9, "again"), new(8, "again"), new(4, "again")]);
        repeated.Results.Should().Equal(
            new MissingWordResult(8, true, "again"),
            new MissingWordResult(4, false, "then"),
            new MissingWordResult(9, true, "again"));
    }

    [Fact]
    public void Uses_existing_normalization_per_slot_without_comma_splitting()
    {
        var tokens = Tokens(
            new("“Word,”", true, 2),
            new("king's", true, 3),
            new("one,two", true, 4),
            new("well-being", true, 5),
            new("two\twords", true, 6));

        MissingWordAnswers.Evaluate(tokens,
        [
            new(2, " word "), new(3, "KINGS"), new(4, "onetwo"),
            new(5, "WELL-BEING"), new(6, " two   words ")
        ]).IsCorrect.Should().BeTrue();

        MissingWordAnswers.Evaluate(tokens,
        [
            new(2, "word"), new(3, "kings"), new(4, "one, two"),
            new(5, "well being"), new(6, "two words")
        ]).IsCorrect.Should().BeFalse();
    }

    [Fact]
    public void Requires_exact_nonempty_trimmed_text_for_punctuation_only_tokens()
    {
        var tokens = Tokens(new MissingWordsToken("“”", true, 7));

        MissingWordAnswers.Evaluate(tokens, [new(7, "")]).IsCorrect.Should().BeFalse();
        MissingWordAnswers.Evaluate(tokens, [new(7, "  “ ”  ")]).IsCorrect.Should().BeFalse();
        MissingWordAnswers.Evaluate(tokens, [new(7, "  “”  ")]).IsCorrect.Should().BeTrue();
    }

    public static TheoryData<IReadOnlyList<MissingWordAnswer>> InvalidAnswers => new()
    {
        { new MissingWordAnswer[] { new(2, "in"), new(2, "the") } },
        { new MissingWordAnswer[] { new(2, "in"), new(99, "the") } },
        { new MissingWordAnswer[] { new(1, "shown"), new(2, "in"), new(3, "the") } },
        { new MissingWordAnswer[] { new(2, "in") } },
        { new MissingWordAnswer[] { new(2, null!), new(3, "the") } }
    };

    [Theory]
    [MemberData(nameof(InvalidAnswers))]
    public void Rejects_invalid_answer_sets(IReadOnlyList<MissingWordAnswer> answers)
    {
        var act = () => MissingWordAnswers.Evaluate(
            Tokens(
                new MissingWordsToken("shown", false, 1),
                new MissingWordsToken("in", true, 2),
                new MissingWordsToken("the", true, 3)),
            answers);

        act.Should().Throw<DomainException>().WithMessage("Invalid missing-word answers.");
    }

    private static IReadOnlyList<MissingWordsToken> Tokens(params MissingWordsToken[] tokens) => tokens;
}
