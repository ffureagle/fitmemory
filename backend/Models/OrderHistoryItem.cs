using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class OrderHistoryItem
{
    public int Id { get; set; }

    public int UserProfileId { get; set; }

    public required UserProfile UserProfile { get; set; }

    [MaxLength(100)]
    public required string Brand { get; set; }

    [MaxLength(160)]
    public required string ProductName { get; set; }

    [MaxLength(60)]
    public required string Category { get; set; }

    [MaxLength(30)]
    public required string PurchasedSize { get; set; }

    public OrderOutcome Outcome { get; set; }

    public bool ReturnConfirmedByUser { get; set; }

    [MaxLength(500)]
    public string? FitNotes { get; set; }

    [MaxLength(500)]
    public string? UserFitNotes { get; set; }

    public decimal? ChestWidthCm { get; set; }

    public decimal? ShoulderWidthCm { get; set; }

    public decimal? WaistWidthCm { get; set; }

    public decimal? LengthCm { get; set; }

    public decimal? SleeveLengthCm { get; set; }

    public decimal? InseamCm { get; set; }

    [MaxLength(1000)]
    public string? ProductUrl { get; set; }

    [MaxLength(2000)]
    public string? ImageUrl { get; set; }

    [MaxLength(200)]
    public string? ProductFamilyKey { get; set; }

    [MaxLength(1000)]
    public string? ResearchSourceUrl { get; set; }

    [MaxLength(80)]
    public string? FitLabel { get; set; }

    [MaxLength(500)]
    public string? SizeEvidence { get; set; }

    [MaxLength(240)]
    public string? MaterialSummary { get; set; }

    [MaxLength(1600)]
    public string? MaterialEvidence { get; set; }

    public int ResearchConfidence { get; set; }

    public int? FitScore { get; set; }

    [MaxLength(500)]
    public string? FitAssessment { get; set; }

    public int FitAssessmentConfidence { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
