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

    [StringLength(24000)]
    public string AccessibilityText { get; init; } = "";

    [StringLength(24000)]
    public string OcrText { get; init; } = "";

    [Required]
    public required string ScreenshotDataUrl { get; init; }

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";
}

public sealed record VisionProductScanResponse(
    ProductDto Product,
    SizeChartDto SizeChart,
    DateTimeOffset CapturedAt);

public sealed class AgentProductScanRequest
{
    [Required, Url, StringLength(1000)]
    public required string Url { get; init; }

    [Required, StringLength(128, MinimumLength = 8)]
    public required string RequestId { get; init; }

    [Required, StringLength(40)]
    public required string SourcePlatform { get; init; }

    [StringLength(300)]
    public string UserAgentHint { get; init; } = "";

    [RegularExpression("^(tr|en)$")]
    public string Language { get; init; } = "tr";

    [Range(8000, 30000)]
    public int MaxWaitMs { get; init; } = 20000;
}

public sealed record AgentSizeTableRow(
    string Size,
    IReadOnlyDictionary<string, string> Measurements);

public sealed record AgentRawSourcesMeta(
    int JsonLdDocuments,
    int DomTextLength,
    int XhrResponses,
    int SameOriginFrames,
    int OpenShadowRoots,
    IReadOnlyList<string> MaskedSourceHints);

public sealed record AgentProductScanResponse(
    string RequestId,
    string Url,
    string Brand,
    string ProductName,
    IReadOnlyList<string> AvailableSizes,
    IReadOnlyList<string> UnavailableSizes,
    string SizeChartUrl,
    IReadOnlyList<AgentSizeTableRow> SizeTable,
    string FitDescription,
    double Confidence,
    string Source,
    IReadOnlyList<string> Notes,
    long ExtractionTimeMs,
    int ExtractionStatusCode,
    AgentRawSourcesMeta RawSources);
