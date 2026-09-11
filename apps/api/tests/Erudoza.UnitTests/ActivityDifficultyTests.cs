using Erudoza.Application.Abstractions;
using Erudoza.Application.Mapping;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class ActivityDifficultyTests
{
    [Theory]
    [InlineData(1, 3)]
    [InlineData(3, 6)]
    [InlineData(5, 12)]
    public void Builder_chunks_get_smaller_with_difficulty(int difficulty, int count)
    {
        var result = VerseBuilderGenerator.Create(Unit(), 42, difficulty);
        result.Payload.Tokens.Should().HaveCount(count);
        result.Payload.Difficulty.Should().Be(difficulty);
    }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(3, 4)]
    [InlineData(5, 0)]
    public async Task Reference_provider_varies_choices_and_redacts_answer_metadata(int difficulty, int count)
    {
        var request = Request(difficulty);
        var card = await new ReferenceMatchActivityProvider(new Clock()).CreateAsync(request, default);
        var dto = DtoMapper.ToChallengeCardDto(card, request.SourceUnit, 8, exposeDebug: false);
        (dto.Choices?.Count ?? 0).Should().Be(count);
        dto.Citation.Should().Be("Assigned passage");
        dto.Prompt.Should().Be(request.SourceUnit.CanonicalText);
        card.AnswerMode.Should().Be(difficulty == 5 ? AnswerMode.ShortFact : AnswerMode.SelectedChoice);
    }

    [Fact]
    public async Task Restricted_simulation_and_single_passage_use_typed_reference()
    {
        var request = Request(1);
        var provider = new ReferenceMatchActivityProvider(new Clock());
        foreach (var restricted in new[] {
            request with { Context = request.Context with { Mode = StudyMode.Simulation } },
            request with { DistractorCitations = [] } })
        {
            provider.CanHandle(restricted).Should().BeTrue();
            var card = await provider.CreateAsync(restricted, default);
            card.AnswerMode.Should().Be(AnswerMode.ShortFact);
            ActivitySerialization.ReadPayload(card.PayloadJson).Choices.Should().BeNull();
        }
    }

    [Fact]
    public void Advanced_excludes_true_false()
    {
        new TrueFalseActivityProvider(new Clock()).CanHandle(Request(5)).Should().BeFalse();
    }

    [Fact]
    public async Task Next_verse_separates_prompt_answer_and_scoring_target()
    {
        var next = Unit();
        var target = Guid.NewGuid();
        var request = Request(1) with { NextSourceUnit = next, NextKnowledgeUnitId = target };
        var provider = new WhatComesNextActivityProvider(new Clock());
        var card = await provider.CreateAsync(request, default);
        card.SourceUnitId.Should().Be(request.SourceUnit.Id);
        card.AnswerSourceUnitId.Should().Be(next.Id);
        card.KnowledgeUnitId.Should().Be(target);
        ActivitySerialization.ReadAnswerKey(card.AnswerKeyJson).CanonicalAnswer.Should().Be("one two three four");
        var simulation = request with { Context = request.Context with { Mode = StudyMode.Simulation } };
        var simulatedCard = await provider.CreateAsync(simulation, default);
        ActivitySerialization.ReadAnswerKey(simulatedCard.AnswerKeyJson).CanonicalAnswer.Should().Be(next.CanonicalText);
    }

    [Fact]
    public void Missing_words_require_increasing_recall()
    {
        var counts = new[] { 1, 3, 5 }.Select(difficulty => MissingWordsGenerator.Create(Unit(), difficulty, 42).AnswerKey.HiddenWords.Count);
        counts.Should().Equal(1, 3, 11);
    }

    private static SourceUnit Unit() => new()
    {
        Id = Guid.NewGuid(),
        CitationLabel = "Daniel 1:1",
        CanonicalText = "one two three four five six seven eight nine ten eleven twelve"
    };

    private static ActivityRequest Request(int difficulty)
    {
        var unit = Unit();
        return new ActivityRequest(new StudyContext(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), StudyMode.Practice),
            new KnowledgeUnit { Id = Guid.NewGuid(), Kind = KnowledgeUnitKind.ExactVerseText }, unit,
            new RuleProfileSnapshot("test", 1, true, false, true, true), difficulty, 1,
            DistractorCitations: ["Daniel 1:2", "Daniel 1:3", "Daniel 1:4"]);
    }
    private sealed class Clock : IClock { public DateTimeOffset UtcNow => DateTimeOffset.UnixEpoch; }
}
