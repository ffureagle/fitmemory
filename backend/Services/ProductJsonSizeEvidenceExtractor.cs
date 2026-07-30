using System.Globalization;
using System.Text.Json;
using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static class ProductJsonSizeEvidenceExtractor
{
    private static readonly string[] SizeKeys =
        ["size", "sizeName", "displaySize", "label", "beden", "name"];

    public static IReadOnlyList<AgentSizeTableRow> ExtractRows(JsonElement root)
    {
        var rows = new List<AgentSizeTableRow>();
        Visit(root, rows);
        return rows
            .Select(ProductScanEvidenceValidator.NormalizeRow)
            .Where(row => row is not null)
            .Select(row => row!)
            .GroupBy(row => row.Size, StringComparer.OrdinalIgnoreCase)
            .Select(group => new AgentSizeTableRow(
                group.Key,
                group.SelectMany(row => row.Measurements)
                    .GroupBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(items => items.Key, items => items.Last().Value,
                        StringComparer.OrdinalIgnoreCase)))
            .ToArray();
    }

    private static void Visit(JsonElement element, ICollection<AgentSizeTableRow> rows)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var size = FindSize(element);
            if (size.Length > 0)
            {
                var measurements = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                CollectMeasurements(element, measurements, 0);
                if (measurements.Count > 0) rows.Add(new AgentSizeTableRow(size, measurements));
            }

            foreach (var property in element.EnumerateObject()) Visit(property.Value, rows);
            return;
        }

        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray()) Visit(item, rows);
        }
    }

    private static string FindSize(JsonElement element)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (!SizeKeys.Any(key => property.Name.Equals(key, StringComparison.OrdinalIgnoreCase))) continue;
            var candidate = ScalarText(property.Value);
            if (ProductScanEvidenceValidator.IsValidSizeLabel(candidate))
                return ProductScanEvidenceValidator.NormalizeSize(candidate);
        }
        return "";
    }

    private static void CollectMeasurements(
        JsonElement element,
        IDictionary<string, string> measurements,
        int depth)
    {
        if (element.ValueKind != JsonValueKind.Object || depth > 2) return;
        foreach (var property in element.EnumerateObject())
        {
            var scalar = ScalarText(property.Value);
            if (scalar.Length > 0 &&
                ProductScanEvidenceValidator.IsValidMeasurement(property.Name, scalar))
            {
                measurements[property.Name] = scalar;
                continue;
            }

            if (property.Value.ValueKind == JsonValueKind.Object)
                CollectMeasurements(property.Value, measurements, depth + 1);
        }
    }

    private static string ScalarText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString()?.Trim() ?? "",
        JsonValueKind.Number when value.TryGetDouble(out var number) =>
            number.ToString("0.###", CultureInfo.InvariantCulture),
        _ => ""
    };
}
