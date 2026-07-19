using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Contracts;

public sealed class AnalyzeRecommendationRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required]
    public required ProductDto Product { get; init; }

    [Required]
    public required SizeChartDto SizeChart { get; init; }

    [StringLength(500)]
    public string UserAdjustmentNote { get; init; } = "";

    public bool IsReconsideration { get; init; }
}

public sealed class ProductDto
{
    [Required, StringLength(1000, MinimumLength = 1)]
    public required string Url { get; init; }

    [StringLength(120)]
    public string Brand { get; init; } = "";

    [StringLength(240)]
    public string Name { get; init; } = "";

    [StringLength(120)]
    public string Category { get; init; } = "";

    [StringLength(80)]
    public string Price { get; init; } = "";

    [StringLength(1000)]
    public string ImageUrl { get; init; } = "";

    [StringLength(120)]
    public string ProductReference { get; init; } = "";

    [StringLength(80)]
    public string FitLabel { get; init; } = "";

    [StringLength(300)]
    public string FitEvidence { get; init; } = "";

    [StringLength(1200)]
    public string Description { get; init; } = "";

    [Range(120, 230)]
    public int? ModelHeightCm { get; init; }

    [StringLength(30)]
    public string ModelWornSize { get; init; } = "";

    [StringLength(300)]
    public string ModelEvidence { get; init; } = "";
}

public sealed class SizeChartDto : IValidatableObject
{
    public bool Found { get; init; }

    [StringLength(160)]
    public string Title { get; init; } = "";

    [StringLength(30)]
    public string Unit { get; init; } = "Unknown";

    [MaxLength(12)]
    public IReadOnlyList<string> Headers { get; init; } = [];

    [MaxLength(30)]
    public IReadOnlyList<SizeChartRowDto> Rows { get; init; } = [];

    [StringLength(8000)]
    public string RawText { get; init; } = "";

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!Found)
        {
            yield return new ValidationResult(
                "Beden tablosu bulundu olarak işaretlenmelidir.",
                [nameof(Found)]);
        }

        if (Rows.Count == 0 && string.IsNullOrWhiteSpace(RawText))
        {
            yield return new ValidationResult(
                "Beden tablosu yapılandırılmış satırlar veya ham metin içermelidir.",
                [nameof(Rows), nameof(RawText)]);
        }

        if (Headers.Any(header => header.Length > 120))
        {
            yield return new ValidationResult(
                "Beden tablosu başlıkları 120 karakteri aşamaz.",
                [nameof(Headers)]);
        }
    }
}

public sealed class SizeChartRowDto : IValidatableObject
{
    [MaxLength(12)]
    public IReadOnlyList<string> Cells { get; init; } = [];

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Cells.Any(cell => cell.Length > 120))
        {
            yield return new ValidationResult(
                "Beden tablosu hücreleri 120 karakteri aşamaz.",
                [nameof(Cells)]);
        }
    }
}

public sealed record ComparisonDto(string Label, string Detail);

public sealed record StylePieceDto(
    int OrderId,
    string Brand,
    string ProductName,
    string Category,
    string PurchasedSize,
    string? ImageUrl,
    string? ProductUrl,
    string Role,
    string Reason);

public sealed record StyleOutfitDto(
    string Title,
    string Direction,
    IReadOnlyList<StylePieceDto> Pieces);

public sealed record WardrobeStyleDto(
    int CompatibleItemCount,
    int OutfitCount,
    int Confidence,
    string Headline,
    string Summary,
    string AgeContext,
    IReadOnlyList<StyleOutfitDto> Outfits)
{
    public static WardrobeStyleDto Empty { get; } = new(
        0,
        0,
        0,
        "Dolap eşleşmesi bekleniyor",
        "Dolabındaki parçalar tarandığında kombin seçenekleri burada görünür.",
        "",
        []);
}

public sealed record FitRecommendationResponse(
    int Id,
    string RecommendedSize,
    int Confidence,
    string Verdict,
    string Explanation,
    IReadOnlyList<string> FitNotes,
    IReadOnlyList<ComparisonDto> Comparisons,
    string EvidenceSummary,
    string DataSource,
    WardrobeStyleDto Style,
    DateTimeOffset CreatedAt);
