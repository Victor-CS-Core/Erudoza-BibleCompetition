using System.Net.Http.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Erudoza.IntegrationTests;

public sealed class ErudozaApiFactory : WebApplicationFactory<Program>
{
    public Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor? CommandInterceptor { get; set; }
    public bool DisablePracticeTicker { get; set; }
    public TimeProvider? TestTimeProvider { get; set; }
    private readonly string _dbPath;
    private readonly bool _existingDatabase;
    private IHost? _fixtureHost;

    public ErudozaApiFactory() => _dbPath = Path.Combine(Path.GetTempPath(), $"erudoza-{Guid.NewGuid():N}.db");

    // Only disposable, stopped integration-test backups may be supplied here.
    internal ErudozaApiFactory(string existingDatabasePath)
    {
        _dbPath = Path.GetFullPath(existingDatabasePath);
        if (!File.Exists(_dbPath)) throw new FileNotFoundException("The stopped fixture database must exist.", _dbPath);
        _existingDatabase = true;
    }

    internal string FixtureDatabasePath => _dbPath;

    internal Task StopFixtureHostAsync() => _fixtureHost?.StopAsync() ?? Task.CompletedTask;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureLogging(logging => logging.ClearProviders());
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:Provider"] = "Sqlite",
                ["Database:ConnectionString"] = $"Data Source={_dbPath}",
                ["Database:ApplySchema"] = "false",
                ["Seed:Enabled"] = "false",
                ["ExposeDebugAnswers"] = "true",
                ["RateLimiting:LoginPermitLimit"] = "1000"
            });
        });
        builder.ConfigureServices(services =>
        {
            services.AddDataProtection().UseEphemeralDataProtectionProvider();
            if (TestTimeProvider is not null)
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(TestTimeProvider);
            }
            if (DisablePracticeTicker)
                foreach (var descriptor in services.Where(item => item.ImplementationType == typeof(Erudoza.Api.Practice.PracticeTicker) || item.ImplementationType == typeof(Erudoza.Api.Practice.PbeSoloExpiryTicker)).ToList())
                    services.Remove(descriptor);
            foreach (var descriptor in services.Where(item =>
                         item.ServiceType == typeof(DbContextOptions<ErudozaDbContext>)
                         || item.ServiceType == typeof(ErudozaDbContext)).ToList())
            {
                services.Remove(descriptor);
            }

            services.AddDbContext<ErudozaDbContext>(options => { options.UseSqlite($"Data Source={_dbPath}"); if (CommandInterceptor is not null) options.AddInterceptors(CommandInterceptor); });
            services.RemoveAll<IBibleTextClient>();
            services.AddSingleton<IBibleTextClient, FakeBibleTextClient>();
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        _fixtureHost = host;
        if (_existingDatabase) return host;
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
            if (!_existingDatabase) File.Delete(_dbPath);
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
        ContentFixtures.Register(client, factory);
        return client;
    }
}
