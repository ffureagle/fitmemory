using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace FitMemory.Api.Data;

/// <summary>
/// SQLite does not enable foreign keys or WAL by default. Each opened
/// connection sets them so concurrent mobile requests wait instead of
/// failing with "database is locked", and cascades are enforced.
/// </summary>
public sealed class SqliteSessionPragmasInterceptor : DbConnectionInterceptor
{
    private static readonly string[] Statements =
    [
        "PRAGMA journal_mode=WAL;",
        "PRAGMA busy_timeout=30000;",
        "PRAGMA foreign_keys=ON;",
        "PRAGMA synchronous=NORMAL;"
    ];

    public override void ConnectionOpened(
        DbConnection connection,
        ConnectionEndEventData eventData)
    {
        Apply(connection);
        base.ConnectionOpened(connection, eventData);
    }

    public override async Task ConnectionOpenedAsync(
        DbConnection connection,
        ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        await ApplyAsync(connection, cancellationToken);
        await base.ConnectionOpenedAsync(connection, eventData, cancellationToken);
    }

    private static void Apply(DbConnection connection)
    {
        if (connection is not SqliteConnection)
        {
            return;
        }

        foreach (var statement in Statements)
        {
            using var command = connection.CreateCommand();
            command.CommandText = statement;
            command.ExecuteNonQuery();
        }
    }

    private static async Task ApplyAsync(
        DbConnection connection,
        CancellationToken cancellationToken)
    {
        if (connection is not SqliteConnection)
        {
            return;
        }

        foreach (var statement in Statements)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = statement;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }
}
