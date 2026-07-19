using FitMemory.Api.Contracts;
using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public interface ISizeRecommendationService
{
    Task<RecommendationResult> RecommendAsync(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        AnalyzeRecommendationRequest request,
        CancellationToken cancellationToken);
}

