using System.Security.Claims;
using System.Text.Encodings.Web;
using FitMemory.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Security;

public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    FitMemoryDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(
        options,
        logger,
        encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authorization = Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith(
                "Bearer ",
                StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var token = authorization["Bearer ".Length..].Trim();
        if (token.Length is < 32 or > 256)
        {
            return AuthenticateResult.Fail("Geçersiz FitMemory oturumu.");
        }

        var tokenHash = SessionTokenService.HashToken(token);
        var now = DateTimeOffset.UtcNow;
        var session = await db.UserSessions
            .AsNoTracking()
            .Include(candidate => candidate.UserAccount)
            .SingleOrDefaultAsync(
                candidate =>
                    candidate.TokenHash == tokenHash &&
                    candidate.ExpiresAt > now,
                Context.RequestAborted);
        if (session is null)
        {
            return AuthenticateResult.Fail(
                "FitMemory oturumu bulunamadı veya süresi doldu.");
        }

        var account = session.UserAccount;
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, account.PublicId),
            new Claim(ClaimTypes.Name, account.DisplayName),
            new Claim(ClaimTypes.Email, account.Email),
            new Claim("fitmemory_account_id", account.Id.ToString())
        };
        var identity = new ClaimsIdentity(
            claims,
            SessionAuthenticationDefaults.Scheme);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(
            principal,
            SessionAuthenticationDefaults.Scheme);
        return AuthenticateResult.Success(ticket);
    }

    protected override Task HandleChallengeAsync(
        AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }

    protected override Task HandleForbiddenAsync(
        AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }
}
