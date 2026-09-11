using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Content;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

// Archived import regression tests exercise internal migration logic. Production HTTP routes remain retired.
internal static class ContentFixtures
{
    private static readonly ConditionalWeakTable<HttpClient, ErudozaApiFactory> Factories = new();
    public static void Register(HttpClient client, ErudozaApiFactory factory) => Factories.Add(client, factory);

    public static async Task<HttpResponseMessage> ImportFixtureAsync<T>(this HttpClient client, string uri, T request)
    {
        var factory = Factories.GetValue(client, _ => throw new InvalidOperationException("Use a fixture client."));
        using var scope = factory.Services.CreateScope();
        var organizationId = Guid.Parse(uri.Split('/')[4]);
        var json = JsonSerializer.Serialize(request, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        try
        {
            var pack = uri.EndsWith("import-from-catalog", StringComparison.Ordinal)
                ? await scope.ServiceProvider.GetRequiredService<ScriptureCatalogService>().ImportAsync(organizationId,
                    JsonSerializer.Deserialize<ImportScriptureCatalogRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!, default)
                : await scope.ServiceProvider.GetRequiredService<ContentImportService>().ImportAsync(organizationId,
                    JsonSerializer.Deserialize<ImportContentPackRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!, default);
            var count = await scope.ServiceProvider.GetRequiredService<ErudozaDbContext>().SourceUnits.CountAsync(u => u.ContentPackId == pack.Id);
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new ContentPackDto(pack.Id, pack.PackKey, pack.Version, pack.Locale, pack.SourceType.ToString(), pack.LicensingStatus, count)) };
        }
        catch (DomainException exception)
        {
            return new(HttpStatusCode.BadRequest) { Content = JsonContent.Create(new { detail = exception.Message }) };
        }
    }
}
