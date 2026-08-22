using Erudoza.Application.Generation;
using FluentAssertions;

namespace Erudoza.UnitTests;

public sealed class OpenAiSettingsTests
{
    [Fact]
    public void ResolveApiKey_prefers_the_configured_key()
    {
        OpenAiSettings.ResolveApiKey("configured", "environment").Should().Be("configured");
        OpenAiSettings.ResolveApiKey(" ", "environment").Should().Be("environment");
        OpenAiSettings.ResolveApiKey(null, null).Should().BeNull();
    }

    [Fact]
    public void CanGenerate_requires_the_enabled_flag_and_a_key()
    {
        OpenAiSettings.CanGenerate(true, "sk-test").Should().BeTrue();
        OpenAiSettings.CanGenerate(false, "sk-test").Should().BeFalse();
        OpenAiSettings.CanGenerate(true, " ").Should().BeFalse();
    }
}
