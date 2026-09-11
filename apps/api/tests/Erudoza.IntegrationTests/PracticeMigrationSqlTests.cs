using Erudoza.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Erudoza.IntegrationTests;

public sealed class PracticeMigrationSqlTests
{
    [Fact]
    public void Built_in_library_flag_uses_SQL_Server_bit_without_a_database_connection()
    {
        using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>()
            .UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=True;TrustServerCertificate=True").Options);
        var sql = db.GetService<IMigrator>().GenerateScript("20260910180946_PracticeAchievementEvidence", "20260910210819_BuiltInNkjvLibrary");
        Assert.Contains("[IsBuiltIn] bit NOT NULL", sql);
        Assert.DoesNotContain(" INTEGER", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Practice_migrations_generate_SQL_Server_types_and_indexable_keys_without_database_connection()
    {
        using var db = new ErudozaDbContext(new DbContextOptionsBuilder<ErudozaDbContext>()
            .UseSqlServer("Server=localhost;Database=ScriptOnly;Integrated Security=True;TrustServerCertificate=True")
            .Options);
        var sql = db.GetService<IMigrator>().GenerateScript(
            "20260910174412_SessionSecurityStamp", "20260910180946_PracticeAchievementEvidence");

        Assert.Contains("CREATE TABLE [PracticeRoomRecord]", sql);
        Assert.True(sql.Contains("[Id] uniqueidentifier NOT NULL", StringComparison.Ordinal), sql);
        Assert.Contains("[Revision] bigint NOT NULL", sql);
        Assert.Contains("[Enabled] bit NOT NULL", sql);
        Assert.Contains("[UpdatedAt] datetimeoffset NOT NULL", sql);
        Assert.Contains("[StateJson] nvarchar(max) NOT NULL", sql);
        Assert.Contains("[Key] nvarchar(64) NOT NULL", sql);
        Assert.Contains("PRIMARY KEY ([OrganizationId], [SeasonId], [UserId], [Key])", sql);
        Assert.DoesNotContain(" TEXT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(" INTEGER", sql, StringComparison.OrdinalIgnoreCase);
    }
}
