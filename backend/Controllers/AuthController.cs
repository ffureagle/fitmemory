using FitMemory.Api.Contracts;
using FitMemory.Api.Security;
using FitMemory.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FitMemory.Api.Controllers;

[ApiController]
[Route("api/auth")]
[EnableRateLimiting("auth")]
public sealed class AuthController(
    AccountSessionService accountSessionService) : ControllerBase
{
    [AllowAnonymous]
    [HttpPost("register")]
    [ProducesResponseType<AuthSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<AuthSessionResponse>> Register(
        RegisterAccountRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await accountSessionService.RegisterAsync(
                request,
                cancellationToken));
        }
        catch (AccountFlowException exception)
        {
            return Problem(
                statusCode: exception.StatusCode,
                title: exception.Title,
                detail: exception.Detail);
        }
    }

    [AllowAnonymous]
    [HttpPost("login")]
    [ProducesResponseType<AuthSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AuthSessionResponse>> Login(
        LoginAccountRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await accountSessionService.LoginAsync(
                request,
                cancellationToken));
        }
        catch (AccountFlowException exception)
        {
            return Problem(
                statusCode: exception.StatusCode,
                title: exception.Title,
                detail: exception.Detail);
        }
    }

    [Authorize]
    [HttpGet("me")]
    [ProducesResponseType<AccountResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AccountResponse>> Me(
        CancellationToken cancellationToken)
    {
        var accountId = User.GetFitMemoryAccountId();
        if (accountId is null)
        {
            return Unauthorized();
        }

        var account = await accountSessionService.GetAccountAsync(
            accountId.Value,
            cancellationToken);
        return account is null ? Unauthorized() : Ok(account);
    }

    [Authorize]
    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Logout(
        CancellationToken cancellationToken)
    {
        var accountId = User.GetFitMemoryAccountId();
        var accessToken = ReadBearerToken();
        if (accountId is null || accessToken is null)
        {
            return Unauthorized();
        }

        await accountSessionService.LogoutAsync(
            accessToken,
            accountId.Value,
            cancellationToken);
        return NoContent();
    }

    private string? ReadBearerToken()
    {
        var authorization = Request.Headers.Authorization.ToString();
        return authorization.StartsWith(
            "Bearer ",
            StringComparison.OrdinalIgnoreCase)
            ? authorization["Bearer ".Length..].Trim()
            : null;
    }
}
