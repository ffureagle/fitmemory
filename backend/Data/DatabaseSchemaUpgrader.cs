using System.Data;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Data;

public static class DatabaseSchemaUpgrader
{
    private static readonly IReadOnlyDictionary<string, string> OrderColumns =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ProductUrl"] = "TEXT NULL",
            ["ImageUrl"] = "TEXT NULL",
            ["ProductFamilyKey"] = "TEXT NULL",
            ["ResearchSourceUrl"] = "TEXT NULL",
            ["FitLabel"] = "TEXT NULL",
            ["SizeEvidence"] = "TEXT NULL",
            ["ResearchConfidence"] = "INTEGER NOT NULL DEFAULT 0",
            ["FitScore"] = "INTEGER NULL",
            ["FitAssessment"] = "TEXT NULL",
            ["FitAssessmentConfidence"] = "INTEGER NOT NULL DEFAULT 0",
            ["UserFitNotes"] = "TEXT NULL",
            ["ReturnConfirmedByUser"] = "INTEGER NOT NULL DEFAULT 0"
        };

    private static readonly IReadOnlyDictionary<string, string> ProfileColumns =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Age"] = "INTEGER NULL",
            ["ChestCircumferenceCm"] = "TEXT NULL",
            ["FootLengthCm"] = "TEXT NULL",
            ["UsualShoeSizeEu"] = "TEXT NULL",
            ["UserAccountId"] = "INTEGER NULL"
        };

    private static readonly IReadOnlyDictionary<string, string> RecommendationColumns =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["StyleJson"] = "TEXT NOT NULL DEFAULT '{}'"
        };

    private static readonly IReadOnlyDictionary<string, string> StyleBoardColumns =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["IsSelected"] = "INTEGER NOT NULL DEFAULT 1"
        };

    public static async Task UpgradeAsync(
        FitMemoryDbContext db,
        CancellationToken cancellationToken = default)
    {
        var connection = db.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;
        if (shouldClose)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            await CreateAccountTablesAsync(
                connection,
                cancellationToken);
            await CreateStyleBoardTableAsync(
                connection,
                cancellationToken);
            await UpgradeTableAsync(
                connection,
                "StyleBoardItems",
                StyleBoardColumns,
                cancellationToken);
            await UpgradeTableAsync(
                connection,
                "OrderHistoryItems",
                OrderColumns,
                cancellationToken);
            await UpgradeTableAsync(
                connection,
                "UserProfiles",
                ProfileColumns,
                cancellationToken);
            await UpgradeTableAsync(
                connection,
                "FitRecommendations",
                RecommendationColumns,
                cancellationToken);
            await CreateAccountIndexesAsync(
                connection,
                cancellationToken);
            await CreateStyleBoardIndexesAsync(
                connection,
                cancellationToken);
            await MigrateLegacyReturnsAsync(
                connection,
                cancellationToken);
        }
        finally
        {
            if (shouldClose)
            {
                await connection.CloseAsync();
            }
        }
    }

    private static async Task CreateStyleBoardTableAsync(
        System.Data.Common.DbConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            CREATE TABLE IF NOT EXISTS "StyleBoardItems" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_StyleBoardItems" PRIMARY KEY AUTOINCREMENT,
                "UserProfileId" INTEGER NOT NULL,
                "ProductUrl" TEXT NOT NULL,
                "Brand" TEXT NOT NULL,
                "ProductName" TEXT NOT NULL,
                "Category" TEXT NOT NULL,
                "Price" TEXT NOT NULL DEFAULT '',
                "ImageUrl" TEXT NOT NULL DEFAULT '',
                "ProductReference" TEXT NOT NULL DEFAULT '',
                "FitLabel" TEXT NOT NULL DEFAULT '',
                "FitEvidence" TEXT NOT NULL DEFAULT '',
                "Description" TEXT NOT NULL DEFAULT '',
                "RecommendedSize" TEXT NOT NULL DEFAULT '',
                "RecommendationConfidence" INTEGER NOT NULL DEFAULT 0,
                "IsSelected" INTEGER NOT NULL DEFAULT 1,
                "CreatedAt" INTEGER NOT NULL,
                "UpdatedAt" INTEGER NOT NULL,
                CONSTRAINT "FK_StyleBoardItems_UserProfiles_UserProfileId"
                    FOREIGN KEY ("UserProfileId")
                    REFERENCES "UserProfiles" ("Id")
                    ON DELETE CASCADE
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CreateStyleBoardIndexesAsync(
        System.Data.Common.DbConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_StyleBoardItems_UserProfileId_ProductUrl"
                ON "StyleBoardItems" ("UserProfileId", "ProductUrl");
            CREATE INDEX IF NOT EXISTS "IX_StyleBoardItems_UpdatedAt"
                ON "StyleBoardItems" ("UpdatedAt");
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CreateAccountTablesAsync(
        System.Data.Common.DbConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            CREATE TABLE IF NOT EXISTS "UserAccounts" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_UserAccounts" PRIMARY KEY AUTOINCREMENT,
                "PublicId" TEXT NOT NULL,
                "Email" TEXT NOT NULL,
                "NormalizedEmail" TEXT NOT NULL,
                "DisplayName" TEXT NOT NULL,
                "PasswordHash" TEXT NOT NULL,
                "CreatedAt" INTEGER NOT NULL,
                "UpdatedAt" INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS "UserSessions" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_UserSessions" PRIMARY KEY AUTOINCREMENT,
                "UserAccountId" INTEGER NOT NULL,
                "TokenHash" TEXT NOT NULL,
                "CreatedAt" INTEGER NOT NULL,
                "ExpiresAt" INTEGER NOT NULL,
                CONSTRAINT "FK_UserSessions_UserAccounts_UserAccountId"
                    FOREIGN KEY ("UserAccountId")
                    REFERENCES "UserAccounts" ("Id")
                    ON DELETE CASCADE
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CreateAccountIndexesAsync(
        System.Data.Common.DbConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserAccounts_PublicId"
                ON "UserAccounts" ("PublicId");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserAccounts_NormalizedEmail"
                ON "UserAccounts" ("NormalizedEmail");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserSessions_TokenHash"
                ON "UserSessions" ("TokenHash");
            CREATE INDEX IF NOT EXISTS "IX_UserSessions_ExpiresAt"
                ON "UserSessions" ("ExpiresAt");
            CREATE INDEX IF NOT EXISTS "IX_UserSessions_UserAccountId"
                ON "UserSessions" ("UserAccountId");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserProfiles_UserAccountId"
                ON "UserProfiles" ("UserAccountId")
                WHERE "UserAccountId" IS NOT NULL;
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task MigrateLegacyReturnsAsync(
        System.Data.Common.DbConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE "OrderHistoryItems"
            SET "Outcome" = CASE
                WHEN "Outcome" = 'ReturnedTooBaggy' THEN 'KeptTooBaggy'
                WHEN "Outcome" = 'ReturnedTooTight' THEN 'KeptTooTight'
                ELSE "Outcome"
            END
            WHERE "ReturnConfirmedByUser" = 0
              AND "Outcome" IN ('ReturnedTooBaggy', 'ReturnedTooTight');

            UPDATE "OrderHistoryItems"
            SET "FitNotes" = NULL
            WHERE "FitNotes" LIKE 'Otomatik sipariş taraması%';
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task UpgradeTableAsync(
        System.Data.Common.DbConnection connection,
        string table,
        IReadOnlyDictionary<string, string> requiredColumns,
        CancellationToken cancellationToken)
    {
        var existingColumns = await ReadColumnsAsync(
            connection,
            table,
            cancellationToken);
        foreach (var (column, definition) in requiredColumns)
        {
            if (existingColumns.Contains(column))
            {
                continue;
            }

            await using var command = connection.CreateCommand();
            command.CommandText =
                $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition};";
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task<HashSet<string>> ReadColumnsAsync(
        System.Data.Common.DbConnection connection,
        string table,
        CancellationToken cancellationToken)
    {
        var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info('{table}');";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            columns.Add(reader.GetString(reader.GetOrdinal("name")));
        }

        return columns;
    }
}
