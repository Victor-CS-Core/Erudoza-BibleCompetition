using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Api.Practice;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Competitions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Progress;
using Erudoza.Domain;
using Erudoza.Domain.Practice;
using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class InstalledLibraryTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    private static string Org(Guid? id = null) => $"/api/v1/organizations/{id ?? SeedIdentifiers.OrganizationId}";

    [Fact]
    public async Task Coaches_share_66_book_metadata_and_source_rows_without_private_tenant_leaks()
    {
        await SeedLibrary();
        using var first = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        using var second = await TestHttp.LoginAsync(factory, "orgb.admin@erudoza.local", "DevAdmin!234");
        var a = (await first.GetFromJsonAsync<LibraryDto>($"{Org()}/library"))!;
        var b = (await second.GetFromJsonAsync<LibraryDto>($"{Org(SeedIdentifiers.IsolationOrganizationId)}/library"))!;
        a.Books.Should().HaveCount(66);
        a.TranslationId.Should().Be("nkjv");
        b.Should().BeEquivalentTo(a);
        var eph = a.Books.Single(book => book.BookKey == "EPH");
        eph.Chapters.Select(c => c.Number).Should().Equal(1, 2, 3, 4, 5, 6);
        eph.Chapters[5].Verses.Should().Equal(1, 2, 3);
        var firstUnits = await first.GetFromJsonAsync<SourceUnitDto[]>($"{Org()}/content-packs/{eph.ContentPackId}/source-units");
        var secondUnits = await second.GetFromJsonAsync<SourceUnitDto[]>($"{Org(SeedIdentifiers.IsolationOrganizationId)}/content-packs/{eph.ContentPackId}/source-units");
        secondUnits.Should().BeEquivalentTo(firstUnits);
        (await second.GetFromJsonAsync<SourceUnitDto[]>($"{Org(SeedIdentifiers.IsolationOrganizationId)}/content-packs/{SeedIdentifiers.ContentPackId}/source-units"))!.Should().BeEmpty();
        (await first.DeleteAsync($"{Org()}/content-packs/{eph.ContentPackId}")).IsSuccessStatusCode.Should().BeFalse();
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        (await student.GetAsync($"{Org()}/library")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Theory]
    [InlineData("pack")]
    [InlineData("source")]
    [InlineData("document")]
    [InlineData("knowledge")]
    public async Task Installed_library_records_are_immutable_even_inside_application_services(string entity)
    {
        await SeedLibrary();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var packId = BuiltInLibrary.StableId("book:GEN");
        if (entity == "pack") (await db.ContentPacks.SingleAsync(p => p.Id == packId)).IsBuiltIn = false;
        if (entity == "source") (await db.SourceUnits.FirstAsync(p => p.ContentPackId == packId)).CanonicalText = "Changed";
        if (entity == "document") (await db.SourceDocuments.SingleAsync(p => p.ContentPackId == packId)).Name = "Changed";
        if (entity == "knowledge") db.KnowledgeUnits.Remove(await db.KnowledgeUnits.FirstAsync(p => p.ContentPackId == packId));
        var save = () => db.SaveChangesAsync();
        await save.Should().ThrowAsync<DomainException>().WithMessage("*immutable*");
    }

    [Fact]
    public async Task Multi_book_scope_drives_assignments_coverage_and_student_training_using_shared_rows()
    {
        await SeedLibrary();
        using var coach = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await coach.PostAsJsonAsync($"{Org()}/seasons", new { name = "Many books", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        var selections = new[] { new ScopePackDto(BuiltInLibrary.StableId("book:GEN"), [new("GEN", 1, 1, 1, 3)], []), new ScopePackDto(BuiltInLibrary.StableId("book:EPH"), [new("EPH", 6, 1, 6, 3)], []) };
        (await coach.PostAsJsonAsync($"{Org()}/seasons/{season.Id}/scope", new DefineScopeRequest(Packs: selections))).EnsureSuccessStatusCode();
        var saved = (await coach.GetFromJsonAsync<SeasonScopeDto>($"{Org()}/seasons/{season.Id}/scope"))!;
        saved.ContentPackId.Should().BeNull(); saved.Includes.Should().BeEmpty(); saved.Packs.Should().BeEquivalentTo(selections);
        foreach (var pack in selections)
        {
            var response = await coach.PostAsJsonAsync($"{Org()}/seasons/{season.Id}/assignments", new CreateAssignmentRequest(SeedIdentifiers.StudentUserId, AssignmentType.RequiredCoverage, pack.ContentPackId, pack.Includes[0]));
            response.EnsureSuccessStatusCode();
        }
        // Ephesians has exactly six stored chapters: a partially overlapping range cannot slip through.
        (await coach.PostAsJsonAsync($"{Org()}/seasons/{season.Id}/assignments", new CreateAssignmentRequest(SeedIdentifiers.StudentUserId, AssignmentType.RequiredCoverage, selections[1].ContentPackId, new("EPH", 6, 1, 7, 1))))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using (var serviceScope = factory.Services.CreateScope())
        {
            var db = serviceScope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            (await db.SourceUnits.CountAsync(u => u.OrganizationId == BuiltInLibrary.OrganizationId)).Should().Be(213);
            var coverage = await serviceScope.ServiceProvider.GetRequiredService<SeasonCoverageService>().GetAsync(SeedIdentifiers.OrganizationId, season.Id, default);
            coverage.Students.Single().EligibleUnitCount.Should().Be(6);
        }
        (await coach.PostAsync($"{Org()}/seasons/{season.Id}/activate", null)).EnsureSuccessStatusCode();
        using var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var sessionResponse = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season.Id, mode = "Practice" });
        sessionResponse.EnsureSuccessStatusCode();
        var session = (await sessionResponse.Content.ReadFromJsonAsync<SessionDto>())!;
        var card = (await student.GetFromJsonAsync<ChallengeCardDto>($"/api/v1/study/sessions/{session.Id}/next"))!;
        (await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new SubmitAttemptRequest(Guid.NewGuid().ToString(), card.Id, card.DebugAnswer!, 1000, false))).EnsureSuccessStatusCode();
        (await student.GetAsync($"/api/v1/study/seasons/{season.Id}/scripture")).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var progress = await scope.ServiceProvider.GetRequiredService<ProgressQueryService>().GetAsync(SeedIdentifiers.OrganizationId, SeedIdentifiers.StudentUserId, season.Id, default);
            progress.Mastery.Should().ContainSingle();
            progress.Mastery.Single().Title.Should().MatchRegex("^(GEN|EPH) ");
            progress.Assignments.Select(a => a.ContentPackId).Should().BeEquivalentTo(selections.Select(s => (Guid?)s.ContentPackId));
        }
        await VerifyTeamPractice(season.Id);
    }

    private async Task VerifyTeamPractice(Guid seasonId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var runtime = scope.ServiceProvider.GetRequiredService<PracticeRuntime>();
        var service = new PracticeService(db, runtime, scope.ServiceProvider.GetRequiredService<IConfiguration>());
        var org = SeedIdentifiers.OrganizationId;
        var coach = new PracticeActor(SeedIdentifiers.AdminUserId, org, "Coach", true);
        var owner = new PracticeActor(SeedIdentifiers.StudentUserId, org, "Student", false);
        var guestId = Guid.NewGuid();
        db.Users.Add(new ApplicationUser { Id = guestId, UserName = "library-pvp-" + guestId, DisplayName = "Opponent", Kind = UserKind.Student });
        db.OrganizationMembers.Add(new OrganizationMember { Id = Guid.NewGuid(), UserId = guestId, OrganizationId = org, Role = OrganizationRole.Student });
        await db.SaveChangesAsync();
        var guest = new PracticeActor(guestId, org, "Opponent", false);
        await service.SetEnabled(org, true, coach, default);
        var questions = Enumerable.Range(0, 10).Select(i => new PracticeQuestion
        {
            Id = Guid.NewGuid(),
            ContentPackId = BuiltInLibrary.StableId(i % 2 == 0 ? "book:GEN" : "book:EPH"),
            SourceUnitId = BuiltInLibrary.StableId(i % 2 == 0 ? "verse:GEN:1:1" : "verse:EPH:6:1"),
            Prompt = "Which fixture?",
            Evidence = "Synthetic fixture",
            Parts = [new AnswerPart { AcceptedAnswers = ["fixture"] }]
        }).ToList();
        await service.Import(org, coach, new ImportPracticeQuestions(seasonId, questions), default);
        foreach (var row in await db.Set<PracticeQuestionRecord>().Where(q => q.SeasonId == seasonId).ToListAsync())
            await service.Publish(org, row.Id, coach, default);
        var created = JsonSerializer.SerializeToElement(await service.Create(org, owner, new CreatePracticeRoom(seasonId, 1, 10, false, null), default), PracticeJson.Options);
        var id = created.GetProperty("id").GetGuid();
        async Task<PracticeRoom> State() => PracticeJson.Read<PracticeRoom>((await db.Set<PracticeRoomRecord>().SingleAsync(r => r.Id == id)).StateJson);
        async Task Send(PracticeActor actor, string action, Guid? target = null, int? team = null) =>
            await service.Command(org, id, actor, new PracticeCommand(Guid.NewGuid(), (await State()).Revision, action, target, team), runtime.Stamp(), default);
        await Send(owner, "invite", guestId, 2);
        await service.Accept(org, (await State()).Invitations.Single().Id, 2, guest, default);
        await Send(owner, "ready"); await Send(guest, "ready"); await Send(owner, "start");
        var playing = await State();
        playing.Status.Should().Be("Playing");
        playing.Questions.Select(q => q.ContentPackId).Distinct().Should().HaveCount(2);
    }

    private async Task SeedLibrary()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        if (await db.Organizations.AnyAsync(o => o.Id == BuiltInLibrary.OrganizationId)) return;
        db.Organizations.Add(new Organization { Id = BuiltInLibrary.OrganizationId, Name = "Test library", Slug = "test-nkjv", CreatedAtUtc = DateTimeOffset.UtcNow });
        foreach (var key in BuiltInLibrary.BookKeys)
        {
            var packId = BuiltInLibrary.StableId("book:" + key);
            var documentId = BuiltInLibrary.StableId("document:" + key);
            db.ContentPacks.Add(new ContentPack { Id = packId, OrganizationId = BuiltInLibrary.OrganizationId, PackKey = "builtin-nkjv-" + key.ToLowerInvariant(), Version = 1, LicensingStatus = "approved", IsBuiltIn = true });
            db.SourceDocuments.Add(new SourceDocument { Id = documentId, ContentPackId = packId, Name = key, CanonicalBookKey = key });
            for (var chapter = 1; chapter <= (key == "EPH" ? 6 : 1); chapter++)
                for (var verse = 1; verse <= 3; verse++)
                {
                    var id = BuiltInLibrary.StableId($"verse:{key}:{chapter}:{verse}");
                    db.SourceUnits.Add(new SourceUnit { Id = id, OrganizationId = BuiltInLibrary.OrganizationId, ContentPackId = packId, SourceDocumentId = documentId, BookKey = key, Chapter = chapter, Verse = verse, Ordinal = (chapter - 1) * 3 + verse, CitationLabel = $"{key} {chapter}:{verse}", CanonicalText = $"Synthetic fixture {key} chapter {chapter} verse {verse} only.", LicensingMetadata = "approved" });
                    db.KnowledgeUnits.Add(new KnowledgeUnit { Id = BuiltInLibrary.StableId($"knowledge:{key}:{chapter}:{verse}"), OrganizationId = BuiltInLibrary.OrganizationId, ContentPackId = packId, SourceUnitId = id, Title = $"{key} {chapter}:{verse}" });
                }
        }
        await db.SaveChangesAsync();
    }
}
