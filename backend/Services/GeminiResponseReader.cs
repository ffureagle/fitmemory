using System.Text.Json;
using System.Text.Json.Nodes;

namespace FitMemory.Api.Services;

internal static class GeminiResponseReader
{
    public static string BuildGenerateContentEndpoint(GeminiOptions settings)
    {
        var baseUrl = settings.BaseUrl.Trim().TrimEnd('/');
        var model = Uri.EscapeDataString(settings.Model.Trim());
        return $"{baseUrl}/models/{model}:generateContent";
    }

    public static string ExtractText(string responseBody)
    {
        using var document = JsonDocument.Parse(responseBody);
        var root = document.RootElement;
        if (root.TryGetProperty("candidates", out var candidates) &&
            candidates.ValueKind == JsonValueKind.Array)
        {
            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content) ||
                    !content.TryGetProperty("parts", out var parts) ||
                    parts.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                var fragments = parts
                    .EnumerateArray()
                    .Where(part =>
                        part.TryGetProperty("text", out var text) &&
                        text.ValueKind == JsonValueKind.String)
                    .Select(part => part.GetProperty("text").GetString())
                    .Where(text => !string.IsNullOrWhiteSpace(text))
                    .ToArray();
                if (fragments.Length > 0)
                {
                    return string.Concat(fragments);
                }
            }
        }

        var blockReason = root.TryGetProperty("promptFeedback", out var feedback) &&
                          feedback.TryGetProperty("blockReason", out var reason)
            ? reason.GetString()
            : null;
        throw new InvalidOperationException(
            string.IsNullOrWhiteSpace(blockReason)
                ? "Gemini metin çıktısı döndürmedi."
                : $"Gemini isteği güvenlik filtresi tarafından engellendi: {blockReason}.");
    }

    public static (string Code, string Message) ExtractApiError(string responseBody)
    {
        try
        {
            var node = JsonNode.Parse(responseBody);
            var error = node?["error"];
            var code =
                error?["status"]?.GetValue<string>() ??
                error?["code"]?.ToJsonString() ??
                "UNKNOWN";
            var message =
                error?["message"]?.GetValue<string>() ??
                Limit(responseBody, 800);
            return (Limit(code, 100), Limit(message, 800));
        }
        catch (JsonException)
        {
            return ("UNKNOWN", Limit(responseBody, 800));
        }
    }

    public static (string MimeType, string Data) ParseImageDataUrl(string value)
    {
        const string marker = ";base64,";
        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Gemini analizi için Base64 kodlu bir görsel gereklidir.");
        }

        var markerIndex = value.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0)
        {
            throw new InvalidOperationException(
                "Gemini görsel verisi geçerli Base64 biçiminde değil.");
        }

        var mimeType = value[5..markerIndex].Trim().ToLowerInvariant();
        var data = value[(markerIndex + marker.Length)..].Trim();
        if (mimeType is not ("image/jpeg" or "image/png" or "image/webp") ||
            data.Length == 0)
        {
            throw new InvalidOperationException(
                "Gemini yalnızca JPEG, PNG veya WebP sipariş görsellerini kabul eder.");
        }

        try
        {
            _ = Convert.FromBase64String(data);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException(
                "Gemini görsel verisi geçerli Base64 içermiyor.");
        }

        return (mimeType, data);
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }
}
