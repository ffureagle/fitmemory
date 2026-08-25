using FitMemory.Api.Data;
using Microsoft.Extensions.Configuration;

namespace FitMemory.Api.Tests;

public sealed class FitMemoryDatabaseSelectionTests
{
    [Fact]
    public void ParsesSupabasePoolerDatabaseUrl()
    {
        var ok = FitMemoryDatabaseSelection.TryParseDatabaseUrl(
            "postgres://postgres.abc:p%40ss@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
            out var builder,
            out var error);

        Assert.True(ok);
        Assert.Null(error);
        Assert.Equal("aws-0-eu-central-1.pooler.supabase.com", builder.Host);
        Assert.Equal(6543, builder.Port);
        Assert.Equal("postgres", builder.Database);
        Assert.Equal("postgres.abc", builder.Username);
        Assert.Equal("p@ss", builder.Password);
        Assert.Equal(Npgsql.SslMode.Require, builder.SslMode);
        Assert.Equal(0, builder.MaxAutoPrepare);
    }

    [Fact]
    public void FallsBackToSqliteWhenPostgresProbeFails()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DB_PROVIDER"] = "postgres",
                ["POSTGRES_HOST"] = "aws-0-eu-central-1.pooler.supabase.com",
                ["POSTGRES_PORT"] = "5432",
                ["POSTGRES_DATABASE"] = "postgres",
                ["POSTGRES_USERNAME"] = "postgres.missing",
                ["POSTGRES_PASSWORD"] = "secret-value",
                ["SQLITE_PATH"] = "/tmp/fitmemory-fallback.db"
            })
            .Build();

        var options = FitMemoryDatabaseSelection.Resolve(
            configuration,
            _ => "(ENOTFOUND) tenant/user postgres.missing not found");

        Assert.False(options.UsePostgreSql);
        Assert.Equal("Data Source=/tmp/fitmemory-fallback.db", options.ConnectionString);
        Assert.Contains("ENOTFOUND", options.FallbackReason, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-value", options.FallbackReason, StringComparison.Ordinal);
    }

    [Fact]
    public void KeepsPostgresWhenProbeSucceeds()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DB_PROVIDER"] = "postgres",
                ["POSTGRES_HOST"] = "db.example.internal",
                ["POSTGRES_PASSWORD"] = "secret-value",
                ["POSTGRES_USERNAME"] = "fitmemory"
            })
            .Build();

        var options = FitMemoryDatabaseSelection.Resolve(
            configuration,
            _ => null);

        Assert.True(options.UsePostgreSql);
        Assert.Contains("Host=db.example.internal", options.ConnectionString, StringComparison.Ordinal);
        Assert.Null(options.FallbackReason);
    }

    [Fact]
    public void LocalDefaultStaysSqliteWithoutPostgresHost()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:FitMemory"] = "Data Source=fitmemory.db"
            })
            .Build();

        var options = FitMemoryDatabaseSelection.Resolve(configuration, _ => "should not probe");

        Assert.False(options.UsePostgreSql);
        Assert.Equal("Data Source=fitmemory.db", options.ConnectionString);
        Assert.Null(options.FallbackReason);
    }

    [Fact]
    public void SanitizeStripsPasswordFromConnectionString()
    {
        var sanitized = FitMemoryDatabaseSelection.Sanitize(
            "Host=x;Password=super-secret;Username=u");

        Assert.DoesNotContain("super-secret", sanitized, StringComparison.Ordinal);
        Assert.Contains("Password=***", sanitized, StringComparison.Ordinal);
    }
}
