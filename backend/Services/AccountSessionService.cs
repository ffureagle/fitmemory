using FitMemory.Api.Contracts;
using FitMemory.Api.Data;
using FitMemory.Api.Models;
using FitMemory.Api.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;

namespace FitMemory.Api.Services;

public sealed class AccountSessionService(
    FitMemoryDbContext db,
    IPasswordHasher<UserAccount> passwordHasher,
    PasswordResetEmailService resetEmailService)
{
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    public async Task<AuthSessionResponse> RegisterAsync(
        RegisterAccountRequest request,
        CancellationToken cancellationToken)
    {
        var email = request.Email.Trim();
        var normalizedEmail = NormalizeEmail(email);
        if (await db.UserAccounts.AnyAsync(
                account => account.NormalizedEmail == normalizedEmail,
                cancellationToken))
        {
            throw new AccountFlowException(
                StatusCodes.Status409Conflict,
                "Bu e-posta zaten kayıtlı",
                "Bu e-posta adresiyle daha önce bir FitMemory hesabı oluşturulmuş. Giriş yapmayı deneyin.");
        }

        ValidatePassword(request.Password);
        var displayName = request.DisplayName.Trim();
        var legacyUserId = NormalizeLegacyUserId(request.LegacyUserId);
        var legacyProfile = legacyUserId is null
            ? null
            : await db.UserProfiles
                .Include(profile => profile.Orders)
                .SingleOrDefaultAsync(
                    profile =>
                        profile.UserId == legacyUserId &&
                        profile.UserAccountId == null,
                    cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var publicId = legacyProfile is null
            ? Guid.NewGuid().ToString()
            : legacyProfile.UserId;
        var account = new UserAccount
        {
            PublicId = publicId,
            Email = email,
            NormalizedEmail = normalizedEmail,
            DisplayName = displayName,
            PasswordHash = "",
            CreatedAt = now,
            UpdatedAt = now,
            Profile = legacyProfile
        };
        account.PasswordHash = passwordHasher.HashPassword(
            account,
            request.Password);
        if (legacyProfile is not null)
        {
            legacyProfile.UserAccount = account;
            legacyProfile.UpdatedAt = now;
        }

        db.UserAccounts.Add(account);
        var session = AddSession(account, now);
        await db.SaveChangesAsync(cancellationToken);
        return new AuthSessionResponse(
            await ToResponseAsync(account, cancellationToken),
            session.RawToken,
            session.Entity.ExpiresAt,
            legacyProfile is not null);
    }

    public async Task<AuthSessionResponse> LoginAsync(
        LoginAccountRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(request.Email);
        var account = await db.UserAccounts
            .Include(candidate => candidate.Profile)
            .SingleOrDefaultAsync(
                candidate => candidate.NormalizedEmail == normalizedEmail,
                cancellationToken);
        if (account is null)
        {
            throw InvalidCredentials();
        }

        var verification = passwordHasher.VerifyHashedPassword(
            account,
            account.PasswordHash,
            request.Password);
        if (verification == PasswordVerificationResult.Failed)
        {
            throw InvalidCredentials();
        }
        if (verification ==
            PasswordVerificationResult.SuccessRehashNeeded)
        {
            account.PasswordHash = passwordHasher.HashPassword(
                account,
                request.Password);
            account.UpdatedAt = DateTimeOffset.UtcNow;
        }

        var now = DateTimeOffset.UtcNow;
        var expiredSessions = await db.UserSessions
            .Where(session =>
                session.UserAccountId == account.Id &&
                session.ExpiresAt <= now)
            .ToListAsync(cancellationToken);
        db.UserSessions.RemoveRange(expiredSessions);

        var activeSessions = await db.UserSessions
            .Where(session => session.UserAccountId == account.Id)
            .OrderByDescending(session => session.CreatedAt)
            .Skip(7)
            .ToListAsync(cancellationToken);
        db.UserSessions.RemoveRange(activeSessions);

        var session = AddSession(account, now);
        await db.SaveChangesAsync(cancellationToken);
        return new AuthSessionResponse(
            await ToResponseAsync(account, cancellationToken),
            session.RawToken,
            session.Entity.ExpiresAt,
            false);
    }

    public async Task<ForgotPasswordResponse> SendPasswordResetCodeAsync(
        ForgotPasswordRequest request,
        CancellationToken cancellationToken)
    {
        var account = await db.UserAccounts.SingleOrDefaultAsync(
            candidate => candidate.NormalizedEmail == NormalizeEmail(request.Email),
            cancellationToken);
        if (account is null)
        {
            await Task.Delay(250, cancellationToken);
            return new ForgotPasswordResponse(
                "Bu adres kayıtlıysa yenileme kodu e-posta ile gönderildi.",
                15);
        }

        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        account.PasswordResetCodeHash = HashResetCode(account.NormalizedEmail, code);
        account.PasswordResetExpiresAtUnix = DateTimeOffset.UtcNow.AddMinutes(15).ToUnixTimeSeconds();
        account.PasswordResetAttempts = 0;
        account.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await resetEmailService.SendCodeAsync(account.Email, code, cancellationToken);
        return new ForgotPasswordResponse(
            "Bu adres kayıtlıysa yenileme kodu e-posta ile gönderildi.",
            15);
    }

    public async Task ResetPasswordAsync(
        ResetPasswordRequest request,
        CancellationToken cancellationToken)
    {
        ValidatePassword(request.NewPassword);
        var account = await db.UserAccounts
            .Include(candidate => candidate.Sessions)
            .SingleOrDefaultAsync(
                candidate => candidate.NormalizedEmail == NormalizeEmail(request.Email),
                cancellationToken);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var suppliedHash = HashResetCode(NormalizeEmail(request.Email), request.Code);
        var valid = account is not null &&
            account.PasswordResetAttempts < 5 &&
            account.PasswordResetExpiresAtUnix >= now &&
            !string.IsNullOrWhiteSpace(account.PasswordResetCodeHash) &&
            CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(account.PasswordResetCodeHash),
                Convert.FromHexString(suppliedHash));
        if (!valid)
        {
            if (account is not null)
            {
                account.PasswordResetAttempts++;
                await db.SaveChangesAsync(cancellationToken);
            }
            throw new AccountFlowException(
                StatusCodes.Status400BadRequest,
                "Kod geçersiz",
                "Kod hatalı veya süresi dolmuş. Yeni bir kod isteyin.");
        }

        account!.PasswordHash = passwordHasher.HashPassword(account, request.NewPassword);
        account.PasswordResetCodeHash = null;
        account.PasswordResetExpiresAtUnix = null;
        account.PasswordResetAttempts = 0;
        account.UpdatedAt = DateTimeOffset.UtcNow;
        db.UserSessions.RemoveRange(account.Sessions);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<AccountResponse?> GetAccountAsync(
        int accountId,
        CancellationToken cancellationToken)
    {
        var account = await db.UserAccounts
            .AsNoTracking()
            .Include(candidate => candidate.Profile)
            .SingleOrDefaultAsync(
                candidate => candidate.Id == accountId,
                cancellationToken);
        return account is null
            ? null
            : await ToResponseAsync(account, cancellationToken);
    }

    public async Task LogoutAsync(
        string accessToken,
        int accountId,
        CancellationToken cancellationToken)
    {
        var tokenHash = SessionTokenService.HashToken(accessToken);
        var session = await db.UserSessions.SingleOrDefaultAsync(
            candidate =>
                candidate.UserAccountId == accountId &&
                candidate.TokenHash == tokenHash,
            cancellationToken);
        if (session is null)
        {
            return;
        }

        db.UserSessions.Remove(session);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> DeleteAccountAsync(
        int accountId,
        CancellationToken cancellationToken)
    {
        var account = await db.UserAccounts
            .SingleOrDefaultAsync(
                candidate => candidate.Id == accountId,
                cancellationToken);
        if (account is null)
        {
            return false;
        }

        db.UserAccounts.Remove(account);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    private (UserSession Entity, string RawToken) AddSession(
        UserAccount account,
        DateTimeOffset now)
    {
        var rawToken = SessionTokenService.CreateToken();
        var session = new UserSession
        {
            UserAccount = account,
            TokenHash = SessionTokenService.HashToken(rawToken),
            CreatedAt = now,
            ExpiresAt = now.Add(SessionLifetime)
        };
        db.UserSessions.Add(session);
        return (session, rawToken);
    }

    private async Task<AccountResponse> ToResponseAsync(
        UserAccount account,
        CancellationToken cancellationToken)
    {
        var profileId = account.Profile?.Id;
        var wardrobeItemCount = profileId is null
            ? 0
            : await db.OrderHistoryItems.CountAsync(
                order => order.UserProfileId == profileId,
                cancellationToken);
        return new AccountResponse(
            account.PublicId,
            account.Email,
            account.DisplayName,
            profileId is not null,
            wardrobeItemCount);
    }

    private static string NormalizeEmail(string email)
    {
        return email.Trim().ToUpperInvariant();
    }

    private static string HashResetCode(string normalizedEmail, string code)
    {
        return Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes($"{normalizedEmail}:{code}")));
    }

    private static string? NormalizeLegacyUserId(string? value)
    {
        var normalized = value?.Trim();
        return normalized?.Length is >= 8 and <= 128
            ? normalized
            : null;
    }

    private static void ValidatePassword(string password)
    {
        if (!password.Any(char.IsLetter) ||
            !password.Any(char.IsDigit))
        {
            throw new AccountFlowException(
                StatusCodes.Status400BadRequest,
                "Şifre yeterince güçlü değil",
                "Şifreniz en az bir harf ve bir rakam içermelidir.");
        }
    }

    private static AccountFlowException InvalidCredentials()
    {
        return new AccountFlowException(
            StatusCodes.Status401Unauthorized,
            "Giriş bilgileri hatalı",
            "E-posta adresi veya şifre doğru değil.");
    }
}

public sealed class AccountFlowException(
    int statusCode,
    string title,
    string detail) : Exception(detail)
{
    public int StatusCode { get; } = statusCode;

    public string Title { get; } = title;

    public string Detail { get; } = detail;
}
