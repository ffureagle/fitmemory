using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

namespace FitMemory.Api.Data;

public static class DatabaseInitializer
{
    public static async Task InitializeAsync(
        FitMemoryDbContext db,
        CancellationToken cancellationToken = default)
    {
        if (db.Database.IsSqlite())
        {
            await db.Database.EnsureCreatedAsync(cancellationToken);
            await DatabaseSchemaUpgrader.UpgradeAsync(db);
            return;
        }

        if (!db.Database.IsNpgsql())
        {
            await db.Database.EnsureCreatedAsync(cancellationToken);
            return;
        }

        if (await FitMemoryTablesExistAsync(db, cancellationToken))
        {
            return;
        }

        var databaseCreator = db.GetService<IRelationalDatabaseCreator>();
        await databaseCreator.CreateTablesAsync(cancellationToken);
    }

    private static async Task<bool> FitMemoryTablesExistAsync(
        FitMemoryDbContext db,
        CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;

        if (openedHere)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT to_regclass('public.\"UserProfiles\"') IS NOT NULL";
            var result = await command.ExecuteScalarAsync(cancellationToken);
            return result is true;
        }
        finally
        {
            if (openedHere)
            {
                await connection.CloseAsync();
            }
        }
    }
}
