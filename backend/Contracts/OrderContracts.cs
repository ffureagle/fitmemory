using System.ComponentModel.DataAnnotations;
using FitMemory.Api.Models;

namespace FitMemory.Api.Contracts;

public sealed class SaveOrderRequest
{
    [Required, StringLength(128, MinimumLength = 8)]
    public required string UserId { get; init; }

    [Required, StringLength(100, MinimumLength = 1)]
    public required string Brand { get; init; }

    [Required, StringLength(160, MinimumLength = 1)]
    public required string ProductName { get; init; }

    [Required, StringLength(60, MinimumLength = 1)]
    public required string Category { get; init; }

    [Required, StringLength(30, MinimumLength = 1)]
    public required string PurchasedSize { get; init; }

    [EnumDataType(typeof(OrderOutcome))]
    public OrderOutcome Outcome { get; init; }

    public bool ReturnConfirmedByUser { get; init; }

    [StringLength(500)]
    public string? FitNotes { get; init; }

    [StringLength(500)]
    public string? UserFitNotes { get; init; }

    [Range(20, 150)]
    public decimal? ChestWidthCm { get; init; }

    [Range(20, 180)]
    public decimal? ShoulderWidthCm { get; init; }

    [Range(20, 130)]
    public decimal? WaistWidthCm { get; init; }

    [Range(20, 180)]
    public decimal? LengthCm { get; init; }

    [Range(10, 120)]
    public decimal? SleeveLengthCm { get; init; }

    [Range(20, 130)]
    public decimal? InseamCm { get; init; }

    [Url, StringLength(1000)]
    public string? ProductUrl { get; init; }

    [Url, StringLength(2000)]
    public string? ImageUrl { get; init; }

    [Url, StringLength(1000)]
    public string? ResearchSourceUrl { get; init; }

    [StringLength(80)]
    public string? FitLabel { get; init; }

    [StringLength(500)]
    public string? SizeEvidence { get; init; }

    [Range(0, 95)]
    public int ResearchConfidence { get; init; }
}

public sealed class UpdateOrderFeedbackRequest
{
    [EnumDataType(typeof(OrderOutcome))]
    public OrderOutcome Outcome { get; init; }

    public bool ReturnConfirmedByUser { get; init; }

    [StringLength(500)]
    public string? UserFitNotes { get; init; }
}

public sealed record OrderResponse(
    int Id,
    string UserId,
    string Brand,
    string ProductName,
    string Category,
    string PurchasedSize,
    OrderOutcome Outcome,
    bool ReturnConfirmedByUser,
    string? FitNotes,
    string? UserFitNotes,
    decimal? ChestWidthCm,
    decimal? ShoulderWidthCm,
    decimal? WaistWidthCm,
    decimal? LengthCm,
    decimal? SleeveLengthCm,
    decimal? InseamCm,
    string? ProductUrl,
    string? ImageUrl,
    string? ProductFamilyKey,
    string? ResearchSourceUrl,
    string? FitLabel,
    string? SizeEvidence,
    string? MaterialSummary,
    string? MaterialEvidence,
    int ResearchConfidence,
    int? FitScore,
    string? FitAssessment,
    int FitAssessmentConfidence,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
