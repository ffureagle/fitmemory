using FitMemory.Api.Data;
using FitMemory.Api.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Tests;

public sealed class SqliteSchemaUpgradeTests : IDisposable
{
    private readonly string path = Path.Combine(
        Path.GetTempPath(),
        $"fitmemory-schema-{Guid.NewGuid():N}.db");

    [Fact]
    public async Task UpgradeRunsEveryStatementAndKeepsBlankFingerprints()
    {
        await using (var connection = new SqliteConnection($"Data Source={path}"))
        {
            await connection.OpenAsync();
            await ExecuteAsync(
                connection,
                """
                CREATE TABLE "UserProfiles" (
                    "Id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "UserId" TEXT NOT NULL,
                    "HeightCm" TEXT NOT NULL,
                    "WeightKg" TEXT NOT NULL,
                    "ShoulderWidthCm" TEXT NOT NULL,
                    "WaistCircumferenceCm" TEXT NOT NULL,
                    "FitPreference" TEXT NOT NULL,
                    "CreatedAt" INTEGER NOT NULL,
                    "UpdatedAt" INTEGER NOT NULL
                );
                CREATE TABLE "OrderHistoryItems" (
                    "Id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "UserProfileId" INTEGER NOT NULL,
                    "Brand" TEXT NOT NULL,
                    "ProductName" TEXT NOT NULL,
                    "Category" TEXT NOT NULL,
                    "PurchasedSize" TEXT NOT NULL,
                    "Outcome" TEXT NOT NULL,
                    "ReturnConfirmedByUser" INTEGER NOT NULL DEFAULT 0,
                    "FitNotes" TEXT NULL,
                    "CreatedAt" INTEGER NOT NULL,
                    "UpdatedAt" INTEGER NOT NULL
                );
                CREATE TABLE "FitRecommendations" (
                    "Id" INTEGER PRIMARY KEY AUTOINCREMENT,
                    "UserProfileId" INTEGER NOT NULL,
                    "CreatedAt" INTEGER NOT NULL
                );
                INSERT INTO "UserProfiles"
                    ("UserId", "HeightCm", "WeightKg", "ShoulderWidthCm", "WaistCircumferenceCm", "FitPreference", "CreatedAt", "UpdatedAt")
                VALUES ('legacy', '180', '75', '46', '82', 'TrueToSize', 1, 1);
                INSERT INTO "OrderHistoryItems"
                    ("UserProfileId", "Brand", "ProductName", "Category", "PurchasedSize", "Outcome", "ReturnConfirmedByUser", "FitNotes", "CreatedAt", "UpdatedAt")
                VALUES (1, 'Zara', 'Eski', 'top', 'M', 'ReturnedTooBaggy', 0, 'Otomatik sipariş taraması 2024', 1, 1);
                """);
        }

        await using (var db = new FitMemoryDbContext(Options()))
        {
            await DatabaseSchemaUpgrader.UpgradeAsync(db);
            await db.Database.OpenConnectionAsync();
            var connection = db.Database.GetDbConnection();
            Assert.Equal("wal", await ScalarAsync(connection, "PRAGMA journal_mode;"));
            Assert.Equal(1L, Convert.ToInt64(await ScalarAsync(connection, "PRAGMA foreign_keys;")));
            Assert.Equal(30000L, Convert.ToInt64(await ScalarAsync(connection, "PRAGMA busy_timeout;")));
        }

        await using var check = new SqliteConnection($"Data Source={path}");
        await check.OpenAsync();
        Assert.True(await ExistsAsync(check, "table", "UserSessions"));
        Assert.True(await ExistsAsync(check, "table", "FavoriteOutfits"));
        Assert.True(await ExistsAsync(check, "index", "IX_UserAccounts_NormalizedEmail"));
        Assert.True(await ExistsAsync(check, "index", "IX_UserSessions_TokenHash"));
        Assert.True(await ExistsAsync(check, "index", "IX_UserSessions_ExpiresAt"));
        Assert.True(await ExistsAsync(check, "index", "IX_StyleBoardItems_UpdatedAt"));
        Assert.True(await ExistsAsync(check, "index", "IX_FavoriteOutfits_UserProfileId_CreatedAt"));
        Assert.True(await ColumnExistsAsync(check, "OrderHistoryItems", "ImportFingerprint"));

        var indexSql = await ScalarAsync(
            check,
            """
            SELECT sql FROM sqlite_master
            WHERE name = 'IX_OrderHistoryItems_UserProfileId_ImportFingerprint'
            """);
        Assert.Contains("WHERE", indexSql?.ToString(), StringComparison.OrdinalIgnoreCase);

        Assert.Equal(
            "KeptTooBaggy",
            await ScalarAsync(check, "SELECT \"Outcome\" FROM \"OrderHistoryItems\" WHERE \"Id\" = 1"));
        var fitNotes = await ScalarAsync(
            check,
            "SELECT \"FitNotes\" FROM \"OrderHistoryItems\" WHERE \"Id\" = 1");
        Assert.True(fitNotes is null or DBNull);

        await ExecuteAsync(
            check,
            """
            INSERT INTO "OrderHistoryItems"
                ("UserProfileId", "Brand", "ProductName", "Category", "PurchasedSize", "Outcome", "ReturnConfirmedByUser", "CreatedAt", "UpdatedAt", "ImportFingerprint")
            VALUES
                (1, 'Zara', 'A', 'top', 'M', 'KeptGoodFit', 0, 1, 1, NULL),
                (1, 'Zara', 'B', 'top', 'M', 'KeptGoodFit', 0, 1, 1, NULL),
                (1, 'Zara', 'C', 'top', 'M', 'KeptGoodFit', 0, 1, 1, ''),
                (1, 'Zara', 'D', 'top', 'M', 'KeptGoodFit', 0, 1, 1, '');
            """);
        await Assert.ThrowsAnyAsync<SqliteException>(() => ExecuteAsync(
            check,
            """
            INSERT INTO "OrderHistoryItems"
                ("UserProfileId", "Brand", "ProductName", "Category", "PurchasedSize", "Outcome", "ReturnConfirmedByUser", "CreatedAt", "UpdatedAt", "ImportFingerprint")
            VALUES
                (1, 'Zara', 'E', 'top', 'M', 'KeptGoodFit', 0, 1, 1, 'same-print'),
                (1, 'Zara', 'F', 'top', 'M', 'KeptGoodFit', 0, 1, 1, 'same-print');
            """));
    }

