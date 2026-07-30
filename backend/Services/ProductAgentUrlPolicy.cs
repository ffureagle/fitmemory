namespace FitMemory.Api.Services;

public static class ProductAgentUrlPolicy
{
    private static readonly string[] AllowedRoots = ["zara.com", "pullandbear.com"];
    private static readonly string[] ForbiddenSegments =
    [
        "/login", "/signin", "/sign-in", "/account", "/cart", "/bag", "/basket",
        "/checkout", "/payment", "/pay", "/order-confirmation"
    ];

    public static bool TryValidateProductUrl(string? value, out Uri uri, out string brandKey)
    {
        uri = null!;
        brandKey = "";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
            parsed.Scheme != Uri.UriSchemeHttps ||
            IsForbiddenFlow(parsed))
        {
            return false;
        }

        brandKey = AllowedRoots.FirstOrDefault(root =>
            parsed.Host.Equals(root, StringComparison.OrdinalIgnoreCase) ||
            parsed.Host.EndsWith('.' + root, StringComparison.OrdinalIgnoreCase)) ?? "";
        if (brandKey.Length == 0) return false;
        uri = parsed;
        return true;
    }

    public static bool IsForbiddenFlow(Uri uri)
    {
        var path = uri.AbsolutePath.ToLowerInvariant();
        return ForbiddenSegments.Any(segment => path.Contains(segment, StringComparison.Ordinal));
    }

    public static bool IsReadOnlyMethod(string? method) =>
        method?.ToUpperInvariant() is "GET" or "HEAD" or "OPTIONS";

    public static string SelectAdapter(string brandKey) => brandKey switch
    {
        "zara.com" => "Zara",
        "pullandbear.com" => "Pull&Bear",
        _ => "Unknown"
    };
}
