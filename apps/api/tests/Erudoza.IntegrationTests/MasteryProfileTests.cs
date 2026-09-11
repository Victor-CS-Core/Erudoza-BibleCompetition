using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Application.Honors;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace Erudoza.IntegrationTests;

public sealed class MasteryProfileTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public async Task Profile_requires_owned_current_unlock_and_shared_identity_is_bounded_and_read_only()
    {
        var anon = factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/v1/profile/me")).StatusCode);
        var student = await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234");
        var org = SeedIdentifiers.OrganizationId; var user = SeedIdentifiers.StudentUserId; var foreignUser = Guid.NewGuid(); var foreignOrg = Guid.NewGuid();
        var key = "solo:exact-recall"; var proofCount = 0;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            db.SoloBadgeAwards.Add(new() { OrganizationId = org, StudentUserId = user, Key = "exact-recall", AwardScope = "legacy", EarnedAtUtc = DateTimeOffset.UtcNow, EvidenceJson = "{\"original\":true}" });
            db.Organizations.Add(new() { Id = foreignOrg, Slug = foreignOrg.ToString(), Name = "Other club" });
            db.Users.Add(new() { Id = foreignUser, UserName = foreignUser.ToString(), DisplayName = "Other person", IsActive = true });
            db.OrganizationMembers.Add(new() { Id = Guid.NewGuid(), OrganizationId = foreignOrg, UserId = foreignUser, Role = OrganizationRole.Student });
            db.MasteryHonorUnlocks.Add(new() { OrganizationId = foreignOrg, UserId = foreignUser, Key = key, EarnedAtUtc = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(); proofCount = await db.MasteryPassageProofs.CountAsync();
        }
        var before = await student.GetFromJsonAsync<UserHonorProfile>("/api/v1/profile/me");
        Assert.Equal(11, before!.Honors.Count); Assert.All(before.Honors, h => Assert.Null(h.EarnedAtUtc)); Assert.Null(before.AvatarHonorKey);
        foreach (var invalid in new[] { key, "exact-recall", "https://example.test/avatar.png", "unknown" })
            Assert.Equal(invalid == key ? HttpStatusCode.Forbidden : HttpStatusCode.BadRequest, (await student.PutAsJsonAsync("/api/v1/profile/me/avatar", new { honorKey = invalid })).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            Assert.Empty(await db.ProfileAvatarSelections.ToListAsync()); Assert.Equal(proofCount, await db.MasteryPassageProofs.CountAsync());
            var service = scope.ServiceProvider.GetRequiredService<MasteryHonorService>();
            var passages = Enumerable.Range(0, 12).Select(n => new HonorPassage(Guid.NewGuid(), "DAN", n + 1, 90, 0, 0, "v2-skill-evidence", null));
            await service.RecordAsync(org, user, Guid.NewGuid(), DateTimeOffset.UtcNow, MasteryHonorRules.Solo(passages), default);
            await db.SaveChangesAsync();
        }
        var saved = await student.PutAsJsonAsync("/api/v1/profile/me/avatar", new { honorKey = key }); saved.EnsureSuccessStatusCode();
        Assert.Equal(key, (await saved.Content.ReadFromJsonAsync<UserHonorProfile>())!.AvatarHonorKey);
        Assert.Equal(HttpStatusCode.BadRequest, (await student.PutAsJsonAsync("/api/v1/profile/me/avatar", new { })).StatusCode);
        Assert.True((await student.GetAsync("/api/v1/profile/me")).Headers.CacheControl!.NoStore);
        Assert.Equal(key, (await student.GetFromJsonAsync<UserHonorProfile>("/api/v1/profile/me"))!.AvatarHonorKey);
        var identities = await student.GetFromJsonAsync<PublicHonorIdentity[]>($"/api/v1/profile/identities?userId={user}&userId={user}&userId={foreignUser}");
        Assert.Single(identities!); Assert.Equal(key, identities![0].AvatarHonorKey);
        Assert.Equal(HttpStatusCode.BadRequest, (await student.GetAsync("/api/v1/profile/identities?userId=invalid")).StatusCode);
        Assert.Empty((await student.GetFromJsonAsync<PublicHonorIdentity[]>($"/api/v1/profile/identities?userId={Guid.Empty}"))!);
        Assert.Equal(HttpStatusCode.BadRequest, (await student.GetAsync("/api/v1/profile/identities?" + string.Join('&', Enumerable.Range(0, 51).Select(_ => "userId=" + Guid.NewGuid())))).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            var unlock = await db.MasteryHonorUnlocks.SingleAsync(x => x.OrganizationId == org && x.UserId == user);
            var selection = await db.ProfileAvatarSelections.SingleAsync(x => x.OrganizationId == org && x.UserId == user);
            Assert.Equal(unlock.Id, selection.UnlockId); Assert.Equal("mastery-v1", selection.RuleVersion);
            Assert.Equal("{\"original\":true}", (await db.SoloBadgeAwards.SingleAsync(x => x.AwardScope == "legacy")).EvidenceJson);
            var original = unlock.EvidenceJson; unlock.EvidenceJson = "changed";
            await Assert.ThrowsAsync<DomainException>(() => db.SaveChangesAsync()); db.Entry(unlock).State = EntityState.Detached;
            // No current mastery is required after an immutable unlock has been earned.
            foreach (var mastery in await db.MasteryStates.Where(x => x.StudentUserId == user).ToListAsync()) { mastery.ExactWordingScore = 0; mastery.ReferenceScore = 0; }
            await db.SaveChangesAsync();
            Assert.NotEqual("changed", original);
            var legacyUnlock = new MasteryHonorUnlock { OrganizationId = org, UserId = SeedIdentifiers.AdminUserId, Key = key, RuleVersion = "training-v1" };
            db.MasteryHonorUnlocks.Add(legacyUnlock);
            db.ProfileAvatarSelections.Add(new() { OrganizationId = org, UserId = SeedIdentifiers.AdminUserId, UnlockId = legacyUnlock.Id, HonorKey = key, RuleVersion = "training-v1" });
            await db.SaveChangesAsync();
        }
        Assert.Equal(key, (await student.GetFromJsonAsync<UserHonorProfile>("/api/v1/profile/me"))!.AvatarHonorKey);
        Assert.Null((await student.GetFromJsonAsync<PublicHonorIdentity[]>($"/api/v1/profile/identities?userId={SeedIdentifiers.AdminUserId}"))!.Single().AvatarHonorKey);
        var cleared = await student.PutAsJsonAsync("/api/v1/profile/me/avatar", new { honorKey = (string?)null }); cleared.EnsureSuccessStatusCode();
        Assert.Null((await cleared.Content.ReadFromJsonAsync<UserHonorProfile>())!.AvatarHonorKey);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Accepted_review_attempt_records_advanced_retention_and_only_first_correct_due_proof(bool wrongFirst)
    {
        var (student, season) = await Setup(); var org = SeedIdentifiers.OrganizationId; var user = SeedIdentifiers.StudentUserId;
        Guid knowledge;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>();
            knowledge = await db.KnowledgeUnits.Where(x => x.ContentPackId == SeedIdentifiers.ContentPackId && x.SourceUnit!.Verse == 1 && x.Kind == KnowledgeUnitKind.ExactVerseText).Select(x => x.Id).SingleAsync();
            db.MasteryStates.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, StudentUserId = user, SeasonId = season, KnowledgeUnitId = knowledge, ExactWordingScore = 100, ReferenceScore = 100, RecognitionScore = 100, AlgorithmVersion = "v2-skill-evidence", Level = MasteryLevel.Mastered });
            db.ReviewSchedules.Add(new() { Id = Guid.NewGuid(), OrganizationId = org, StudentUserId = user, SeasonId = season, KnowledgeUnitId = knowledge, DueAtUtc = DateTimeOffset.UtcNow.AddDays(-1) });
            db.MasteryPassageProofs.Add(new() { OrganizationId = org, UserId = user, SeasonId = season, KnowledgeUnitId = knowledge, FirstMasteredAtUtc = DateTimeOffset.UtcNow.AddHours(-49), FirstMasteredAttemptId = Guid.NewGuid() });
            await db.SaveChangesAsync();
        }
        var started = await student.PostAsJsonAsync("/api/v1/study/sessions", new { seasonId = season, mode = "Review" }); started.EnsureSuccessStatusCode();
        var session = (await started.Content.ReadFromJsonAsync<SessionDto>())!;
        for (var index = 0; index < 1; index++)
        {
            var next = await student.GetAsync($"/api/v1/study/sessions/{session.Id}/next"); next.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await next.Content.ReadAsStringAsync()); var cardId = json.RootElement.GetProperty("id").GetGuid(); var answer = json.RootElement.GetProperty("debugAnswer").GetString()!;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ErudozaDbContext>(); var card = await db.ChallengeCards.SingleAsync(x => x.Id == cardId);
                card.AnswerMode = AnswerMode.ExactText; card.ActivityType = "MissingWords";
                card.PayloadJson = ActivitySerialization.Payload(ActivitySerialization.ReadPayload(card.PayloadJson) with { Difficulty = 5 }); await db.SaveChangesAsync();
            }
            var submitted = await student.PostAsJsonAsync($"/api/v1/study/sessions/{session.Id}/attempts", new { challengeCardId = cardId, clientSubmissionId = Guid.NewGuid().ToString(), submittedAnswer = wrongFirst && index == 0 ? "wrong" : answer, responseTimeMs = 1500, hintsUsed = false }); submitted.EnsureSuccessStatusCode();
        }
        using var verify = factory.Services.CreateScope(); var context = verify.ServiceProvider.GetRequiredService<ErudozaDbContext>();
        var proof = await context.MasteryPassageProofs.SingleAsync(x => x.SeasonId == season);
        Assert.Equal(!wrongFirst, proof.RetainedAttemptId.HasValue); Assert.Equal(!wrongFirst, proof.ReviewedAttemptId.HasValue);
        Assert.Equal(!wrongFirst, proof.RetainedEvidenceJson is not null); Assert.Empty(await context.MasteryHonorUnlocks.Where(x => x.SeasonId == season).ToListAsync());
    }
    private async Task<(HttpClient Student, Guid Season)> Setup()
    {
        var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
        var created = await admin.PostAsJsonAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons", new { name = $"Mastery {Guid.NewGuid():N}", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" }); created.EnsureSuccessStatusCode();
        var season = (await created.Content.ReadFromJsonAsync<SeasonDto>())!;
        var root = $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons/{season.Id}";
        var range = new { bookKey = "DAN", startChapter = 1, startVerse = 1, endChapter = 1, endVerse = 1 };
        (await admin.PostAsJsonAsync(root + "/scope", new { contentPackId = SeedIdentifiers.ContentPackId, includes = new[] { range }, excludes = Array.Empty<object>() })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync(root + "/assignments", new { studentUserId = SeedIdentifiers.StudentUserId, type = "PrimarySpecialist", contentPackId = SeedIdentifiers.ContentPackId, range })).EnsureSuccessStatusCode();
        (await admin.PostAsync(root + "/activate", null)).EnsureSuccessStatusCode();
        return (await TestHttp.LoginAsync(factory, "daniel.student", "DevStudent!234"), season.Id);
    }
}
