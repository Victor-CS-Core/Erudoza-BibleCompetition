using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Erudoza.IntegrationTests;

public sealed class ErudozaApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"erudoza-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:Provider"] = "Sqlite",
                ["Database:ConnectionString"] = $"Data Source={_dbPath}",
                ["Database:ApplySchema"] = "false",
                ["Seed:Enabled"] = "false",
                ["OpenAI:Enabled"] = "false",
                ["OpenAI:ApiKey"] = "",
                ["ExposeDebugAnswers"] = "true"
            });
        });
        builder.ConfigureServices(services =>
        {
            foreach (var descriptor in services.Where(item =>
                         item.ServiceType == typeof(DbContextOptions<ErudozaDbContext>)
                         || item.ServiceType == typeof(ErudozaDbContext)).ToList())
            {
                services.Remove(descriptor);
            }

            services.AddDbContext<ErudozaDbContext>(options => options.UseSqlite($"Data Source={_dbPath}"));
            services.RemoveAll<IBibleTextClient>();
            services.AddSingleton<IBibleTextClient, FakeBibleTextClient>();
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        db.Database.EnsureDeleted();
        db.Database.EnsureCreated();
        scope.ServiceProvider.GetRequiredService<DevelopmentSeeder>()
            .SeedAsync(
                "admin@erudoza.local",
                "DevAdmin!234",
                "daniel.student",
                "DevStudent!234",
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();
        return host;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try
        {
            File.Delete(_dbPath);
        }
        catch (IOException)
        {
        }
    }
}

public static class TestHttp
{
    public static async Task<HttpClient> LoginAsync(ErudozaApiFactory factory, string identifier, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { identifier, password });
        response.EnsureSuccessStatusCode();
        return client;
    }
}
