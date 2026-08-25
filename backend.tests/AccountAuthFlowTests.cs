using FitMemory.Api.Contracts;
using FitMemory.Api.Data;
using FitMemory.Api.Models;
using FitMemory.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Tests;

public sealed class AccountAuthFlowTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly FitMemoryDbContext db;
    private readonly AccountSessionService service;

    public AccountAuthFlowTests()
    {
        connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<FitMemoryDbContext>()
            .UseSqlite(connection)
            .Options;
        db = new FitMemoryDbContext(options);
        db.Database.EnsureCreated();
        service = new AccountSessionService(
            db,
            new PasswordHasher<UserAccount>(),
            new PasswordResetEmailService(
                Options.Create(new EmailOptions()),
                NullLogger<PasswordResetEmailService>.Instance));
    }

    [Fact]
    public async Task LoginReportsAccountMissingWhenEmailIsUnknown()
    {
        var error = await Assert.ThrowsAsync<AccountFlowException>(() =>
            service.LoginAsync(
                new LoginAccountRequest
                {
                    Email = "missing@example.com",
                    Password = "Abcdef12"
                },
                CancellationToken.None));

        Assert.Equal("account_missing", error.ErrorCode);
        Assert.Equal(StatusCodes.Status401Unauthorized, error.StatusCode);
    }

    [Fact]
    public async Task ForgotPasswordShowsAppCodeWhenSmtpIsNotConfigured()
    {
        await service.RegisterAsync(
            new RegisterAccountRequest
            {
                DisplayName = "Furkan",
                Email = "owner@example.com",
                Password = "Abcdef12"
            },
            CancellationToken.None);

        var result = await service.SendPasswordResetCodeAsync(
            new ForgotPasswordRequest { Email = "owner@example.com" },
            CancellationToken.None);

        Assert.Equal("app", result.Delivery);
        Assert.False(string.IsNullOrWhiteSpace(result.Code));
        Assert.Equal(6, result.Code!.Length);
        Assert.Contains(result.Code, result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ForgotPasswordDoesNotPretendEmailWasSentWhenAccountIsMissing()
    {
        var result = await service.SendPasswordResetCodeAsync(
            new ForgotPasswordRequest { Email = "ghost@example.com" },
            CancellationToken.None);

        Assert.Equal("none", result.Delivery);
        Assert.Null(result.Code);
        Assert.Contains("kayıtlı değil", result.Message, StringComparison.OrdinalIgnoreCase);
    }

    public void Dispose()
    {
        db.Dispose();
        connection.Dispose();
    }
}
