using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.IntegrationTests;

public sealed class MissingWordMigrationTests(ErudozaApiFactory factory) : IClassFixture<ErudozaApiFactory>
{
    [Fact]
    public void Additive_SQL_Server_script_uses_nullable_unbounded_unicode_payload()
    {
        using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=True;TrustServerCertificate=True").Options);
        var migrations = db.Database.GetMigrations().ToList();
        var index = migrations.FindIndex(m => m.EndsWith("MissingWordsSlotAnswers", StringComparison.Ordinal));
        Assert.True(index > 0);
        var sql = db.GetService<IMigrator>().GenerateScript(migrations[index - 1], migrations[index]);
        Assert.Contains("[AnswerPayloadJson] nvarchar(max) NULL", sql);
        Assert.DoesNotContain(" TEXT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE [Attempts]", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Populated_additive_upgrade_retains_legacy_answer_result_score_and_Honor_then_roundtrips_slots()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite(connection).Options);
        var migrations = db.Database.GetMigrations().ToList();
        var index = migrations.FindIndex(m => m.EndsWith("MissingWordsSlotAnswers", StringComparison.Ordinal));
        Assert.True(index > 0);
        await db.GetService<IMigrator>().MigrateAsync(migrations[index - 1]);
        using var services = factory.Services.CreateScope();
        await new DevelopmentSeeder(db, services.ServiceProvider.GetRequiredService<IPasswordHasher>(), services.ServiceProvider.GetRequiredService<IClock>())
            .SeedAsync("admin@erudoza.local", "DevAdmin!234", "daniel.student", "DevStudent!234", CancellationToken.None);
        var season = Guid.NewGuid(); var session = Guid.NewGuid(); var card = Guid.NewGuid(); var attempt = Guid.NewGuid(); var honor = Guid.NewGuid();
        var knowledge = await db.KnowledgeUnits.FirstAsync();
        db.Seasons.Add(new() { Id = season, OrganizationId = SeedIdentifiers.OrganizationId, Name = "Populated upgrade", RuleProfileId = SeedIdentifiers.RuleProfileId });
        db.StudySessions.Add(new() { Id = session, OrganizationId = SeedIdentifiers.OrganizationId, SeasonId = season, StudentUserId = SeedIdentifiers.StudentUserId });
        db.ChallengeCards.Add(new() { Id = card, OrganizationId = SeedIdentifiers.OrganizationId, SessionId = session, SeasonId = season, StudentUserId = SeedIdentifiers.StudentUserId, KnowledgeUnitId = knowledge.Id, SourceUnitId = knowledge.SourceUnitId, ActivityType = "MissingWords" });
        const string result = "{\"legacy\":true,\"isCorrect\":true,\"exactWordingScore\":70}";
        const string evidence = "{\"permanent\":true,\"score\":70}";
        db.MasteryHonorUnlocks.Add(new() { Id = honor, OrganizationId = SeedIdentifiers.OrganizationId, UserId = SeedIdentifiers.StudentUserId, SeasonId = season, Key = "permanent", RuleVersion = "mastery-v1", EvidenceJson = evidence });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO Attempts(Id, OrganizationId, SessionId, ChallengeCardId, StudentUserId, SeasonId, KnowledgeUnitId, ClientSubmissionId, SubmittedAnswer, NormalizedAnswer, IsCorrect, EvaluationResult, EvaluatorVersion, ResponseTimeMs, HintsUsed, ActivityType, CreatedAtUtc, IsLegacyDuplicate, ResultJson) VALUES({attempt}, {SeedIdentifiers.OrganizationId}, {session}, {card}, {SeedIdentifiers.StudentUserId}, {season}, {knowledge.Id}, {"legacy-key"}, {"in,  the"}, {"in the"}, 1, {"ExactMatch"}, {"exact-text-v1"}, 123, 0, {"MissingWords"}, {DateTimeOffset.UtcNow}, 0, {result})");
        await db.Database.MigrateAsync();
        await db.Database.MigrateAsync();
        var saved = await db.Attempts.AsNoTracking().SingleAsync();
        Assert.Null(saved.AnswerPayloadJson); Assert.Equal("in,  the", saved.SubmittedAnswer); Assert.Equal("legacy-key", saved.ClientSubmissionId);
        Assert.Equal(result, saved.ResultJson); Assert.True(saved.IsCorrect); Assert.Equal(123, saved.ResponseTimeMs);
        Assert.Equal(evidence, (await db.MasteryHonorUnlocks.AsNoTracking().SingleAsync()).EvidenceJson);
        var secondCard = Guid.NewGuid();
        db.ChallengeCards.Add(new() { Id = secondCard, OrganizationId = SeedIdentifiers.OrganizationId, SessionId = session, SeasonId = season, StudentUserId = SeedIdentifiers.StudentUserId, KnowledgeUnitId = knowledge.Id, SourceUnitId = knowledge.SourceUnitId, ActivityType = "MissingWords", Sequence = 1 });
        const string payload = """{"format":"missing-words-slots/v1","answers":[{"index":2,"text":" in "}],"results":[{"index":2,"isCorrect":true,"expected":"in"}]}""";
        db.Attempts.Add(new() { Id = Guid.NewGuid(), OrganizationId = SeedIdentifiers.OrganizationId, SessionId = session, ChallengeCardId = secondCard, SeasonId = season, StudentUserId = SeedIdentifiers.StudentUserId, KnowledgeUnitId = knowledge.Id, ClientSubmissionId = "slots", SubmittedAnswer = " in ", AnswerPayloadJson = payload, ResultJson = result, IsCorrect = true });
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        Assert.Equal(payload, (await db.Attempts.SingleAsync(a => a.ClientSubmissionId == "slots")).AnswerPayloadJson);
        Assert.Equal(2, await db.Attempts.CountAsync());
        Assert.Equal(1L, await db.Database.SqlQueryRaw<long>("SELECT COUNT(*) AS Value FROM pragma_table_info('Attempts') WHERE name='AnswerPayloadJson' AND [notnull]=0").SingleAsync());
        Assert.Empty(await db.Database.SqlQueryRaw<string>("SELECT CAST(rowid AS TEXT) AS Value FROM pragma_foreign_key_check").ToListAsync());
    }
}
