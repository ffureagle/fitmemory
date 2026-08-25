using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Contracts;

public sealed class RegisterAccountRequest
{
    [Required, StringLength(60, MinimumLength = 2)]
    public required string DisplayName { get; init; }

    [Required, EmailAddress, StringLength(254)]
    public required string Email { get; init; }

    [Required, StringLength(128, MinimumLength = 8)]
    public required string Password { get; init; }

    [StringLength(128, MinimumLength = 8)]
    public string? LegacyUserId { get; init; }
}

public sealed class LoginAccountRequest
{
    [Required, EmailAddress, StringLength(254)]
    public required string Email { get; init; }

    [Required, StringLength(128, MinimumLength = 8)]
    public required string Password { get; init; }
}

public sealed class ForgotPasswordRequest
{
    [Required, EmailAddress, StringLength(254)]
    public required string Email { get; init; }
}

public sealed class ResetPasswordRequest
{
    [Required, EmailAddress, StringLength(254)]
    public required string Email { get; init; }

    [Required, RegularExpression("^[0-9]{6}$")]
    public required string Code { get; init; }

    [Required, StringLength(128, MinimumLength = 8)]
    public required string NewPassword { get; init; }
}

public sealed record ForgotPasswordResponse(
    string Message,
    int ExpiresInMinutes,
    string Delivery,
    string? Code);

public sealed record AccountResponse(
    string UserId,
    string Email,
    string DisplayName,
    bool HasProfile,
    int WardrobeItemCount);

public sealed record AuthSessionResponse(
    AccountResponse Account,
    string AccessToken,
    DateTimeOffset ExpiresAt,
    bool MigratedLegacyData);
