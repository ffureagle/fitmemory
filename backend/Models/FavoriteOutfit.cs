using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class FavoriteOutfit
{
    public int Id { get; set; }

    public int UserProfileId { get; set; }

    public required UserProfile UserProfile { get; set; }

    [MaxLength(160)]
    public required string Title { get; set; }

    public required string AnalysisJson { get; set; }

    public required string ItemsJson { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
