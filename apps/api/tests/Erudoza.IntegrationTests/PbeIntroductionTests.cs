using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class PbeIntroductionTests
{
    private static object Input(string book, string license = "approved") => new { bookKey = book, sourceEdition = "Test edition", title = "Genesis introduction", citation = "Test introduction", licensingStatus = license, units = new[] { new { citation = "Test introduction §1", canonicalText = "The opening introduces Alpha and Beta." } } };
    [Fact]
    public async Task Coordinate_free_sources_are_reviewed_deliberately_assigned_and_revocable_without_rewriting_evidence()
    {
        using var factory = new ErudozaApiFactory { DisablePracticeTicker = true };
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var me = await coach.GetFromJsonAsync<JsonElement>("/api/v1/me"); var org = me.GetProperty("organizationId").GetGuid();
        var studentId = (await student.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetGuid();
        using var services = factory.Services.CreateScope(); var db = services.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var scripture = await db.SourceUnits.FirstAsync(s => s.OrganizationId == org);
        var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "pbe-intro", Version = 1 }; var season = new CompetitionSeason { Id = Guid.NewGuid(), OrganizationId = org, RuleProfileId = rule.Id, Status = SeasonStatus.Active, PbeEnabled = true };
        db.RuleProfiles.Add(rule); db.Seasons.Add(season); db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, SeasonId = season.Id, ContentPackId = scripture.ContentPackId, Kind = ScopeEntryKind.Include, BookKey = scripture.BookKey, StartChapter = scripture.Chapter, EndChapter = scripture.Chapter, StartVerse = scripture.Verse, EndVerse = scripture.Verse });
        db.CompetitionMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, SeasonId = season.Id, UserId = studentId }); await db.SaveChangesAsync();
        var path = $"/api/v1/organizations/{org}/practice/pbe/seasons/{season.Id}";
        var response = await coach.PostAsJsonAsync(path + "/introductions", Input(scripture.BookKey)); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var intro = await response.Content.ReadFromJsonAsync<JsonElement>(); var id = intro.GetProperty("id").GetGuid(); var unit = intro.GetProperty("units")[0].GetProperty("id").GetGuid();
        Assert.False(intro.GetProperty("reviewed").GetBoolean()); Assert.DoesNotContain("chapter", intro.GetRawText(), StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain("verse", intro.GetRawText(), StringComparison.OrdinalIgnoreCase);
        var tid = Guid.NewGuid(); var qid = Guid.NewGuid();
        var question = new { schemaVersion = 2, id = qid, version = 1, contentPackId = id, sourceUnitId = unit, sourceUnitIds = new[] { unit }, sourceKind = "Commentary", reference = "Test introduction §1", evidence = "Alpha and Beta", kind = "ShortAnswer", prompt = "Name the opening labels.", ordered = false, parts = new[] { new { targetId = tid, acceptedAnswers = new[] { "Alpha and Beta" }, points = 1 } } };
        var input = new { questions = new[] { question }, targets = new[] { new { id = tid, sourceUnitIds = new[] { unit }, skill = "FactualRecall", label = "Opening" } } };
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", input)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await coach.PostAsJsonAsync(path + $"/introductions/{id}/review", new { revision = 1, reviewed = true })).StatusCode);
        var wrong = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(input))!; wrong["questions"]![0]!["sourceKind"] = "Scripture";
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", wrong)).StatusCode);
        wrong["questions"]![0]!["sourceKind"] = "Commentary"; wrong["questions"]![0]!["evidence"] = "Invented";
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/questions/import", wrong)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await coach.PostAsJsonAsync(path + "/questions/import", input)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await coach.PostAsJsonAsync(path + $"/questions/{qid}/1/publish", new { })).StatusCode);
        Assert.Equal(0, (await student.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync(path + $"/introductions/{id}/reader")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync(path + "/introductions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await student.PostAsJsonAsync(path + "/introductions", Input(scripture.BookKey))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coach.GetAsync(path.Replace(org.ToString(), Guid.NewGuid().ToString()) + "/introductions")).StatusCode);
        var assign = new { revision = 2, studentIds = new[] { studentId, studentId } };
        response = await coach.PostAsJsonAsync(path + $"/introductions/{id}/assignments", assign); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(3, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("revision").GetInt32());
        // The identical lost-response retry may read current state but cannot add rows or advance revision.
        response = await coach.PostAsJsonAsync(path + $"/introductions/{id}/assignments", assign); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(3, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("revision").GetInt32());
        Assert.Single(await db.PbeTrainingRecords.Where(r => r.Kind == "pbe-introduction-assignment" && r.SeasonId == season.Id).ToListAsync());
        Assert.Equal(1, (await student.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        var read = await student.GetStringAsync(path + $"/introductions/{id}/reader"); Assert.Contains("Alpha and Beta", read); Assert.Contains("\"chapter\":null", read);
        var metadata = await student.GetStringAsync(path + "/bank"); Assert.DoesNotContain("Alpha", metadata); Assert.DoesNotContain("evidence", metadata);
        var saved = await db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-question" && r.SeasonId == season.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await coach.PostAsJsonAsync(path + $"/introductions/{id}/assignments", new { revision = 2, studentIds = Array.Empty<Guid>() })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await coach.PostAsJsonAsync(path + $"/introductions/{id}/assignments", new { revision = 3, studentIds = Array.Empty<Guid>() })).StatusCode);
        Assert.Equal(0, (await student.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        await coach.PostAsJsonAsync(path + $"/introductions/{id}/assignments", new { revision = 4, studentIds = new[] { studentId } });
        await db.CompetitionMembers.Where(m => m.SeasonId == season.Id).ExecuteDeleteAsync(); Assert.Equal(0, (await student.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await student.GetAsync(path + $"/introductions/{id}/reader")).StatusCode);
        await coach.PostAsJsonAsync(path + $"/introductions/{id}/review", new { revision = 5, reviewed = false }); Assert.Equal(0, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        await coach.PostAsJsonAsync(path + $"/introductions/{id}/review", new { revision = 6, reviewed = true });
        db.CompetitionMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, SeasonId = season.Id, UserId = studentId }); await db.SaveChangesAsync();
        await db.ScopeEntries.Where(s => s.SeasonId == season.Id).ExecuteDeleteAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + $"/introductions/{id}/assignments", new { revision = 7, studentIds = new[] { studentId } })).StatusCode);
        Assert.Equal(0, (await coach.GetFromJsonAsync<JsonElement>(path + "/bank")).GetProperty("questionCount").GetInt32());
        Assert.Equal(saved.DataJson, (await db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-question" && r.SeasonId == season.Id)).DataJson);
        Assert.False(await db.SourceUnits.AnyAsync(s => s.Id == unit)); Assert.False(await db.ContentPacks.AnyAsync(p => p.Id == id));
    }

    [Fact]
    public void Coordinate_free_source_proof_matches_native_Unicode_literal()
    {
        var id = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");
        var source = new PbeSourceUnit(id, Guid.NewGuid(), Erudoza.Domain.Practice.PbeSourceKind.Commentary, "GEN", null, null, 1, "Genesis introduction §1", "Café 🌿 Alpha");
        var q = new Erudoza.Domain.Practice.PbeQuestion { SourceUnitIds = [id], Reference = source.CitationLabel, Evidence = "Cafe\u0301\t🌿" };
        Assert.Equal("b9c48383c543f749c2121b078c7c060e69f7195aba369f4755390de0a5d97a2b", PbeQuestionBank.SourceProof(q, new Dictionary<Guid, PbeSourceUnit> { [id] = source }));
        q.Evidence = "Alpha Café"; Assert.Throws<DomainException>(() => PbeQuestionBank.SourceProof(q, new Dictionary<Guid, PbeSourceUnit> { [id] = source }));
    }
    [Fact]
    public async Task Preparation_rejects_bad_scope_license_coordinates_and_members_and_serializes_competing_writes()
    {
        using var fixture = await IntroFixture.Create(); var coach = fixture.Coach; var db = fixture.Db; var path = fixture.Path;
        foreach (var json in new[]
        {
            JsonSerializer.Serialize(Input("NOT-SELECTED")),
            JsonSerializer.Serialize(new { bookKey = fixture.Book, sourceEdition = "Edition", title = "Title", citation = "Citation", licensingStatus = "approved", units = new[] { new { citation = "Citation", canonicalText = "\ufeff" } } }),
            JsonSerializer.Serialize(new { bookKey = fixture.Book, sourceEdition = "Edition", title = "Title", citation = "Citation", licensingStatus = "approved", units = Array.Empty<object>() }),
            JsonSerializer.Serialize(new { bookKey = fixture.Book, sourceEdition = "Edition", title = "Title", citation = "Citation", licensingStatus = "approved", chapter = 1, units = new[] { new { citation = "Citation", canonicalText = "Text" } } }),
            JsonSerializer.Serialize(new { bookKey = fixture.Book, sourceEdition = "Edition", title = "Title", citation = "Citation", licensingStatus = "approved", units = new[] { new { citation = "Citation", canonicalText = "Text", verse = 1 } } }),
            JsonSerializer.Serialize(new { bookKey = fixture.Book, sourceEdition = "Edition", title = "Title", citation = "Citation", licensingStatus = "approved", units = new[] { new { citation = "Citation", canonicalText = new string('x', 10001) } } })
        }) Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + "/introductions", JsonDocument.Parse(json).RootElement)).StatusCode);
        var pending = await (await coach.PostAsJsonAsync(path + "/introductions", Input(fixture.Book, "pending"))).Content.ReadFromJsonAsync<JsonElement>();
        var pendingId = pending.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + $"/introductions/{pendingId}/review", new { revision = 1, reviewed = true })).StatusCode);
        foreach (var id in new[] { Guid.NewGuid(), fixture.User }) Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + $"/introductions/{fixture.Intro}/assignments", new { revision = 1, studentIds = new[] { id } })).StatusCode);
        var student = await db.Users.SingleAsync(u => u.Id == fixture.Student); student.IsActive = false; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + $"/introductions/{fixture.Intro}/assignments", new { revision = 1, studentIds = new[] { fixture.Student } })).StatusCode);
        student.IsActive = true; await db.SaveChangesAsync();
        var results = await Task.WhenAll(coach.PostAsJsonAsync(path + $"/introductions/{fixture.Intro}/review", new { revision = 1, reviewed = true }), coach.PostAsJsonAsync(path + $"/introductions/{fixture.Intro}/assignments", new { revision = 1, studentIds = new[] { fixture.Student } }));
        Assert.Equal(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, results.Select(r => r.StatusCode).Order().ToArray());
        var row = await db.PbeTrainingRecords.AsNoTracking().SingleAsync(r => r.Kind == "pbe-introduction" && r.Id == fixture.Intro.ToString()); Assert.Equal(2, row.Revision);
        Assert.Equal(results[1].StatusCode == HttpStatusCode.OK ? 1 : 0, await db.PbeTrainingRecords.CountAsync(r => r.Kind == "pbe-introduction-assignment" && r.SeasonId == fixture.Season));
        await db.CompetitionMembers.Where(m => m.SeasonId == fixture.Season).ExecuteDeleteAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await coach.PostAsJsonAsync(path + $"/introductions/{fixture.Intro}/assignments", new { revision = 2, studentIds = new[] { fixture.Student } })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await coach.PostAsJsonAsync(path + $"/introductions/{Guid.NewGuid()}/review", new { revision = 1, reviewed = true })).StatusCode);
    }
    [Theory]
    [InlineData("review")]
    [InlineData("assignment")]
    [InlineData("membership")]
    [InlineData("book")]
    [InlineData("license")]
    public async Task Private_resolution_detects_source_or_assignment_changes_during_load(string edit)
    {
        using var f = await IntroFixture.Create();
        (await f.Coach.PostAsJsonAsync(f.Path + $"/introductions/{f.Intro}/review", new { revision = 1, reviewed = true })).EnsureSuccessStatusCode();
        (await f.Coach.PostAsJsonAsync(f.Path + $"/introductions/{f.Intro}/assignments", new { revision = 2, studentIds = new[] { f.Student } })).EnsureSuccessStatusCode();
        var competition = f.Services.ServiceProvider.GetRequiredService<ICompetitionScopeResolver>();
        // The real legacy student resolver invokes competition too, so edit only in the outer resolver's second call.
        var calls = 0; var studentScopes = new EditingAssignments(f.Services.ServiceProvider.GetRequiredService<IStudentStudyScopeService>(), async () =>
        {
            if (++calls != 2) return;
            if (edit == "book") await f.Db.ScopeEntries.Where(r => r.SeasonId == f.Season).ExecuteDeleteAsync();
            else if (edit == "assignment") await f.Db.PbeTrainingRecords.Where(r => r.SeasonId == f.Season && r.Kind == "pbe-introduction-assignment").ExecuteDeleteAsync();
            else if (edit == "membership") await f.Db.CompetitionMembers.Where(m => m.SeasonId == f.Season).ExecuteDeleteAsync();
            else
            {
                var row = await f.Db.PbeTrainingRecords.SingleAsync(r => r.Kind == "pbe-introduction" && r.Id == f.Intro.ToString());
                var intro = JsonSerializer.Deserialize<PbeIntroduction>(row.DataJson, PbeQuestionBank.Json)!;
                row.DataJson = JsonSerializer.Serialize(edit == "review" ? intro with { Reviewed = false } : intro with { LicensingStatus = "pending" }, PbeQuestionBank.Json); row.Revision++; await f.Db.SaveChangesAsync();
            }
        });
        var bank = new PbeQuestionBank(f.Db, new CoachUser(f.User, f.Org), competition, studentScopes);
        await Assert.ThrowsAsync<PbeBankConflictException>(() => bank.LoadAsync(new(f.Org, f.Season, f.Student, [f.Unit])));
    }
    private sealed record CoachUser(Guid UserId, Guid OrganizationId) : ICurrentUser
    {
        public bool IsAuthenticated => true; public UserKind Kind => UserKind.Adult; public OrganizationRole Role => OrganizationRole.Admin; public string DisplayName => "Coach"; public bool IsAdmin => true; public bool IsStudent => false;
    }
    private sealed class EditingAssignments(IStudentStudyScopeService inner, Func<Task> edit) : IStudentStudyScopeService
    {
        public async Task<StudentStudyScope> GetAsync(Guid studentId, Guid seasonId, CancellationToken ct = default) { await edit(); return await inner.GetAsync(studentId, seasonId, ct); }
    }
    private sealed class IntroFixture : IDisposable
    {
        public ErudozaApiFactory Factory = null!; public HttpClient Coach = null!; public IServiceScope Services = null!; public ErudozaDbContext Db = null!;
        public Guid Org, User, Student, Season, Intro, Unit; public string Book = "", Path = "";
        public static async Task<IntroFixture> Create()
        {
            var f = new IntroFixture { Factory = new ErudozaApiFactory { DisablePracticeTicker = true } }; f.Coach = await TestHttp.LoginAsync(f.Factory, "admin@erudoza.local", "DevAdmin!234");
            var me = await f.Coach.GetFromJsonAsync<JsonElement>("/api/v1/me"); f.Org = me.GetProperty("organizationId").GetGuid(); f.User = me.GetProperty("userId").GetGuid();
            f.Services = f.Factory.Services.CreateScope(); f.Db = f.Services.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            f.Student = (await f.Db.Users.FirstAsync(u => u.Kind == UserKind.Student)).Id; var source = await f.Db.SourceUnits.FirstAsync(s => s.OrganizationId == f.Org); f.Book = source.BookKey;
            var rule = new RuleProfile { Id = Guid.NewGuid(), Key = "intro-fixture", Version = 1 }; f.Season = Guid.NewGuid(); f.Db.RuleProfiles.Add(rule); f.Db.Seasons.Add(new() { Id = f.Season, OrganizationId = f.Org, RuleProfileId = rule.Id, Status = SeasonStatus.Active, PbeEnabled = true });
            f.Db.ScopeEntries.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, ContentPackId = source.ContentPackId, Kind = ScopeEntryKind.Include, BookKey = source.BookKey, StartChapter = source.Chapter, EndChapter = source.Chapter, StartVerse = source.Verse, EndVerse = source.Verse });
            f.Db.CompetitionMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = f.Org, SeasonId = f.Season, UserId = f.Student }); await f.Db.SaveChangesAsync();
            f.Path = $"/api/v1/organizations/{f.Org}/practice/pbe/seasons/{f.Season}";
            var response = await f.Coach.PostAsJsonAsync(f.Path + "/introductions", Input(f.Book)); response.EnsureSuccessStatusCode(); var intro = await response.Content.ReadFromJsonAsync<JsonElement>(); f.Intro = intro.GetProperty("id").GetGuid(); f.Unit = intro.GetProperty("units")[0].GetProperty("id").GetGuid(); return f;
        }
        public void Dispose() { Services.Dispose(); Coach.Dispose(); Factory.Dispose(); }
    }
}
