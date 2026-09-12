using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class DeterministicActivityTests
{
    [Fact]
    public void Versioned_long_verse_matches_the_common_native_seed_fixture()
    {
        var unit = Sample(string.Join(' ', Enumerable.Range(0, 47).Select(i => $"word{i}")));
        unit.Id = Guid.Parse("00112233-4455-6677-8899-aabbccddeeff");
        var seed = MissingWordsGenerator.StableSeed(unit.Id, Guid.Parse("ffeeddcc-bbaa-9988-7766-554433221100"), 1);
        seed.Should().Be(-1964792940);
        VerseBuilderGenerator.Create(unit, seed, 5, "memory-v3", "memory-cued-v3").Payload.Tokens.Select(t => int.Parse(t.Text.Split(' ')[0][4..])).Should().Equal(24, 4, 28, 16, 40, 20, 32, 44, 36, 8, 12, 0);
        MissingWordsGenerator.Create(unit, 5, seed, "memory-v3", "memory-cued-v3").Payload.Tokens.Where(t => t.Hidden).Select(t => t.Index).Should().Equal(1, 4, 5, 6, 7, 8, 9, 10, 11, 13, 16, 17, 19, 20, 21, 22, 23, 27, 28, 29, 30, 32, 33, 34, 37, 38, 39, 40, 41, 42, 44, 45, 46);
    }

    [Fact]
    public void Verse_builder_uses_phrase_chunks_and_is_repeatable()
    {
        var unit = Sample("Development sample: Daniel purposed in his heart that he would not defile himself.");
        var first = VerseBuilderGenerator.Create(unit, 17);
        var second = VerseBuilderGenerator.Create(unit, 17);
        first.Payload.Tokens.Select(item => item.Text).Should().Equal(second.Payload.Tokens.Select(item => item.Text));
        first.Payload.Tokens.Count.Should().BeGreaterThan(1);
        first.Payload.Tokens.All(item => item.Text.Contains(' ') || item.Text.Length > 0).Should().BeTrue();
        ActivitySerialization.ReadAnswerKey(first.AnswerKeyJson).CanonicalAnswer.Should().Be(unit.CanonicalText);
    }

    [Fact]
    public void Reference_match_answer_is_the_structured_citation()
    {
        var unit = Sample("Development sample: The official gave them new names for the season.");
        unit.CitationLabel = "Daniel 1:7";
        var generated = ReferenceMatchGenerator.Create(unit, ["Daniel 1:1", "Daniel 1:2"], seed: 3, allowChoices: true);
        generated.Payload.Choices.Should().Contain("Daniel 1:7");
        ActivitySerialization.ReadAnswerKey(generated.AnswerKeyJson).CanonicalAnswer.Should().Be("Daniel 1:7");
    }

    [Fact]
    public void Reference_match_in_simulation_is_typed_not_multiple_choice()
    {
        var unit = Sample("Development sample: The official gave them new names for the season.");
        unit.CitationLabel = "Daniel 1:7";
        var generated = ReferenceMatchGenerator.Create(unit, ["Daniel 1:1", "Daniel 1:2"], seed: 3, allowChoices: false);
        generated.Payload.Choices.Should().BeNull();
        ActivitySerialization.ReadAnswerKey(generated.AnswerKeyJson).CanonicalAnswer.Should().Be("Daniel 1:7");
    }

    [Fact]
    public void True_false_uses_only_stored_verse_wording()
    {
        var current = Sample("Development sample: First verse.");
        current.CitationLabel = "Daniel 1:1";
        var other = Sample("Development sample: Second verse.");
        other.CitationLabel = "Daniel 1:2";

        var truth = TrueFalseGenerator.Create(current, other, seed: 2);
        ActivitySerialization.ReadAnswerKey(truth.AnswerKeyJson).CanonicalAnswer.Should().Be("True");
        truth.Payload.Prompt.Should().Contain(current.CitationLabel);
        truth.Payload.Prompt.Should().Contain(current.CanonicalText);

        var falsehood = TrueFalseGenerator.Create(current, other, seed: 1);
        ActivitySerialization.ReadAnswerKey(falsehood.AnswerKeyJson).CanonicalAnswer.Should().Be("False");
        falsehood.Payload.Prompt.Should().Contain(other.CanonicalText);
        falsehood.Payload.Prompt.Should().NotContain("invented");
    }

    [Fact]
    public void What_comes_next_uses_the_following_stored_verse()
    {
        var current = Sample("Development sample: First verse.");
        current.CitationLabel = "Daniel 1:1";
        var next = Sample("Development sample: Second verse.");
        next.CitationLabel = "Daniel 1:2";
        var generated = WhatComesNextGenerator.Create(current, next);
        generated.Payload.Prompt.Should().Contain("Daniel 1:1");
        ActivitySerialization.ReadAnswerKey(generated.AnswerKeyJson).CanonicalAnswer.Should().Be(next.CanonicalText);
    }

    private static SourceUnit Sample(string text) =>
        new()
        {
            Id = Guid.NewGuid(),
            CanonicalText = text,
            CitationLabel = "Daniel 1:1",
            BookKey = "DAN",
            Chapter = 1,
            Verse = 1,
            Ordinal = 1
        };
}
