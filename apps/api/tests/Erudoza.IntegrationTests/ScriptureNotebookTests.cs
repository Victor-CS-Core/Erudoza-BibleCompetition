using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class ScriptureNotebookTests
{
    private static readonly Guid PackId = Guid.Parse("00000000-0000-5000-8000-000000000010");
    private static readonly Guid SourceId = Guid.Parse("00000000-0000-5000-8000-000000000011");
    private static readonly Guid OtherSourceId = Guid.Parse("00000000-0000-5000-8000-000000000012");
    private static string Root(Guid? org = null) => $"/api/v1/organizations/{org ?? SeedIdentifiers.OrganizationId}/library/notebook";
    private static object Note(object? note = null, Guid? pack = null, Guid? source = null, int chapter = 1, int start = 6, int end = 8, string kind = "note", string? color = null) => new
    {
        kind,
        contentPackId = pack ?? PackId,
        chapter,
        sourceUnitId = source ?? SourceId,
        startOffset = start,
        endOffset = end,
        color,
        note = kind == "note" ? note ?? " Remember this " : note
    };
    private static object Bookmark(Guid? pack = null, int chapter = 1) => new
    {
        kind = "bookmark",
        contentPackId = pack ?? PackId,
        chapter,
        sourceUnitId = (Guid?)null,
        startOffset = (int?)null,
        endOffset = (int?)null,
        color = (string?)null,
        note = (string?)null
    };
    private static Task<HttpResponseMessage> Put(HttpClient client, Guid id, long version, object? entry) =>
        client.PutAsJsonAsync($"{Root()}/entries/{id}", new { version, entry });

    [Fact]
    public async Task Notebook_reads_empty_and_round_trips_exact_private_utf16_anchors_without_training_writes()
    {
        using var factory = new ErudozaApiFactory();
        await SeedLibrary(factory);
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        using var anonymous = factory.CreateClient();
        var beforeTraining = await TrainingCount(factory);

        var empty = await coach.GetAsync(Root());
        empty.StatusCode.Should().Be(HttpStatusCode.OK);
        (await empty.Content.ReadFromJsonAsync<JsonElement>()).GetRawText().Should().Be("{\"version\":0,\"entries\":[]}");
        (await anonymous.GetAsync(Root())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await coach.GetAsync(Root(SeedIdentifiers.IsolationOrganizationId))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var id = Guid.Parse("00000000-0000-7000-8000-000000000001");
        var created = await Put(coach, id, 0, Note());
        created.StatusCode.Should().Be(HttpStatusCode.OK);
        var notebook = await created.Content.ReadFromJsonAsync<JsonElement>();
        notebook.GetProperty("version").GetInt64().Should().Be(1);
        var entry = notebook.GetProperty("entries").EnumerateArray().Single();
        entry.GetProperty("id").GetGuid().Should().Be(id);
        entry.GetProperty("bookName").GetString().Should().Be("Ephesians");
        entry.GetProperty("citation").GetString().Should().Be("Ephesians 1:1");
        entry.GetProperty("quote").GetString().Should().Be("😀");
        entry.GetProperty("note").GetString().Should().Be("Remember this");

        (await student.GetFromJsonAsync<JsonElement>(Root())).GetProperty("entries").GetArrayLength().Should().Be(0);
        var updated = await Put(coach, id, 1, Note("Edited thought"));
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt64().Should().Be(2);
        var deleted = await coach.DeleteAsync($"{Root()}/entries/{id}?version=2");
        deleted.StatusCode.Should().Be(HttpStatusCode.OK);
        var afterDelete = await deleted.Content.ReadFromJsonAsync<JsonElement>();
        afterDelete.GetProperty("version").GetInt64().Should().Be(3);
        afterDelete.GetProperty("entries").GetArrayLength().Should().Be(0);
        (await coach.GetFromJsonAsync<JsonElement>(Root())).GetProperty("version").GetInt64().Should().Be(3);
        (await TrainingCount(factory)).Should().Be(beforeTraining);
    }

    [Fact]
    public async Task Notebook_rejects_invalid_payloads_and_forged_or_unavailable_anchors()
    {
        using var factory = new ErudozaApiFactory();
        await SeedLibrary(factory);
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var bad = new object?[]
        {
            null,
            Note(kind: "unknown"),
            Note(kind: "Note"),
            Note(pack: SeedIdentifiers.ContentPackId),
            Note(pack: Guid.NewGuid()),
            Note(source: Guid.NewGuid()),
            new { kind = "note", contentPackId = PackId, chapter = 1, sourceUnitId = SourceId.ToString("N"), startOffset = 6, endOffset = 8, color = (string?)null, note = "Wrong UUID shape" },
            Note(chapter: 2),
            Note(start: -1),
            Note(start: 8, end: 6),
            Note(end: 999),
            Note(start: 5, end: 6),
            Note("   "),
            Note(new string('x', 2001)),
            Note(kind: "note", color: "Promises"),
            Note(null, kind: "highlight", color: "Unknown"),
            Note(null, kind: "highlight", color: "99"),
            Note(null, kind: "highlight", color: "Promises, People"),
            Note(null, kind: "highlight", color: null),
            new { kind = "bookmark", contentPackId = PackId, chapter = 1, sourceUnitId = SourceId, startOffset = (int?)null, endOffset = (int?)null, color = (string?)null, note = (string?)null },
        };
        (await Put(coach, Guid.Empty, 0, Note())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PutAsJsonAsync($"{Root()}/entries/{Guid.NewGuid():N}", new { version = 0, entry = Note() })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Put(coach, Guid.NewGuid(), 9007199254740992L, Note())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.DeleteAsync($"{Root()}/entries/{Guid.NewGuid()}?version=9007199254740992")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        foreach (var entry in bad)
            (await Put(coach, Guid.NewGuid(), 0, entry)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await coach.PutAsJsonAsync($"{Root()}/entries/not-a-uuid", new { version = 0, entry = Note() })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Put(coach, Guid.NewGuid(), -1, Note())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var oversized = new StringContent(JsonSerializer.Serialize(new { version = 0, entry = Note(new string('x', 17000)) }), Encoding.UTF8, "application/json");
        (await coach.PutAsync($"{Root()}/entries/{Guid.NewGuid()}", oversized)).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await coach.GetFromJsonAsync<JsonElement>(Root())).GetProperty("entries").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Notebook_rejects_stale_and_competing_initial_writes_and_upserts_semantic_duplicates()
    {
        using var factory = new ErudozaApiFactory();
        await SeedLibrary(factory);
        using var first = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var second = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var id = Guid.NewGuid();
        (await Put(first, id, 0, Note())).EnsureSuccessStatusCode();
        (await Put(second, Guid.NewGuid(), 0, Note(source: OtherSourceId, start: 0, end: 7))).StatusCode.Should().Be(HttpStatusCode.Conflict);

        await DeleteNotebook(factory);
        var competing = await Task.WhenAll(
            Put(first, Guid.NewGuid(), 0, Note()),
            Put(second, Guid.NewGuid(), 0, Note(source: OtherSourceId, start: 0, end: 7)));
        competing.Select(response => response.StatusCode).Order().Should().Equal(HttpStatusCode.OK, HttpStatusCode.Conflict);

        await DeleteNotebook(factory);
        var firstHighlight = Guid.NewGuid();
        (await Put(first, firstHighlight, 0, Note(null, kind: "highlight", color: "Promises"))).EnsureSuccessStatusCode();
        var replacementHighlight = Guid.NewGuid();
        var replaced = await Put(first, replacementHighlight, 1, Note(null, kind: "highlight", color: "People"));
        var notebook = await replaced.Content.ReadFromJsonAsync<JsonElement>();
        notebook.GetProperty("entries").GetArrayLength().Should().Be(1);
        notebook.GetProperty("entries")[0].GetProperty("id").GetGuid().Should().Be(replacementHighlight);
        var firstBookmark = Guid.NewGuid();
        (await Put(first, firstBookmark, 2, Bookmark())).EnsureSuccessStatusCode();
        var replacementBookmark = Guid.NewGuid();
        var bookmarked = await Put(first, replacementBookmark, 3, Bookmark());
        var bookmarks = (await bookmarked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray().Where(entry => entry.GetProperty("kind").GetString() == "bookmark").ToArray();
        bookmarks.Should().ContainSingle();
        bookmarks[0].GetProperty("id").GetGuid().Should().Be(replacementBookmark);
    }

    [Fact]
    public async Task Notebook_caps_new_entries_at_200_but_permits_editing_an_existing_entry()
    {
        using var factory = new ErudozaApiFactory();
        await SeedLibrary(factory);
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var entries = Enumerable.Range(0, 200).Select(index => new
        {
            id = Guid.NewGuid(),
            kind = "note",
            contentPackId = PackId,
            chapter = 1,
            sourceUnitId = SourceId,
            startOffset = 6,
            endOffset = 8,
            color = (string?)null,
            note = $"Capacity {index}",
            bookName = "Ephesians",
            citation = "Ephesians 1:1",
            quote = "😀",
            updatedAtUtc = DateTimeOffset.Parse("2026-09-13T00:00:00Z")
        }).ToArray();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            db.PbeTrainingRecords.Add(new PbeTrainingRecord
            {
                OrganizationId = SeedIdentifiers.OrganizationId,
                SeasonId = Guid.Empty,
                OwnerId = SeedIdentifiers.AdminUserId,
                Kind = "scripture-notebook",
                Id = SeedIdentifiers.AdminUserId.ToString(),
                Revision = 200,
                DataJson = JsonSerializer.Serialize(new { entries }, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            });
            await db.SaveChangesAsync();
        }
        (await Put(coach, Guid.NewGuid(), 200, Note("Over capacity"))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var edited = await Put(coach, entries[0].id, 200, Note("Allowed edit"));
        edited.StatusCode.Should().Be(HttpStatusCode.OK);
        (await edited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt64().Should().Be(201);
    }

    private static async Task SeedLibrary(ErudozaApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        db.Organizations.Add(new Organization { Id = BuiltInLibrary.OrganizationId, Name = "Test library", Slug = "test-library" });
        var pack = new ContentPack { Id = PackId, OrganizationId = BuiltInLibrary.OrganizationId, PackKey = "builtin-nkjv-eph", Version = 1, LicensingStatus = "approved", IsBuiltIn = true, IsActive = true };
        var document = new SourceDocument { Id = Guid.NewGuid(), ContentPackId = PackId, Name = "Ephesians", CanonicalBookKey = "EPH" };
        db.ContentPacks.Add(pack);
        db.SourceDocuments.Add(document);
        db.SourceUnits.AddRange(
            new SourceUnit { Id = SourceId, OrganizationId = BuiltInLibrary.OrganizationId, ContentPackId = PackId, SourceDocumentId = document.Id, BookKey = "EPH", Chapter = 1, Verse = 1, Ordinal = 1, CitationLabel = "Ephesians 1:1", CanonicalText = "Alpha 😀 beta gamma.", LicensingMetadata = "approved" },
            new SourceUnit { Id = OtherSourceId, OrganizationId = BuiltInLibrary.OrganizationId, ContentPackId = PackId, SourceDocumentId = document.Id, BookKey = "EPH", Chapter = 1, Verse = 2, Ordinal = 2, CitationLabel = "Ephesians 1:2", CanonicalText = "Another active verse.", LicensingMetadata = "approved" });
        await db.SaveChangesAsync();
    }

    private static async Task<long> TrainingCount(ErudozaApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        return await db.PbeTrainingRecords.LongCountAsync(record => record.Kind.StartsWith("pbe-"))
            + await db.StudySessions.LongCountAsync() + await db.Attempts.LongCountAsync() + await db.MasteryStates.LongCountAsync();
    }

    private static async Task DeleteNotebook(ErudozaApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        db.PbeTrainingRecords.RemoveRange(db.PbeTrainingRecords.Where(record => record.Kind == "scripture-notebook"));
        await db.SaveChangesAsync();
    }
}
