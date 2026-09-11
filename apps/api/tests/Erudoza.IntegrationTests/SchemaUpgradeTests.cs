using Erudoza.Infrastructure.Persistence;
using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Erudoza.IntegrationTests;

public sealed class SchemaUpgradeTests
{
    [Fact]
    public async Task Upgrade_preserves_legacy_duplicates_and_backfills_valid_difficulty_without_history()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite(connection).Options);
        await db.GetService<IMigrator>().MigrateAsync("20260822035536_InitialCreate");
        await db.Database.ExecuteSqlRawAsync("DELETE FROM __EFMigrationsHistory; PRAGMA foreign_keys=OFF;");
        var card = Guid.NewGuid(); var session = Guid.NewGuid(); var student = Guid.NewGuid(); var org = Guid.NewGuid(); var season = Guid.NewGuid(); var knowledge = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO StudySessions (Id,OrganizationId,SeasonId,StudentUserId,Mode,Status,TargetCardCount,CreatedAtUtc) VALUES ({session},{org},{season},{student},0,0,8,{"2026-09-01"})");
        for (var i = 0; i < 2; i++)
        {
            var id = Guid.NewGuid(); var submission = $"legacy-{i}";
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO Attempts (Id,OrganizationId,SessionId,ChallengeCardId,StudentUserId,SeasonId,KnowledgeUnitId,ClientSubmissionId,SubmittedAnswer,NormalizedAnswer,IsCorrect,EvaluationResult,EvaluatorVersion,ResponseTimeMs,HintsUsed,ActivityType,CreatedAtUtc) VALUES ({id},{org},{session},{card},{student},{season},{knowledge},{submission},{"answer"},{"answer"},1,{"ExactMatch"},{"v1"},100,0,{"MissingWords"},{"2026-09-01"})");
        }
        await DatabaseSchemaUpgrade.ApplyAsync(db);
        await DatabaseSchemaUpgrade.ApplyAsync(db);
        var attempts = await db.Attempts.AsNoTracking().ToListAsync();
        attempts.Should().HaveCount(2);
        attempts.Count(item => item.IsLegacyDuplicate).Should().Be(1);
        (await db.StudySessions.SingleAsync()).Difficulty.Should().Be(Erudoza.Domain.TrainingDifficulty.Standard);
        (await db.Database.GetAppliedMigrationsAsync()).Should().HaveCount(db.Database.GetMigrations().Count());
        var duplicate = new Erudoza.Domain.Attempt { Id = Guid.NewGuid(), SessionId = session, ChallengeCardId = card, ClientSubmissionId = "new-duplicate" };
        db.Attempts.Add(duplicate);
        var save = () => db.SaveChangesAsync();
        await save.Should().ThrowAsync<DbUpdateException>();
    }

    [Fact]
    public async Task Fresh_database_records_current_schema_and_can_restart()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite(connection).Options);
        await DatabaseSchemaUpgrade.ApplyAsync(db);
        await DatabaseSchemaUpgrade.ApplyAsync(db);
        (await db.Database.GetPendingMigrationsAsync()).Should().BeEmpty();
        (await db.CompetitionMembers.CountAsync()).Should().Be(0);
    }
}
