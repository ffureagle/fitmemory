using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static class SizeChartAligner
{
    private static readonly string[] LetterOrder =
        ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

    public static SizeChartDto Align(SizeChartDto chart)
    {
        var selling = DistinctSizes(chart.SellingSizes);
        if (selling.Length < 2)
        {
            return chart;
        }

        var rows = chart.Rows.Where(row => row.Cells.Count > 0).ToArray();
        var overlap = rows
            .Where(row => selling.Contains(
                ProductScanEvidenceValidator.NormalizeSize(row.Cells[0]),
                StringComparer.OrdinalIgnoreCase))
            .ToArray();
        if (overlap.Length >= 2)
        {
            return Clone(chart, overlap, selling);
        }

        if (rows.Length == selling.Length)
        {
            var orderedSelling = selling.OrderBy(SizeRank).ToArray();
            var orderedRows = rows
                .OrderBy(row => SizeRank(
                    ProductScanEvidenceValidator.NormalizeSize(row.Cells[0])))
                .ToArray();
            var relabeled = orderedRows.Select((row, index) => new SizeChartRowDto
            {
                Cells = [orderedSelling[index], .. row.Cells.Skip(1)]
            }).ToArray();
            return Clone(chart, relabeled, orderedSelling);
        }

        return Clone(chart, chart.Rows, selling);
    }

    public static string[] LegalSizes(SizeChartDto chart, Func<string, string>? normalize = null)
    {
        normalize ??= static value => ProductScanEvidenceValidator.NormalizeSize(value);
        var aligned = Align(chart);
        if (aligned.SellingSizes.Count >= 2)
        {
            return DistinctSizes(aligned.SellingSizes, normalize);
        }

        return aligned.Rows
            .Where(row => row.Cells.Count > 0)
            .Select(row => normalize(row.Cells[0]))
            .Where(label => label.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static bool IsLetter(string size) =>
        Array.Exists(LetterOrder, item =>
            item.Equals(size, StringComparison.OrdinalIgnoreCase));

    public static int SizeRank(string size)
    {
        var letter = Array.FindIndex(LetterOrder, item =>
            item.Equals(size, StringComparison.OrdinalIgnoreCase));
        if (letter >= 0) return letter;
        if (double.TryParse(
                size.Replace(',', '.'),
                System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture,
                out var number))
        {
            return 1000 + (int)Math.Round(number * 10);
        }

        return 10_000;
    }

    private static string[] DistinctSizes(
        IReadOnlyList<string>? sizes,
        Func<string, string>? normalize = null)
    {
        normalize ??= static value => ProductScanEvidenceValidator.NormalizeSize(value);
        return (sizes ?? [])
            .Select(normalize)
            .Where(size => size.Length > 0 &&
                           ProductScanEvidenceValidator.IsValidSizeLabel(size))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static SizeChartDto Clone(
        SizeChartDto chart,
        IReadOnlyList<SizeChartRowDto> rows,
        IReadOnlyList<string> sellingSizes)
    {
        var rawText = string.Join(
                "\n",
                new[] { string.Join(" | ", chart.Headers) }
                    .Concat(rows.Select(row => string.Join(" | ", row.Cells))))
            .Trim();
        return new SizeChartDto
        {
            Found = chart.Found,
            Title = chart.Title,
            Unit = chart.Unit,
            Headers = chart.Headers,
            Rows = rows,
            RawText = string.IsNullOrWhiteSpace(rawText) ? chart.RawText : rawText,
            SellingSizes = sellingSizes
        };
    }
}
