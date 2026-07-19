using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public sealed record RecommendationResult(
    string RecommendedSize,
    int Confidence,
    string Verdict,
    string Explanation,
    IReadOnlyList<string> FitNotes,
    IReadOnlyList<ComparisonDto> Comparisons,
    string EvidenceSummary,
    string DataSource)
{
    public WardrobeStyleDto Style { get; init; } = WardrobeStyleDto.Empty;
}
