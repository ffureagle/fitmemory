using System.Globalization;
using System.Text.RegularExpressions;
using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static partial class ProductScanEvidenceValidator
{
    private static readonly string[] MeasurementTerms =
    [
        "göğüs", "gogus", "chest", "bust", "omuz", "shoulder", "bel", "waist",
        "kalça", "kalca", "basen", "hip", "ön uzunluk", "on uzunluk", "length",
        "kol uzunluğu", "kol uzunlugu", "sleeve", "sırt genişliği", "sirt genisligi",
        "back width", "kol genişliği", "kol genisligi", "arm width", "iç bacak",
        "ic bacak", "inseam", "uyluk", "thigh", "paça", "paca", "leg opening", "rise"
    ];

    private static readonly string[] RejectedTerms =
    [
        "fiyat", "price", "sku", "ref", "referans", "stok", "stock", "model",
        "boyu", "height", "ürün kod", "urun kod", "product code", "indirim",
        "discount", "reklam", "marketing", "adet", "quantity", "puan", "rating"
    ];

    public static bool IsValidSizeLabel(string? value)
    {
        var normalized = NormalizeSize(value);
        if (AlphaSizeRegex().IsMatch(normalized)) return true;
        if (!NumericSizeRegex().IsMatch(normalized)) return false;
        var first = NumericTokenRegex().Match(normalized).Value;
        return int.TryParse(first, NumberStyles.Integer, CultureInfo.InvariantCulture, out var size) &&
               size is >= 20 and <= 60;
    }

    public static string NormalizeSize(string? value)
    {
        var normalized = Regex.Replace(value?.Trim().ToUpperInvariant() ?? "", @"\s+", " ");
        var eu = Regex.Match(normalized, @"^EU\s*(\d{2})(?:\s*\([^)]*\))?$");
        if (eu.Success) return eu.Groups[1].Value;
        var labelled = Regex.Match(normalized,
            @"^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2}(?:[/-]\d{2})?)(?:\s*\([^)]*\))?$");
        return labelled.Success ? labelled.Groups[1].Value : normalized;
    }

    public static bool IsValidMeasurement(string? label, string? value)
    {
        var foldedLabel = Fold(label);
        if (string.IsNullOrWhiteSpace(foldedLabel) ||
            RejectedTerms.Any(term => foldedLabel.Contains(Fold(term), StringComparison.Ordinal)))
        {
            return false;
        }

        if (!MeasurementTerms.Any(term => foldedLabel.Contains(Fold(term), StringComparison.Ordinal)))
        {
            return false;
        }

        var match = NumericValueRegex().Match(value ?? "");
        if (!match.Success ||
            !double.TryParse(match.Groups[1].Value.Replace(',', '.'), NumberStyles.Number,
                CultureInfo.InvariantCulture, out var number))
        {
            return false;
        }

        return number is >= 1 and <= 250;
    }

    public static bool IsValidRow(AgentSizeTableRow row) =>
        IsValidSizeLabel(row.Size) &&
        row.Measurements.Any(pair => IsValidMeasurement(pair.Key, pair.Value));

    public static bool IsVerifiedChart(ProductDto product, SizeChartDto chart)
    {
        if (string.IsNullOrWhiteSpace(product.Name) ||
            string.IsNullOrWhiteSpace(product.Brand) ||
            !chart.Found || chart.Rows.Count == 0)
        {
            return false;
        }

        var headers = chart.Headers;
        return chart.Rows.Any(row =>
        {
            if (row.Cells.Count < 2 || !IsValidSizeLabel(row.Cells[0])) return false;
            for (var index = 1; index < row.Cells.Count; index++)
            {
                var header = index < headers.Count ? headers[index] : "";
                if (IsValidMeasurement(header, row.Cells[index])) return true;
            }
            return false;
        });
    }

    public static AgentSizeTableRow? NormalizeRow(AgentSizeTableRow row)
    {
        var measurements = row.Measurements
            .Where(pair => IsValidMeasurement(pair.Key, pair.Value))
            .ToDictionary(pair => pair.Key.Trim(), pair => pair.Value.Trim(), StringComparer.OrdinalIgnoreCase);
        return measurements.Count == 0 || !IsValidSizeLabel(row.Size)
            ? null
            : new AgentSizeTableRow(NormalizeSize(row.Size), measurements);
    }

    private static string Fold(string? value) => (value ?? "")
        .Trim().ToLowerInvariant()
        .Replace('ı', 'i').Replace('ş', 's').Replace('ğ', 'g')
        .Replace('ç', 'c').Replace('ö', 'o').Replace('ü', 'u');

    [GeneratedRegex(@"^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL)$", RegexOptions.IgnoreCase)]
    private static partial Regex AlphaSizeRegex();

    [GeneratedRegex(@"^\d{2}(?:[/-]\d{2})?$")]
    private static partial Regex NumericSizeRegex();

    [GeneratedRegex(@"\d{2}")]
    private static partial Regex NumericTokenRegex();

    [GeneratedRegex(@"(?<!\d)(\d{1,3}(?:[.,]\d+)?)(?!\d)")]
    private static partial Regex NumericValueRegex();
}
