using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Contracts;

public sealed class SaveStyleBoardItemRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required]
    public required ProductDto Product { get; init; }

    [StringLength(30)]
    public string RecommendedSize { get; init; } = "";

    [Range(0, 95)]
    public int RecommendationConfidence { get; init; }
}

public sealed class AnalyzeStyleBoardRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";
}

public sealed record StyleBoardItemResponse(
    int Id,
    string UserId,
    string ProductUrl,
    string Brand,
    string ProductName,
    string Category,
    string Price,
    string ImageUrl,
    string ProductReference,
    string FitLabel,
    string FitEvidence,
    string Description,
    string RecommendedSize,
    int RecommendationConfidence,
    bool IsSelected,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record StyleBoardAnalysisResponse(
    string Verdict,
    int Score,
    string Headline,
    string Explanation,
    IReadOnlyList<string> Notes,
    string SeasonContext,
    DateTimeOffset CreatedAt);
