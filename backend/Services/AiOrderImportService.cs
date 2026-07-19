using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class AiOrderImportService(
    GeminiOrderImportClient geminiClient,
    OpenAiOrderImportClient openAiClient,
    IOptions<AiProviderOptions> providerOptions)
{
    public async Task<OrderImportAnalysis> AnalyzeAsync(
        AnalyzeOrderHistoryRequest request,
        CancellationToken cancellationToken)
    {
        OrderImportAnalysis analysis;
        if (providerOptions.Value.IsGemini)
        {
            analysis = await geminiClient.AnalyzeAsync(
                request,
                cancellationToken);
        }
        else if (providerOptions.Value.IsOpenAi)
        {
            analysis = await openAiClient.AnalyzeAsync(
                request,
                cancellationToken);
        }
        else
        {
            throw new InvalidOperationException(
                $"Desteklenmeyen AI sağlayıcısı: '{providerOptions.Value.Provider}'. " +
                "Ai:Provider değerini Gemini veya OpenAI yapın.");
        }

        return MergeStructuredDomEvidence(analysis, request);
    }

    private static OrderImportAnalysis MergeStructuredDomEvidence(
        OrderImportAnalysis analysis,
        AnalyzeOrderHistoryRequest request)
    {
        var structuredCards = request.OrderCards
            .Where(card =>
                !string.IsNullOrWhiteSpace(card.Brand) &&
                !string.IsNullOrWhiteSpace(card.ProductName) &&
                !string.IsNullOrWhiteSpace(card.PurchasedSize))
            .ToArray();
        if (structuredCards.Length == 0)
        {
            return analysis;
        }

        var merged = analysis.Items.ToList();
        foreach (var card in structuredCards)
        {
            var matchingIndex = merged.FindIndex(item =>
                ProductNamesMatch(
                    item.ProductName,
                    card.ProductName));
            var fitLabel = DetectFitLabel(card.ProductName);
            var evidence =
                "Bershka sipariş detayındaki görünür ürün adı, fotoğraf ve satın alınan beden aynı kartta doğrulandı.";

            if (matchingIndex >= 0)
            {
                var existing = merged[matchingIndex];
                merged[matchingIndex] = existing with
                {
                    IsApparel = true,
                    Brand = card.Brand.Trim(),
                    ProductName = card.ProductName.Trim(),
                    PurchasedSize =
                        card.PurchasedSize.Trim().ToUpperInvariant(),
                    Category =
                        existing.Category.Equals(
                            "Other",
                            StringComparison.OrdinalIgnoreCase)
                            ? DetectCategory(card.ProductName)
                            : existing.Category,
                    Evidence = string.IsNullOrWhiteSpace(existing.Evidence)
                        ? evidence
                        : $"{existing.Evidence.Trim()} {evidence}",
                    ProductUrl = string.IsNullOrWhiteSpace(
                        existing.ProductUrl)
                        ? card.ProductLinks.FirstOrDefault() ?? ""
                        : existing.ProductUrl,
                    FitLabel = string.IsNullOrWhiteSpace(existing.FitLabel)
                        ? fitLabel
                        : existing.FitLabel,
                    ResearchConfidence = Math.Max(
                        existing.ResearchConfidence,
                        58)
                };
                continue;
            }

            merged.Add(new ResearchedOrder(
                true,
                card.Brand.Trim(),
                card.ProductName.Trim(),
                DetectCategory(card.ProductName),
                card.PurchasedSize.Trim().ToUpperInvariant(),
                OrderOutcome.PurchasedUnknownFit,
                evidence,
                null,
                null,
                null,
                null,
                null,
                null,
                card.ProductLinks.FirstOrDefault() ?? "",
                "",
                fitLabel,
                "",
                false,
                58));
        }

        return analysis with
        {
            Items = merged,
            Summary =
                $"{analysis.Summary.Trim()} Bershka sipariş detayındaki {structuredCards.Length} ürün kartının adı ve bedeni DOM kanıtıyla korundu.".Trim(),
            DataSource = $"{analysis.DataSource}+structured-dom"
        };
    }

    private static bool ProductNamesMatch(
        string left,
        string right)
    {
        var leftKey = NormalizeKey(left);
        var rightKey = NormalizeKey(right);
        return leftKey.Length >= 4 &&
               rightKey.Length >= 4 &&
               (leftKey.Contains(rightKey, StringComparison.Ordinal) ||
                rightKey.Contains(leftKey, StringComparison.Ordinal));
    }

    private static string NormalizeKey(string value)
    {
        return string.Concat(
            value
                .Trim()
                .ToUpperInvariant()
                .Where(char.IsLetterOrDigit));
    }

    private static string DetectCategory(string productName)
    {
        var value = productName.ToLowerInvariant();
        if (ContainsAny(value, "jean", "denim"))
        {
            return "Denim";
        }
        if (ContainsAny(
                value,
                "pantolon",
                "trouser",
                "pants",
                "şort",
                "short",
                "etek",
                "skirt"))
        {
            return "Bottoms";
        }
        if (ContainsAny(
                value,
                "tişört",
                "t-shirt",
                "tee",
                "top",
                "polo",
                "bluz",
                "blouse"))
        {
            return "Tops";
        }
        if (ContainsAny(value, "gömlek", "shirt"))
        {
            return "Shirts";
        }
        if (ContainsAny(
                value,
                "sweat",
                "hoodie",
                "kazak",
                "triko",
                "hırka",
                "knit"))
        {
            return "Knitwear";
        }
        if (ContainsAny(
                value,
                "ceket",
                "jacket",
                "mont",
                "kaban",
                "coat",
                "parka",
                "blazer"))
        {
            return "Outerwear";
        }
        return ContainsAny(
            value,
            "elbise",
            "dress",
            "tulum",
            "jumpsuit")
            ? "Dresses"
            : "Other";
    }

    private static string DetectFitLabel(string productName)
    {
        var value = productName.ToLowerInvariant();
        if (ContainsAny(
                value,
                "super baggy",
                "ultra baggy",
                "extra baggy"))
        {
            return "Super Baggy Fit";
        }
        if (value.Contains("baggy", StringComparison.Ordinal))
        {
            return "Baggy Fit";
        }
        if (value.Contains("straight", StringComparison.Ordinal))
        {
            return "Straight Fit";
        }
        if (value.Contains("wide leg", StringComparison.Ordinal))
        {
            return "Wide Leg";
        }
        if (value.Contains("relaxed", StringComparison.Ordinal))
        {
            return "Relaxed Fit";
        }
        if (value.Contains("regular", StringComparison.Ordinal))
        {
            return "Regular Fit";
        }
        if (value.Contains("skinny", StringComparison.Ordinal))
        {
            return "Skinny Fit";
        }
        if (value.Contains("slim", StringComparison.Ordinal))
        {
            return "Slim Fit";
        }
        if (value.Contains("boxy", StringComparison.Ordinal))
        {
            return "Boxy Fit";
        }
        return value.Contains("oversize", StringComparison.Ordinal)
            ? "Oversize Fit"
            : "";
    }

    private static bool ContainsAny(
        string value,
        params string[] candidates)
    {
        return candidates.Any(candidate =>
            value.Contains(candidate, StringComparison.Ordinal));
    }
}
