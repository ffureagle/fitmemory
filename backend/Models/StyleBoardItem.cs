using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class StyleBoardItem
{
    public int Id { get; set; }

    public int UserProfileId { get; set; }

    public required UserProfile UserProfile { get; set; }

    [MaxLength(1000)]
    public required string ProductUrl { get; set; }

    [MaxLength(120)]
    public required string Brand { get; set; }

    [MaxLength(240)]
    public required string ProductName { get; set; }

    [MaxLength(120)]
    public required string Category { get; set; }

    [MaxLength(80)]
    public string Price { get; set; } = "";

    [MaxLength(2000)]
    public string ImageUrl { get; set; } = "";

    [MaxLength(120)]
    public string ProductReference { get; set; } = "";

    [MaxLength(80)]
    public string FitLabel { get; set; } = "";

    [MaxLength(300)]
    public string FitEvidence { get; set; } = "";

    [MaxLength(1200)]
    public string Description { get; set; } = "";

    [MaxLength(240)]
    public string MaterialSummary { get; set; } = "";

    [MaxLength(1600)]
    public string MaterialEvidence { get; set; } = "";

    [MaxLength(30)]
    public string RecommendedSize { get; set; } = "";

    public int RecommendationConfidence { get; set; }

    public bool IsSelected { get; set; } = true;

    public bool IsInStudio { get; set; } = true;

    public bool IsSaved { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
