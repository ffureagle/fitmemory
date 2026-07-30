namespace FitMemory.Api.Services;

internal static class ProductPageEvidenceClassifier
{
    public static bool IsTurkeyInterstitial(string? text)
    {
        var value = text ?? "";
        return value.Contains("TÜRKİYE", StringComparison.OrdinalIgnoreCase) &&
               (value.Contains("DEVAM ET", StringComparison.OrdinalIgnoreCase) ||
                value.Contains("CONTINUE", StringComparison.OrdinalIgnoreCase));
    }

    public static bool IsEmptyProductShell(string? text)
    {
        var compact = string.Join(' ', (text ?? "").Split(
            ['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (compact.Length < 40) return true;
        var hasProductControl = new[]
        {
            "Ekle", "Sepete ekle", "Beden seç", "Ölçüleri gör", "Add", "Select size", "Size guide"
        }.Any(label => compact.Contains(label, StringComparison.OrdinalIgnoreCase));
        return !hasProductControl && compact.Length < 180;
    }
}
