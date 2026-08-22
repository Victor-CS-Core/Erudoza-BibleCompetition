using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class DeterministicActivityTests
{
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
