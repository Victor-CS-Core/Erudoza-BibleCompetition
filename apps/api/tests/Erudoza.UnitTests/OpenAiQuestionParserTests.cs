using Erudoza.Application.Generation;
using Erudoza.Domain;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class OpenAiQuestionParserTests
{
    [Fact]
    public void Parser_reads_a_valid_chat_completion_and_keeps_provided_evidence()
    {
        var unit = new SourceUnit
        {
            Id = Guid.Parse("55555555-5555-5555-5555-555555555555"),
            CanonicalText = "Development sample: Daniel purposed in his heart.",
            CitationLabel = "Daniel 1:8"
        };
        var json = """
            {
              "choices": [
                {
                  "message": {
                    "content": "{\"prompt\":\"Who purposed in his heart?\",\"canonicalAnswer\":\"Daniel\",\"acceptedAnswers\":[\"Daniel\"],\"sourceUnitId\":\"55555555-5555-5555-5555-555555555555\",\"evidenceText\":\"Development sample: Daniel purposed in his heart.\"}"
                  }
                }
              ]
            }
            """;

        var parsed = OpenAiQuestionParser.TryParse(json, [unit]);
        parsed.Should().NotBeNull();
        parsed!.Prompt.Should().Contain("purposed");
        parsed.CanonicalAnswer.Should().Be("Daniel");
        parsed.SourceEvidence.Should().ContainSingle(item => item.SourceUnitId == unit.Id && item.EvidenceText == unit.CanonicalText);
        parsed.GeneratorVersion.Should().Be("openai-chat-v1");
    }

    [Fact]
    public void Parser_returns_null_when_evidence_or_prompt_is_missing()
    {
        var unit = new SourceUnit { Id = Guid.NewGuid(), CanonicalText = "Development sample." };
        var json = """
            {
              "choices": [
                { "message": { "content": "{\"prompt\":\"Who?\",\"canonicalAnswer\":\"Daniel\"}" } }
              ]
            }
            """;

        OpenAiQuestionParser.TryParse(json, [unit]).Should().BeNull();
        OpenAiQuestionParser.TryParse("not-json", [unit]).Should().BeNull();
        OpenAiQuestionParser.TryParse("{}", [unit]).Should().BeNull();
    }
}
