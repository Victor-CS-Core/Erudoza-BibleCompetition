using System.Security.Cryptography;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Infrastructure.Content;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class LibraryInstallerTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Supplied_manifest_installs_all_31102_verses_with_global_ordinals_and_identical_ids()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "content", "nkjv", "library-manifest.json"))) root = root.Parent;
        root.Should().NotBeNull("the server-only library content ships with the repository");
        using var isolated = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var scope = isolated.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var installer = new BuiltInLibraryInstaller(db, scope.ServiceProvider.GetRequiredService<IStudyWriteCoordinator>());
        var manifest = Path.Combine(root!.FullName, "content", "nkjv", "library-manifest.json");
        await installer.InstallAsync(manifest);
        await installer.InstallAsync(manifest);
        (await db.ContentPacks.CountAsync(p => p.IsBuiltIn)).Should().Be(66);
        var source = await db.SourceUnits.Where(u => u.OrganizationId == BuiltInLibrary.OrganizationId).OrderBy(u => u.Ordinal).ToListAsync();
        source.Should().HaveCount(31102);
        source.Select(u => u.Ordinal).Should().Equal(Enumerable.Range(1, 31102));
        source.Select(u => u.Id).Should().Equal(source.Select(u => BuiltInLibrary.StableId($"verse:{u.BookKey}:{u.Chapter}:{u.Verse}")));
        var library = (await scope.ServiceProvider.GetRequiredService<Erudoza.Application.Content.LibraryReadService>().GetAsync(default))!;
        library.Books.Single(b => b.BookKey == "EPH").Chapters.Should().HaveCount(6);
        (await db.KnowledgeUnits.Where(k => k.OrganizationId == BuiltInLibrary.OrganizationId).Select(k => k.SourceUnitId == k.Id).AllAsync(same => same)).Should().BeTrue();
    }

    [Fact]
    public async Task Installation_is_global_idempotent_and_rejects_conflicting_text()
    {
        BuiltInLibrary.StableId("book:GEN").Should().Be(Guid.Parse("7b815dd7-2050-53ce-9ce9-014e020eb572"));
        var directory = Path.Combine(Path.GetTempPath(), "erudoza-library-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var manifest = await WriteFixture(directory, "Synthetic fixture text.");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var installer = new BuiltInLibraryInstaller(db, scope.ServiceProvider.GetRequiredService<IStudyWriteCoordinator>());
            await installer.InstallAsync(manifest);
            await installer.InstallAsync(manifest);
            (await db.ContentPacks.CountAsync(p => p.IsBuiltIn)).Should().Be(66);
            (await db.SourceUnits.CountAsync(p => p.OrganizationId == BuiltInLibrary.OrganizationId)).Should().Be(66);
            (await db.KnowledgeUnits.CountAsync(p => p.OrganizationId == BuiltInLibrary.OrganizationId)).Should().Be(66);
            (await db.ContentPacks.Where(p => p.IsBuiltIn).Select(p => p.LicensingStatus).Distinct().ToListAsync()).Should().Equal("approved");
            var changed = await WriteFixture(directory, "Changed synthetic fixture text.");
            var installChanged = () => installer.InstallAsync(changed);
            await installChanged.Should().ThrowAsync<DomainException>().WithMessage("*conflict*");
            (await db.SourceUnits.Where(p => p.OrganizationId == BuiltInLibrary.OrganizationId).Select(p => p.CanonicalText).Distinct().ToListAsync()).Should().Equal("Synthetic fixture text.");
            await File.WriteAllTextAsync(Path.Combine(directory, "GEN.json"), "{}");
            var corrupted = () => installer.InstallAsync(changed);
            await corrupted.Should().ThrowAsync<DomainException>().WithMessage("*checksum*");
        }
        finally { Directory.Delete(directory, true); }
    }

    private static async Task<string> WriteFixture(string directory, string text)
    {
        var books = new List<object>();
        foreach (var key in BuiltInLibrary.BookKeys)
        {
            var file = key + ".json";
            var request = new ImportContentPackRequest("builtin-nkjv-" + key.ToLowerInvariant(), 1, "en", "Scripture",
                [new ImportDocumentDto(key, [new ImportUnitDto(key + " 1:1", key, 1, 1, books.Count + 1, text)])], "supplied-private");
            var bytes = JsonSerializer.SerializeToUtf8Bytes(request, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await File.WriteAllBytesAsync(Path.Combine(directory, file), bytes);
            books.Add(new
            {
                contentPackId = BuiltInLibrary.StableId("book:" + key),
                bookKey = key,
                name = key,
                file,
                verseCount = 1,
                chapters = new[] { new { number = 1, verses = new[] { 1 } } },
                sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
            });
        }
        var manifest = Path.Combine(directory, "library-manifest.json");
        await File.WriteAllTextAsync(manifest, JsonSerializer.Serialize(new { schemaVersion = 1, translationId = "nkjv", translationName = "New King James Version", version = 1, sourcePdfSha256 = new string('a', 64), books }));
        return manifest;
    }
}
