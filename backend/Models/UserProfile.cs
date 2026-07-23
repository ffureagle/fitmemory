using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class UserProfile
{
    public int Id { get; set; }

    public int? UserAccountId { get; set; }

    public UserAccount? UserAccount { get; set; }

    [MaxLength(128)]
    public required string UserId { get; set; }

    public int? Age { get; set; }

    public decimal HeightCm { get; set; }

    public decimal WeightKg { get; set; }

    public decimal ShoulderWidthCm { get; set; }

    public decimal? ChestCircumferenceCm { get; set; }

    public decimal WaistCircumferenceCm { get; set; }

    public decimal? FootLengthCm { get; set; }

    public decimal? UsualShoeSizeEu { get; set; }

    public FitPreference FitPreference { get; set; } = FitPreference.TrueToSize;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public ICollection<OrderHistoryItem> Orders { get; set; } = new List<OrderHistoryItem>();

    public ICollection<FitRecommendation> Recommendations { get; set; } = new List<FitRecommendation>();

    public ICollection<StyleBoardItem> StyleBoardItems { get; set; } =
        new List<StyleBoardItem>();

    public ICollection<FavoriteOutfit> FavoriteOutfits { get; set; } =
        new List<FavoriteOutfit>();
}
