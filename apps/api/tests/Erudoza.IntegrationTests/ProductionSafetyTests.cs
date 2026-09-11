using Erudoza.Api.Operations;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting.Internal;
namespace Erudoza.IntegrationTests;

public sealed class ProductionSafetyTests
{
    private static Dictionary<string, string?> Safe() => new()
    {
        ["Seed:Enabled"] = "false",
        ["ExposeDebugAnswers"] = "false",
        ["PUBLIC_ORIGIN"] = "https://academy.example.test",
        ["DataProtection:KeyPath"] = "/persistent/keys",
        ["Database:ConnectionString"] = "Server=production;Database=erudoza"
    };
    [Theory]
    [InlineData("Seed:Enabled", "true")]
    [InlineData("ExposeDebugAnswers", "true")]
    [InlineData("PUBLIC_ORIGIN", "http://localhost:5173")]
    [InlineData("DataProtection:KeyPath", "")]
    [InlineData("Database:ConnectionString", "Data Source=erudoza.dev.db")]
    public void Unsafe_production_configuration_is_rejected(string key, string value)
    {
        var settings = Safe(); settings[key] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var action = () => ProductionSafety.Validate(config, new HostingEnvironment { EnvironmentName = "Production" });
        action.Should().Throw<InvalidOperationException>();
    }
    [Fact]
    public void Explicit_safe_production_configuration_is_accepted()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(Safe()).Build();
        ProductionSafety.Validate(config, new HostingEnvironment { EnvironmentName = "Production" });
    }
}
