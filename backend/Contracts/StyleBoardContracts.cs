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

    public bool SaveToStudio { get; init; } = true;

    public bool SaveToCloset { get; init; }
}

public sealed class SaveFavoriteOutfitRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required, StringLength(160, MinimumLength = 2)]
    public required string Title { get; init; }

    [Required]
    public required StyleBoardAnalysisResponse Analysis { get; init; }

    [Required, MinLength(2), MaxLength(8)]
    public required IReadOnlyList<int> ItemIds { get; init; }
}

public sealed class AnalyzeStyleBoardRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";
}

public sealed class WardrobeOutfitRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required, StringLength(500, MinimumLength = 3)]
    public required string Prompt { get; init; }

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";
}

public sealed record WardrobeOutfitPieceResponse(
    int OrderId,
    string Brand,
    string ProductName,
    string Category,
    string PurchasedSize,
    string? ImageUrl);

public sealed record WardrobeOutfitResponse(
    StyleBoardAnalysisResponse Analysis,
    IReadOnlyList<WardrobeOutfitPieceResponse> Pieces);

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
    string MaterialSummary,
    string MaterialEvidence,
    string RecommendedSize,
    int RecommendationConfidence,
    bool IsSelected,
    bool IsInStudio,
    bool IsSaved,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record FavoriteOutfitResponse(
    int Id,
    string UserId,
    string Title,
    StyleBoardAnalysisResponse Analysis,
    IReadOnlyList<StyleBoardItemResponse> Items,
    DateTimeOffset CreatedAt);

public sealed record StyleBoardAnalysisResponse(
    string Verdict,
    int Score,
    string Headline,
    string Explanation,
    IReadOnlyList<string> Notes,
    string SeasonContext,
    DateTimeOffset CreatedAt);
