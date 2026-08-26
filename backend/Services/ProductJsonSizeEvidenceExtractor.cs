using System.Globalization;
using System.Text.Json;
using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static class ProductJsonSizeEvidenceExtractor
{
    private static readonly string[] SizeKeys =
        ["size", "sizeName", "displaySize", "label", "beden", "name", "skuSize"];

    private static readonly string[] DimensionArrayKeys =
        ["skuDimensions", "dimensions", "measurements"];

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
            CollectSizeKeyedMap(element, rows);

            var size = FindSize(element);
            if (size.Length > 0)
            {
                var measurements = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                CollectMeasurements(element, measurements, 0);
                CollectNamedDimensionArrays(element, measurements);
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

    private static void CollectSizeKeyedMap(JsonElement element, ICollection<AgentSizeTableRow> rows)
    {
        var sizeProps = new List<(string Size, JsonElement Value)>();
        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.Object) continue;
            if (!ProductScanEvidenceValidator.IsValidSizeLabel(property.Name)) continue;
            sizeProps.Add((ProductScanEvidenceValidator.NormalizeSize(property.Name), property.Value));
        }

        if (sizeProps.Count < 2) return;

        foreach (var (size, value) in sizeProps)
        {
            var measurements = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            CollectMeasurements(value, measurements, 0);
            CollectNamedDimensionArrays(value, measurements);
            if (measurements.Count > 0) rows.Add(new AgentSizeTableRow(size, measurements));
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

    private static void CollectNamedDimensionArrays(
        JsonElement element,
        IDictionary<string, string> measurements)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.Array) continue;
            if (!DimensionArrayKeys.Any(key =>
                    property.Name.Equals(key, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            CollectDimensionArray(property.Value, measurements);
        }
    }

    private static void CollectDimensionArray(
        JsonElement array,
        IDictionary<string, string> measurements)
    {
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var name = "";
            foreach (var key in new[] { "dimensionName", "name", "label", "key" })
            {
                if (!item.TryGetProperty(key, out var label) ||
                    label.ValueKind is not (JsonValueKind.String or JsonValueKind.Number))
                {
                    continue;
                }

                name = ScalarText(label);
                if (name.Length > 0) break;
            }

            var value = item.TryGetProperty("value", out var raw) ? ScalarText(raw) : "";
            if (name.Length > 0 &&
                value.Length > 0 &&
                ProductScanEvidenceValidator.IsValidMeasurement(name, value))
            {
                measurements[name] = value;
            }
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
