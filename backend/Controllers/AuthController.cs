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
            return AuthProblem(exception);
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
            return AuthProblem(exception);
        }
    }

    [AllowAnonymous]
    [HttpPost("password/forgot")]
    public async Task<ActionResult<ForgotPasswordResponse>> ForgotPassword(
        ForgotPasswordRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await accountSessionService.SendPasswordResetCodeAsync(request, cancellationToken));
        }
        catch (AccountFlowException exception)
        {
            return AuthProblem(exception);
        }
    }

    [AllowAnonymous]
    [HttpPost("password/reset")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> ResetPassword(
        ResetPasswordRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            await accountSessionService.ResetPasswordAsync(request, cancellationToken);
            return NoContent();
        }
        catch (AccountFlowException exception)
        {
            return AuthProblem(exception);
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

    [Authorize]
    [HttpDelete("account")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> DeleteAccount(
        CancellationToken cancellationToken)
    {
        var accountId = User.GetFitMemoryAccountId();
        if (accountId is null)
        {
            return Unauthorized();
        }

        var deleted = await accountSessionService.DeleteAccountAsync(
            accountId.Value,
            cancellationToken);
        return deleted ? NoContent() : Unauthorized();
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

    private ObjectResult AuthProblem(AccountFlowException exception)
    {
        return StatusCode(exception.StatusCode, new
        {
            title = exception.Title,
            status = exception.StatusCode,
            detail = exception.Detail,
            errorCode = exception.ErrorCode
        });
    }
}
