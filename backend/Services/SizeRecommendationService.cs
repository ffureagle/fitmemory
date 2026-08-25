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
        // Local engine is a draft only. Gemini/OpenAI is the final size controller.
        // Same-cut wardrobe history is supporting evidence for the AI, never a size lock.
        // Structural guard is the only post-AI override (physically impossible size).
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
                    "AI seçimi fiziksel uygunluk sınırını aştığı için yerel ölçü kararı korundu.")
                .Take(5)
                .ToArray(),
            DataSource = "local-guard"
        };
    }

    private RecommendationResult ApplyEvidenceScope(
        RecommendationResult result,
        IReadOnlyList<OrderHistoryItem> categoryOrders,
        AnalyzeRecommendationRequest request)
    {
        var familyResult = AttachWardrobeSupportEvidence(
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
        return familyResult with
        {
            EvidenceSummary =
                $"{categoryLabel} · {activeFit.Label} · {fitScopeNote} · {familyResult.EvidenceSummary}"
        };
    }

    private RecommendationResult AttachWardrobeSupportEvidence(
        RecommendationResult result,
        IReadOnlyList<OrderHistoryItem> orders,
        AnalyzeRecommendationRequest request)
    {
        var support = orders
            .Where(order =>
                productIdentityService.IsSameFamily(
                    order,
                    request.Product) ||
                fitTaxonomy.Compatibility(
                    order,
                    request.Product) >= 0.95)
            .OrderByDescending(order => order.UpdatedAt)
            .Take(4)
            .ToArray();
        if (support.Length == 0)
        {
            return result;
        }

        var briefings = support
            .Select(DescribeWardrobeSupport)
            .ToArray();
        return result with
        {
            FitNotes = result.FitNotes
                .Prepend(
                    "Aynı kesim geçmişi AI'ya destek olarak verildi; önceki beden kilitlenmedi.")
                .Prepend(briefings[0])
                .Take(6)
                .ToArray(),
            Comparisons = result.Comparisons
                .Prepend(new ComparisonDto(
                    "Dolap desteği",
                    string.Join(" · ", briefings.Take(2))))
                .Take(5)
                .ToArray(),
            EvidenceSummary =
                $"{support.Length} dolap desteği · {result.EvidenceSummary}"
        };
    }

    private static string DescribeWardrobeSupport(OrderHistoryItem order)
    {
        var note = string.IsNullOrWhiteSpace(order.UserFitNotes)
            ? ""
            : $" {order.UserFitNotes.Trim().TrimEnd('.')}.";
        return
            $"{order.ProductName}: {order.PurchasedSize.ToUpperInvariant()} {order.Outcome.ToTurkishFitSummary()}.{note}";
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
