using Erudoza.Domain;
using Erudoza.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Erudoza.IntegrationTests;

public sealed class PbeMigrationTests
{
    [Fact]
    public void New_migration_generates_bounded_SQL_Server_types_without_a_database_connection()
    {
        using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=True;TrustServerCertificate=True").Options);
        var migrations = db.Database.GetMigrations().ToList(); var current = migrations.FindIndex(m => m.EndsWith("PbeTrainingRecords", StringComparison.Ordinal));
        var sql = db.GetService<IMigrator>().GenerateScript(migrations[current - 1], migrations[current]);
        Assert.Contains("[PbeEnabled] bit NOT NULL", sql); Assert.Contains("[Kind] nvarchar(100) NOT NULL", sql); Assert.Contains("[Id] nvarchar(200) NOT NULL", sql); Assert.Contains("[Revision] bigint NOT NULL", sql);
        Assert.DoesNotContain(" TEXT", sql, StringComparison.OrdinalIgnoreCase); Assert.DoesNotContain(" INTEGER", sql, StringComparison.OrdinalIgnoreCase);
    }
    [Fact]
    public async Task Additive_upgrade_preserves_old_match_and_permanent_honor_bytes()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>().UseSqlite(connection).Options);
        var previous = db.Database.GetMigrations().Last(id => !id.EndsWith("PbeTrainingRecords", StringComparison.Ordinal));
        await db.GetService<IMigrator>().MigrateAsync(previous);
        var org = Guid.NewGuid(); var season = Guid.NewGuid(); var user = Guid.NewGuid(); var room = Guid.NewGuid(); var honor = Guid.NewGuid();
        const string legacy = "{\"legacyScore\":9,\"answers\":[\"old\"]}", evidence = "{\"retained\":true}";
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO PracticeRoomRecord(Id,OrganizationId,SeasonId,Status,Revision,StateJson,UpdatedAt) VALUES({room},{org},{season},{"Completed"},7,{legacy},{DateTimeOffset.UtcNow})");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO MasteryHonorUnlocks(Id,OrganizationId,UserId,Key,RuleVersion,SeasonId,EarnedAtUtc,EvidenceJson) VALUES({honor},{org},{user},{"permanent"},{"mastery-v1"},{season},{DateTimeOffset.UtcNow},{evidence})");
        await db.Database.MigrateAsync(); await db.Database.MigrateAsync();
        Assert.Equal(legacy, await db.Database.SqlQuery<string>($"SELECT StateJson AS Value FROM PracticeRoomRecord WHERE Id={room}").SingleAsync());
        Assert.Equal(evidence, (await db.MasteryHonorUnlocks.AsNoTracking().SingleAsync()).EvidenceJson);
        db.PbeTrainingRecords.Add(new() { OrganizationId = org, SeasonId = season, Kind = "pbe-target", Id = "target", DataJson = "{}" }); await db.SaveChangesAsync();
        Assert.Equal(1, await db.PbeTrainingRecords.CountAsync());
        Assert.Contains(db.Database.GetAppliedMigrations(), m => m.EndsWith("PbeTrainingRecords", StringComparison.Ordinal));
    }
}
