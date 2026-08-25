using Microsoft.Extensions.Configuration;
using Npgsql;

namespace FitMemory.Api.Data;

public sealed record FitMemoryDatabaseOptions(
    bool UsePostgreSql,
    string ConnectionString,
    string? FallbackReason);

public static class FitMemoryDatabaseSelection
{
    public static FitMemoryDatabaseOptions Resolve(
        IConfiguration configuration,
        Func<string, string?>? probePostgresError = null)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var sqliteConnection = SqliteConnectionString(configuration);
        var postgresConnection = TryBuildPostgresConnection(
            configuration,
            out var postgresError);
        if (postgresError is not null && postgresConnection is null)
        {
            throw new InvalidOperationException(postgresError);
        }

        var configuredProvider = (
                configuration["DB_PROVIDER"] ??
                configuration["Database:Provider"] ??
                "")
            .Trim();
        var wantsPostgres =
            postgresConnection is not null &&
            (
                configuredProvider.Equals("postgres", StringComparison.OrdinalIgnoreCase) ||
                configuredProvider.Equals("postgresql", StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrWhiteSpace(configuredProvider)
            );

        if (!wantsPostgres || postgresConnection is null)
        {
            return new FitMemoryDatabaseOptions(false, sqliteConnection, null);
        }

        var probe = probePostgresError ?? ProbePostgresError;
        var probeError = probe(postgresConnection);
        if (string.IsNullOrWhiteSpace(probeError))
        {
            return new FitMemoryDatabaseOptions(true, postgresConnection, null);
        }

        return new FitMemoryDatabaseOptions(
            false,
            sqliteConnection,
            Sanitize(probeError));
    }

    public static string? ProbePostgresError(string connectionString)
    {
        try
        {
            var builder = new NpgsqlConnectionStringBuilder(connectionString)
            {
                Timeout = 8,
                CommandTimeout = 8
            };
            using var connection = new NpgsqlConnection(builder.ConnectionString);
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1";
            command.ExecuteScalar();
            return null;
        }
        catch (Exception exception)
        {
            return Sanitize(exception.Message);
        }
    }

    public static string Sanitize(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return "database unreachable";
        }

        var sanitized = System.Text.RegularExpressions.Regex.Replace(
            message,
            @"(?i)(password|pwd)\s*=\s*[^;]+",
            "$1=***");
        sanitized = System.Text.RegularExpressions.Regex.Replace(
            sanitized,
            @"(?i)(postgres(?:ql)?://[^:/?#]+):([^@/]+)@",
            "$1:***@");
        return sanitized.Length > 240 ? sanitized[..240] : sanitized;
    }

    internal static string? TryBuildPostgresConnection(
        IConfiguration configuration,
        out string? error)
    {
        error = null;
        var databaseUrl = configuration["DATABASE_URL"]?.Trim();
        if (!string.IsNullOrWhiteSpace(databaseUrl))
        {
            if (!TryParseDatabaseUrl(databaseUrl, out var fromUrl, out error))
            {
                return null;
            }

            ApplyPostgresHardening(fromUrl);
            return fromUrl.ConnectionString;
        }

        var host = configuration["POSTGRES_HOST"]?.Trim();
        if (string.IsNullOrWhiteSpace(host))
        {
            var fallback = configuration.GetConnectionString("FitMemory");
            if (!string.IsNullOrWhiteSpace(fallback) &&
                fallback.Contains("Host=", StringComparison.OrdinalIgnoreCase))
            {
                var fromCs = new NpgsqlConnectionStringBuilder(fallback);
                ApplyPostgresHardening(fromCs);
                return fromCs.ConnectionString;
            }

            return null;
        }

        var password = configuration["POSTGRES_PASSWORD"];
        if (string.IsNullOrWhiteSpace(password))
        {
            error = "POSTGRES_HOST tanımlıyken POSTGRES_PASSWORD da tanımlanmalıdır.";
            return null;
        }

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = host,
            Port = int.TryParse(configuration["POSTGRES_PORT"], out var port)
                ? port
                : 5432,
            Database = configuration["POSTGRES_DATABASE"]?.Trim() ?? "postgres",
            Username = configuration["POSTGRES_USERNAME"]?.Trim() ?? "postgres",
            Password = password,
            IncludeErrorDetail = false
        };
        ApplyPostgresHardening(builder);
        return builder.ConnectionString;
    }

    public static bool TryParseDatabaseUrl(
        string databaseUrl,
        out NpgsqlConnectionStringBuilder builder,
        out string? error)
    {
        builder = new NpgsqlConnectionStringBuilder();
        error = null;
        if (!Uri.TryCreate(databaseUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "postgres" && uri.Scheme != "postgresql"))
        {
            error = "DATABASE_URL postgres:// ile başlamalıdır.";
            return false;
        }

        var userInfo = uri.UserInfo.Split(':', 2);
        builder.Host = uri.Host;
        builder.Port = uri.IsDefaultPort ? 5432 : uri.Port;
        builder.Database = uri.AbsolutePath.Trim('/') is { Length: > 0 } name
            ? Uri.UnescapeDataString(name)
            : "postgres";
        builder.Username = userInfo.Length > 0
            ? Uri.UnescapeDataString(userInfo[0])
            : "postgres";
        if (userInfo.Length > 1)
        {
            builder.Password = Uri.UnescapeDataString(userInfo[1]);
        }

        ApplyPostgresHardening(builder);
        return true;
    }

    public static void ApplyPostgresHardening(NpgsqlConnectionStringBuilder builder)
    {
        builder.SslMode = SslMode.Require;
        builder.Timeout = Math.Max(builder.Timeout, 30);
        builder.CommandTimeout = Math.Max(builder.CommandTimeout, 30);
        builder.MaxAutoPrepare = 0;
        builder["GSS Encryption Mode"] = "Disable";
        builder["Channel Binding"] = "Disable";
        builder["No Reset On Close"] = "true";
    }

    public static string SqliteConnectionString(IConfiguration configuration)
    {
        var configured = configuration["SQLITE_PATH"]?.Trim();
        if (string.IsNullOrWhiteSpace(configured))
        {
            configured = Directory.Exists("/app/data")
                ? "/app/data/fitmemory.db"
                : configuration.GetConnectionString("FitMemory")
                    ?? "Data Source=fitmemory.db";
        }

        if (configured.Contains("Data Source=", StringComparison.OrdinalIgnoreCase) ||
            configured.Contains("Host=", StringComparison.OrdinalIgnoreCase))
        {
            if (configured.Contains("Host=", StringComparison.OrdinalIgnoreCase))
            {
                return "Data Source=fitmemory.db";
            }

            return configured;
        }

        return $"Data Source={configured}";
    }
}
