using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class FitRecommendation
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

    [MaxLength(30)]
    public required string RecommendedSize { get; set; }

    public int Confidence { get; set; }

    [MaxLength(240)]
    public required string Verdict { get; set; }

    [MaxLength(1600)]
    public required string Explanation { get; set; }

    [MaxLength(120)]
    public required string EvidenceSummary { get; set; }

    [MaxLength(40)]
    public required string DataSource { get; set; }

    public required string ComparisonsJson { get; set; }

    public required string FitNotesJson { get; set; }

    public string StyleJson { get; set; } = "{}";

    public DateTimeOffset CreatedAt { get; set; }
}