    [Fact]
    public async Task FreshInitializerAcceptsOrdersWithoutFingerprints()
    {
        await using var db = new FitMemoryDbContext(Options());
        await DatabaseInitializer.InitializeAsync(db);

        var profile = new UserProfile
        {
            UserId = "phone-vault",
            HeightCm = 180,
            WeightKg = 75,
            ShoulderWidthCm = 46,
            WaistCircumferenceCm = 82,
            CreatedAt = DateTimeOffset.UnixEpoch,
            UpdatedAt = DateTimeOffset.UnixEpoch
        };
        db.UserProfiles.Add(profile);
        db.OrderHistoryItems.Add(Order(profile, null, "Bir"));
        db.OrderHistoryItems.Add(Order(profile, null, "İki"));
        db.OrderHistoryItems.Add(Order(profile, "", "Üç"));
        db.OrderHistoryItems.Add(Order(profile, "", "Dört"));
        await db.SaveChangesAsync();

        db.OrderHistoryItems.Add(Order(profile, "same-print", "Beş"));
        db.OrderHistoryItems.Add(Order(profile, "same-print", "Altı"));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(4, await db.OrderHistoryItems.CountAsync());
    }

    public void Dispose()
    {
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            var candidate = path + suffix;
            if (File.Exists(candidate))
            {
                File.Delete(candidate);
            }
        }
    }

    private DbContextOptions<FitMemoryDbContext> Options()
    {
        return new DbContextOptionsBuilder<FitMemoryDbContext>()
            .UseSqlite($"Data Source={path}")
            .AddInterceptors(new SqliteSessionPragmasInterceptor())
            .Options;
    }

    private static OrderHistoryItem Order(
        UserProfile profile,
        string? fingerprint,
        string name)
    {
        return new OrderHistoryItem
        {
            UserProfile = profile,
            Brand = "Zara",
            ProductName = name,
            Category = "top",
            PurchasedSize = "M",
            Outcome = OrderOutcome.KeptGoodFit,
            ImportFingerprint = fingerprint,
            CreatedAt = DateTimeOffset.UnixEpoch,
            UpdatedAt = DateTimeOffset.UnixEpoch
        };
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql)
    {
        foreach (var statement in sql.Split(
                     ';',
                     StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await using var command = connection.CreateCommand();
            command.CommandText = statement;
            await command.ExecuteNonQueryAsync();
        }
    }

    private static async Task<bool> ExistsAsync(
        SqliteConnection connection,
        string type,
        string name)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COUNT(*) FROM sqlite_master WHERE type = $type AND name = $name";
        command.Parameters.AddWithValue("$type", type);
        command.Parameters.AddWithValue("$name", name);
        return Convert.ToInt64(await command.ExecuteScalarAsync()) > 0;
    }

    private static async Task<bool> ColumnExistsAsync(
        SqliteConnection connection,
        string table,
        string column)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = $name";
        command.Parameters.AddWithValue("$name", column);
        return Convert.ToInt64(await command.ExecuteScalarAsync()) > 0;
    }

    private static async Task<object?> ScalarAsync(System.Data.Common.DbConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return await command.ExecuteScalarAsync();
    }
}
