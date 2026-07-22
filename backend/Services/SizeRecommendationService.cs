using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class SizeRecommendationService(
    LocalFitRecommendationEngine localEngine,
    OpenAiRecommendationClient openAiClient,
    GeminiRecommendationClient geminiClient,
    IOptions<OpenAiOptions> openAiOptions,
    IOptions<GeminiOptions> geminiOptions,
    IOptions<AiProviderOptions> providerOptions,
    ProductIdentityService productIdentityService,
    ProductCategoryService productCategoryService,
    ProductFitTaxonomyService fitTaxonomy,
    WardrobeStylistService wardrobeStylistService,
    RegionalFitFeedbackService regionalFeedback,
    ILogger<SizeRecommendationService> logger) : ISizeRecommendationService
{
    public async Task<RecommendationResult> RecommendAsync(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        AnalyzeRecommendationRequest request,
        CancellationToken cancellationToken)
    {
        var categoryOrders = productCategoryService.SelectForProduct(
            orders,
            request.Product);
        var localResult = localEngine.Analyze(
            profile,
            categoryOrders,
            request) with
        {
            Style = wardrobeStylistService.BuildLocal(
                profile,
                orders,
                request.Product)
        };
        var keepLocalSizing =
            string.IsNullOrWhiteSpace(request.UserAdjustmentNote) &&
            localResult.DataSource is
                "local-category-history" or
                "local-model-reference" or
                "local-body-label-estimate" or
                "local-footwear-size" or
                "local-insufficient";

        var provider = providerOptions.Value;
        var providerConfigured =
            provider.IsGemini && !string.IsNullOrWhiteSpace(geminiOptions.Value.ApiKey) ||
            provider.IsOpenAi && !string.IsNullOrWhiteSpace(openAiOptions.Value.ApiKey);
        if (!providerConfigured)
        {
            return ApplyEvidenceScope(
                localResult,
                categoryOrders,
                request);
        }

        RecommendationResult result;
        try
        {
            if (provider.IsGemini)
            {
                result = await geminiClient.GenerateAsync(
                    profile,
                    categoryOrders,
                    orders,
                    request,
                    localResult,
                    cancellationToken);
                if (keepLocalSizing)
                {
                    result = PreserveLocalSizing(localResult, result.Style);
                }
                result = EnforceStructuralGuard(
                    result,
                    localResult,
                    profile,
                    request);
                return ApplyEvidenceScope(
                    result,
                    categoryOrders,
                    request);
            }

            if (provider.IsOpenAi)
            {
                result = await openAiClient.GenerateAsync(
                    profile,
                    categoryOrders,
                    orders,
                    request,
                    localResult,
                    cancellationToken);
                if (keepLocalSizing)
                {
                    result = PreserveLocalSizing(localResult, result.Style);
                }
                result = EnforceStructuralGuard(
                    result,
                    localResult,
                    profile,
                    request);
                return ApplyEvidenceScope(
                    result,
                    categoryOrders,
                    request);
            }

            throw new InvalidOperationException(
                $"Desteklenmeyen AI sağlayıcısı: '{provider.Provider}'.");
        }
        catch (Exception exception) when (
            ShouldFallback(provider, openAiOptions.Value, geminiOptions.Value) &&
            exception is not OperationCanceledException)
        {
            logger.LogWarning(
                exception,
                "{Provider} sizing analysis failed; returning the deterministic fit analysis.",
                provider.Provider);
            result = localResult with
            {
                DataSource = "local-fallback",
                FitNotes = localResult.FitNotes
                    .Append(
                        "AI servisine ulaşılamadığı için bu sonuç yerel ölçü motoruyla üretildi.")
                    .Take(5)
                    .ToArray()
            };
            return ApplyEvidenceScope(
                result,
                categoryOrders,
                request);
        }
    }

    private RecommendationResult EnforceStructuralGuard(
        RecommendationResult aiResult,
        RecommendationResult localResult,
        UserProfile profile,
        AnalyzeRecommendationRequest request)
    {
        if (localEngine.IsStructurallyPlausible(
                profile,
                request.SizeChart,
                request.Product,
                aiResult.RecommendedSize))
        {
            return aiResult;
        }

        return localResult with
        {
            Style = aiResult.Style,
            FitNotes = localResult.FitNotes
                .Prepend(
                    "AI seçimi omuz/göğüs fiziksel uygunluk sınırını aştığı için yerel ölçü kararı korundu.")
                .Take(5)
                .ToArray(),
            DataSource = "local-guard"
        };
    }

    private static RecommendationResult PreserveLocalSizing(
        RecommendationResult localResult,
        WardrobeStyleDto aiStyle)
    {
        return localResult with
        {
            Style = aiStyle
        };
    }

    private RecommendationResult ApplyEvidenceScope(
        RecommendationResult result,
        IReadOnlyList<OrderHistoryItem> categoryOrders,
        AnalyzeRecommendationRequest request)
    {
        var familyResult = ApplyProductFamilyEvidence(
            result,
            categoryOrders,
            request);
        var categoryLabel =
            productCategoryService.GetTurkishLabel(request.Product);
        var activeFit = fitTaxonomy.Describe(request.Product);
        var excludedFitCount = categoryOrders.Count(order =>
        {
            var sameProductFamily =
                productIdentityService.IsSameFamily(
                    order,
                    request.Product);
            return !fitTaxonomy.IsSizingEvidenceEligible(
                order,
                request.Product,
                sameProductFamily);
        });
        var fitScopeNote =
            activeFit.Family == ProductFitFamily.Unknown
                ? "Aktif ürünün resmi kalıbı doğrulanamadı; farklı kalıptaki beden sonuçları sınır kabul edilmedi."
                : excludedFitCount > 0
                    ? $"Kalıp koruması aktif: {activeFit.Label}; {excludedFitCount} farklı fit kaydı beden sınırının dışında bırakıldı."
                    : $"Kalıp koruması aktif: beden kanıtı {activeFit.Label} ailesi içinde değerlendirildi.";
        var silhouetteWarning =
            $"{activeFit.Label}: {activeFit.Silhouette} {activeFit.SizingRule}".Trim();
        return familyResult with
        {
            FitNotes = familyResult.FitNotes
                .Prepend(fitScopeNote)
                .Prepend(silhouetteWarning)
                .Prepend(
                    $"Kategori koruması aktif: analiz yalnız {categoryLabel.ToLowerInvariant()} hafızasıyla yapıldı.")
                .Take(6)
                .ToArray(),
            Explanation =
                $"{silhouetteWarning} {familyResult.Explanation}".Trim(),
            EvidenceSummary =
                $"{categoryLabel} · {activeFit.Label} · {familyResult.EvidenceSummary}"
        };
    }

    private RecommendationResult ApplyProductFamilyEvidence(
        RecommendationResult result,
        IReadOnlyList<OrderHistoryItem> orders,
        AnalyzeRecommendationRequest request)
    {
        var sameFamily = orders
            .Where(order => productIdentityService.IsSameFamily(
                order,
                request.Product))
            .ToArray();
        var confirmedKept = sameFamily
            .Where(order => order.Outcome == OrderOutcome.KeptGoodFit)
            .Where(order => !regionalFeedback.HasNegativeSignal(
                order.UserFitNotes))
            .ToArray();
        if (confirmedKept.Length == 0)
        {
            return result;
        }

        var sizes = localEngine.GetAvailableSizes(
            request.SizeChart,
            request.Product);
        var strongestSize = confirmedKept
            .GroupBy(order => order.PurchasedSize, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(group => group.Count())
            .ThenByDescending(group => group.Max(order => order.UpdatedAt))
            .Select(group => group.Key)
            .FirstOrDefault();
        if (string.IsNullOrWhiteSpace(strongestSize) ||
            !sizes.Contains(strongestSize, StringComparer.OrdinalIgnoreCase))
        {
            return result;
        }

        var archivedFitLabels = confirmedKept
            .Select(order => order.FitLabel)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Cast<string>()
            .ToArray();
        if (!fitTaxonomy.AreFitLabelsCompatible(
                request.Product.FitLabel,
                archivedFitLabels))
        {
            return result with
            {
                FitNotes = result.FitNotes
                    .Prepend(
                        "Aynı ürün ailesi bulundu ancak resmi kalıp etiketi değiştiği için önceki beden zorlanmadı.")
                    .Take(5)
                    .ToArray()
            };
        }

        var exemplar = confirmedKept
            .OrderByDescending(order => order.UpdatedAt)
            .First();
        var fitLabelNote = string.IsNullOrWhiteSpace(request.Product.FitLabel)
            ? "Aktif sayfada ayrıca bir kalıp etiketi okunamadı."
            : $"Resmi sayfadaki kalıp: {request.Product.FitLabel}.";
        return result with
        {
            RecommendedSize = strongestSize.ToUpperInvariant(),
            Confidence = Math.Clamp(
                Math.Max(result.Confidence, 84),
                35,
                90),
            Verdict =
                $"{strongestSize.ToUpperInvariant()}, aynı modelin sende doğrulanmış bedeni.",
            Explanation =
                $"Arşivindeki {exemplar.ProductName} ürününün {strongestSize.ToUpperInvariant()} bedeni sende iyi olmuş. " +
                "Aktif ürün aynı model/renk varyantı ailesiyle eşleştiği için bu gerçek kullanım kanıtı genel beden tahmininden daha güçlü kabul edildi.",
            FitNotes = result.FitNotes
                .Prepend(fitLabelNote)
                .Prepend(
                    "Renk değişimi tek başına beden değişikliği sayılmadı; ürün kodu ve resmi sayfa kimliği eşleştirildi.")
                .Take(5)
                .ToArray(),
            Comparisons = result.Comparisons
                .Prepend(new ComparisonDto(
                    "Aynı model",
                    $"Arşivde iyi uyum: {strongestSize.ToUpperInvariant()}"))
                .Take(5)
                .ToArray(),
            EvidenceSummary =
                $"{confirmedKept.Length} aynı model iyi uyum · {result.EvidenceSummary}",
            DataSource = $"{result.DataSource}-family-match"
        };
    }

    private static bool ShouldFallback(
        AiProviderOptions provider,
        OpenAiOptions openAi,
        GeminiOptions gemini)
    {
        return provider.IsGemini
            ? gemini.FallbackOnError
            : provider.IsOpenAi && openAi.FallbackOnError;
    }
}
