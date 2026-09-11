using System.Data;
using Erudoza.Application.Abstractions;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Infrastructure.Persistence;

public sealed class StudyWriteCoordinator(ErudozaDbContext db) : IStudyWriteCoordinator
{
    // Bounded striped locks avoid retaining a semaphore for every historical session.
    private static readonly SemaphoreSlim[] Gates = Enumerable.Range(0, 128).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    public async Task<T> ExecuteAsync<T>(Guid sessionId, Func<CancellationToken, Task<T>> action, CancellationToken cancellationToken)
    {
        var gate = Gates[(int)((uint)sessionId.GetHashCode() % (uint)Gates.Length)];
        await gate.WaitAsync(cancellationToken);
        try
        {
            for (var retry = 0; ; retry++)
            {
                try
                {
                    await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                    var result = await action(cancellationToken);
                    await db.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return result;
                }
                catch (Exception error) when (retry < 4 && IsRetryable(error))
                {
                    db.ChangeTracker.Clear();
                    await Task.Delay(25 * (retry + 1), cancellationToken);
                }
            }
        }
        finally { gate.Release(); }
    }

    private static bool IsRetryable(Exception error) => error switch
    {
        SqliteException sqlite => sqlite.SqliteErrorCode is 5 or 6 || sqlite.SqliteExtendedErrorCode is 2067 or 1555,
        SqlException sql => sql.Number is 1205 or 2601 or 2627,
        DbUpdateConcurrencyException => true,
        _ => error.InnerException is { } inner && IsRetryable(inner)
    };
}
