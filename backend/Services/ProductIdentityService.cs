using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed partial class ProductIdentityService
{
    public string BuildFamilyKey(
        string brand,
        string productName,
        string? productUrl,
        string? productReference = null)
    {
        var brandKey = NormalizeToken(brand);
        var styleCode =
            ExtractStyleCodeFromUrl(productUrl) ??
            ExtractStyleCode(productReference, brand);
        if (!string.IsNullOrWhiteSpace(styleCode))
        {
            return Limit($"{brandKey}|STYLE|{styleCode}", 200);
        }

        var canonicalPath = CanonicalProductPath(productUrl);
        if (!string.IsNullOrWhiteSpace(canonicalPath))
        {
            return Limit($"{brandKey}|PATH|{canonicalPath}", 200);
        }

        var nameKey = NormalizeProductName(productName);
        return Limit($"{brandKey}|NAME|{nameKey}", 200);
    }

    public bool IsSameFamily(OrderHistoryItem order, ProductDto product)
    {
        var activeKey = BuildFamilyKey(
            product.Brand,
            product.Name,
            product.Url,
            product.ProductReference);
        var archivedKey = string.IsNullOrWhiteSpace(order.ProductFamilyKey)
            ? BuildFamilyKey(
                order.Brand,
                order.ProductName,
                order.ProductUrl)
            : order.ProductFamilyKey;
        return activeKey.Length > 0 &&
               activeKey.Equals(archivedKey, StringComparison.OrdinalIgnoreCase);
    }

    private static string? ExtractStyleCodeFromUrl(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
        {
            return null;
        }

        var match = InditexPathStyleRegex().Match(uri.AbsolutePath);
        if (match.Success)
        {
            return TrimLeadingZeroes(match.Groups["code"].Value);
        }

        var query = Uri.UnescapeDataString(uri.Query);
        match = QueryStyleRegex().Match(query);
        return match.Success
            ? TrimLeadingZeroes(match.Groups["code"].Value)
            : null;
    }

    private static string? ExtractStyleCode(string? value, string brand)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var digits = DigitsRegex().Match(value).Value;
        if (digits.Length < 6)
        {
            return null;
        }

        var normalizedBrand = NormalizeToken(brand);
        if (digits.Length >= 10 &&
            normalizedBrand is "ZARA" or "PULLBEAR" or "BERSHKA" or
                "STRADIVARIUS" or "MASSIMODUTTI" or "OYSHO")
        {
            digits = digits[..^3];
        }

        return TrimLeadingZeroes(digits);
    }

    private static string CanonicalProductPath(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
        {
            return "";
        }

        var segments = uri.AbsolutePath
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Where(segment => !LocaleSegmentRegex().IsMatch(segment))
            .Select(NormalizeToken)
            .Where(segment => segment.Length > 1)
            .ToArray();
        if (segments.Length == 0)
        {
            return "";
        }

        var host = uri.Host
            .ToLowerInvariant()
            .Replace("www.", "", StringComparison.Ordinal);
        return $"{host}/{string.Join('/', segments.TakeLast(2))}";
    }

    private static string NormalizeProductName(string value)
    {
        var normalized = RemoveDiacritics(value).ToUpperInvariant();
        normalized = ColorWordsRegex().Replace(normalized, " ");
        normalized = ProductNoiseRegex().Replace(normalized, " ");
        normalized = NonAlphaNumericRegex().Replace(normalized, "");
        return normalized.Length > 0 ? normalized : "UNKNOWN";
    }

    private static string NormalizeToken(string value)
    {
        return NonAlphaNumericRegex()
            .Replace(RemoveDiacritics(value).ToUpperInvariant(), "");
    }

    private static string RemoveDiacritics(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) !=
                UnicodeCategory.NonSpacingMark)
            {
                builder.Append(character);
            }
        }
        return builder.ToString().Normalize(NormalizationForm.FormC);
    }

    private static string TrimLeadingZeroes(string value)
    {
        var trimmed = value.TrimStart('0');
        return trimmed.Length > 0 ? trimmed : value;
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    [GeneratedRegex(
        @"(?:^|[-_/])(?:c0)?(?:p|l)(?<code>\d{7,12})(?:[./_-]|$)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex InditexPathStyleRegex();

    [GeneratedRegex(
        @"(?:product|style|model|reference|ref|pid|item)[^0-9]{0,8}(?<code>\d{6,14})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex QueryStyleRegex();

    [GeneratedRegex(@"\d{6,16}", RegexOptions.CultureInvariant)]
    private static partial Regex DigitsRegex();

    [GeneratedRegex(
        @"^(?:[a-z]{2}(?:-[a-z]{2})?|tr|en|us|uk)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LocaleSegmentRegex();

    [GeneratedRegex(
        @"\b(?:BLACK|WHITE|GREY|GRAY|BLUE|NAVY|GREEN|RED|BURGUNDY|BROWN|BEIGE|ECRU|PINK|PURPLE|YELLOW|ORANGE|SIYAH|BEYAZ|GRI|MAVI|LACIVERT|YESIL|KIRMIZI|BORDO|KAHVERENGI|BEJ|EKRU|PEMBE|MOR|SARI|TURUNCU)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ColorWordsRegex();

    [GeneratedRegex(
        @"\b(?:RENK|COLOR|COLOUR|ERKEK|KADIN|MAN|MEN|WOMAN|WOMEN)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ProductNoiseRegex();

    [GeneratedRegex(@"[^A-Z0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonAlphaNumericRegex();
}
