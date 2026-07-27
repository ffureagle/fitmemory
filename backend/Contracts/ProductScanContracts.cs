using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Contracts;

public sealed class VisionProductScanRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required]
    public required ProductDto Product { get; init; }

    [StringLength(20000)]
    public string PageText { get; init; } = "";

    [Required]
    public required string ScreenshotDataUrl { get; init; }

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";
}

public sealed record VisionProductScanResponse(
    ProductDto Product,
    SizeChartDto SizeChart,
    DateTimeOffset CapturedAt);
