using System.Security.Claims;

namespace FitMemory.Api.Security;

public static class ClaimsPrincipalExtensions
{
    public static string? GetFitMemoryUserId(this ClaimsPrincipal principal)
    {
        return principal.FindFirstValue(ClaimTypes.NameIdentifier);
    }

    public static int? GetFitMemoryAccountId(this ClaimsPrincipal principal)
    {
        return int.TryParse(
            principal.FindFirstValue("fitmemory_account_id"),
            out var accountId)
            ? accountId
            : null;
    }

    public static bool Owns(this ClaimsPrincipal principal, string userId)
    {
        return string.Equals(
            principal.GetFitMemoryUserId(),
            userId?.Trim(),
            StringComparison.Ordinal);
    }
}
