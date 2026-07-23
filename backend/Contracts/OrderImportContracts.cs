using System.ComponentModel.DataAnnotations;
using FitMemory.Api.Models;

namespace FitMemory.Api.Contracts;

public sealed class AnalyzeOrderHistoryRequest : IValidatableObject
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required, StringLength(1000, MinimumLength = 1)]
    public required string PageUrl { get; init; }

    [StringLength(240)]
    public string PageTitle { get; init; } = "";

    [StringLength(120)]
    public string Retailer { get; init; } = "";

    [StringLength(30_000)]
    public string SanitizedText { get; init; } = "";

    [StringLength(6_500_000)]
    public string? ScreenshotDataUrl { get; init; }

    [MaxLength(25)]
    public IReadOnlyList<OrderCardDto> OrderCards { get; init; } = [];

    [MaxLength(6)]
    public IReadOnlyList<ProductPageResearchDto> ProductPageResearch { get; init; } = [];

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (OrderCards.Count == 0)
        {
            yield return new ValidationResult(
                "Taranabilecek görünür bir sipariş kartı bulunamadı.",
                [nameof(OrderCards)]);
        }

        if (string.IsNullOrWhiteSpace(ScreenshotDataUrl) ||
            !ScreenshotDataUrl.StartsWith("data:image/jpeg;base64,", StringComparison.Ordinal))
        {
            yield return new ValidationResult(
                "Kırpılmış JPEG ekran görüntüsü gereklidir.",
                [nameof(ScreenshotDataUrl)]);
        }
    }
}

public sealed class OrderCardDto
{
    [Required, StringLength(4_000, MinimumLength = 3)]
    public required string Text { get; init; }

    [StringLength(100)]
    public string Brand { get; init; } = "";

    [StringLength(240)]
    public string ProductName { get; init; } = "";

    [StringLength(30)]
    public string PurchasedSize { get; init; } = "";

    [MaxLength(8)]
    public IReadOnlyList<string> ProductLinks { get; init; } = [];

    [StringLength(500)]
    public string ImageAlt { get; init; } = "";

    [StringLength(2_000)]
    public string ImageUrl { get; init; } = "";

    [MaxLength(12)]
    public IReadOnlyList<OrderCardImageDto> Images { get; init; } = [];
}

public sealed class OrderCardImageDto
{
    [Required, Url, StringLength(2_000)]
    public required string Url { get; init; }

    [StringLength(500)]
    public string Alt { get; init; } = "";

    [Url, StringLength(1_000)]
    public string ProductUrl { get; init; } = "";
}

public sealed class ProductPageResearchDto
{
    [Required]
    public required ProductDto Product { get; init; }

    public SizeChartDto? SizeChart { get; init; }

    [StringLength(80)]
    public string FitLabel { get; init; } = "";

    [StringLength(5000)]
    public string PageText { get; init; } = "";
}

public sealed record ImportedOrderItemResponse(
    string Brand,
    string ProductName,
    string PurchasedSize,
    OrderOutcome Outcome,
    int ResearchConfidence,
    string ResearchSourceUrl,
    bool Added,
    bool Updated,
    string Note);

public sealed record OrderImportResponse(
    int DetectedCount,
    int ImportedCount,
    int UpdatedCount,
    int SkippedCount,
    string Summary,
    string DataSource,
    IReadOnlyList<ImportedOrderItemResponse> Items,
    IReadOnlyList<OrderResponse> Orders);
