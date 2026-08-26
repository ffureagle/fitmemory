using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static class SizeChartAligner
{
    private static readonly string[] LetterOrder =
        ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

    public static SizeChartDto Align(SizeChartDto chart)
    {
        var selling = DistinctSizes(chart.SellingSizes);
        var letters = selling
            .Where(IsLetter)
            .OrderBy(LetterRank)
            .ToArray();
        if (letters.Length < 2)
        {
            return selling.Length == 0 ? chart : Clone(chart, chart.Rows, selling);
        }

        var letterRows = chart.Rows
            .Where(row => row.Cells.Count > 0 &&
                          IsLetter(ProductScanEvidenceValidator.NormalizeSize(row.Cells[0])))
            .ToArray();
        if (letterRows.Length >= 2)
        {
            return Clone(chart, letterRows, letters);
        }

        var numericRows = chart.Rows
            .Where(row => row.Cells.Count > 0 &&
                          IsEvenEu(ProductScanEvidenceValidator.NormalizeSize(row.Cells[0])))
            .OrderBy(row => int.Parse(ProductScanEvidenceValidator.NormalizeSize(row.Cells[0])))
            .ToArray();
        if (numericRows.Length == letters.Length)
        {
            var relabeled = numericRows.Select((row, index) => new SizeChartRowDto
            {
                Cells = [letters[index], .. row.Cells.Skip(1)]
            }).ToArray();
            return Clone(chart, relabeled, letters);
        }

        return Clone(chart, chart.Rows, letters);
    }

    public static bool IsLetter(string size) =>
        Array.Exists(LetterOrder, item =>
            item.Equals(size, StringComparison.OrdinalIgnoreCase));

    public static bool IsEvenEu(string size) =>
        int.TryParse(size, out var value) &&
        value is >= 32 and <= 52 &&
        value % 2 == 0;

    private static int LetterRank(string size)
    {
        var index = Array.FindIndex(LetterOrder, item =>
            item.Equals(size, StringComparison.OrdinalIgnoreCase));
        return index < 0 ? int.MaxValue : index;
    }

    private static string[] DistinctSizes(IReadOnlyList<string>? sizes) =>
        (sizes ?? [])
        .Select(ProductScanEvidenceValidator.NormalizeSize)
        .Where(size => size.Length > 0 &&
                       ProductScanEvidenceValidator.IsValidSizeLabel(size))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private static SizeChartDto Clone(
        SizeChartDto chart,
        IReadOnlyList<SizeChartRowDto> rows,
        IReadOnlyList<string> sellingSizes)
    {
        var rawText = rows.Count == chart.Rows.Count &&
                      sellingSizes.Count == chart.SellingSizes.Count
            ? chart.RawText
            : string.Join(
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
