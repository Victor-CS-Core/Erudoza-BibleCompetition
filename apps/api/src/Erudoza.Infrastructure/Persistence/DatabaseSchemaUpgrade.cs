using System.Data;
using System.Text.Json;
using Erudoza.Application.Competitions;
using Erudoza.Infrastructure.Persistence.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

namespace Erudoza.Infrastructure.Persistence;

public static class DatabaseSchemaUpgrade
{
    public static async Task ApplyAsync(ErudozaDbContext db, CancellationToken cancellationToken = default)
    {
        // Older installations used EnsureCreated and have no EF migration history.
        // Only baseline a database after verifying every initial table and column.
        if (await db.Database.EnsureCreatedAsync(cancellationToken))
        {
            await RecordHistoryAsync(db, db.Database.GetMigrations(), cancellationToken);
            return;
        }
        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToList();
        if (applied.Count == 0)
        {
            var connection = db.Database.GetDbConnection();
            await db.Database.OpenConnectionAsync(cancellationToken);
            try
            {
                foreach (var table in new InitialCreate().UpOperations.OfType<CreateTableOperation>())
                {
                    await using var command = connection.CreateCommand();
                    command.CommandText = db.Database.IsSqlite()
                        ? $"SELECT name FROM pragma_table_info('{table.Name}')"
                        : "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table";
                    if (!db.Database.IsSqlite())
                    {
                        var parameter = command.CreateParameter(); parameter.ParameterName = "@table"; parameter.Value = table.Name;
                        command.Parameters.Add(parameter);
                    }
                    var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken)) columns.Add(reader.GetString(0));
                    if (table.Columns.Any(column => !columns.Contains(column.Name)))
                        throw new InvalidOperationException($"Cannot upgrade database: table {table.Name} differs from the initial Erudoza schema. Restore a verified backup or reconcile the schema before retrying.");
                }
            }
            finally { await db.Database.CloseConnectionAsync(); }
            await RecordHistoryAsync(db, ["20260822035536_InitialCreate"], cancellationToken);
        }
        await db.Database.MigrateAsync(cancellationToken);
        // Original sessions did not retain rule snapshots. Freeze the upgrade-time
        // rules once, rather than allowing future coach edits to change resumed cards.
        var legacySessions = await db.StudySessions.Include(item => item.Season).ThenInclude(item => item!.RuleProfile)
            .Where(item => item.RuleProfileSnapshotJson == "" && item.Season != null && item.Season.RuleProfile != null)
            .ToListAsync(cancellationToken);
        foreach (var session in legacySessions)
        {
            session.RuleProfileSnapshotJson = JsonSerializer.Serialize(RuleProfileReader.Read(session.Season!.RuleProfile!));
            session.DifficultyPolicyVersion = "v1-legacy-upgrade";
        }
        if (legacySessions.Count > 0) await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task RecordHistoryAsync(ErudozaDbContext db, IEnumerable<string> migrations, CancellationToken cancellationToken)
    {
        var history = db.GetService<IHistoryRepository>();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript(), cancellationToken);
        foreach (var migration in migrations)
            await db.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(migration, "10.0.11")), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
