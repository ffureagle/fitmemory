using FitMemory.Api.Contracts;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public class SavedPlaceTests
{
    [Fact]
    public void Closet_outfit_title_never_counts_as_studio()
    {
        Assert.Equal(
            SavedPlace.Wardrobe,
            SavedPlace.ForFavorite("Dolap · Akşam kombini", []));
    }

    [Fact]
    public void Closet_outfit_pieces_use_negative_order_ids()
    {
        var pieces = new[]
        {
            Item(-12),
            Item(-44),
        };
        Assert.Equal(SavedPlace.Wardrobe, SavedPlace.ForFavorite("Akşam kombini", pieces));
    }

    [Fact]
    public void Studio_favorites_stay_out_of_the_closet()
    {
        var pieces = new[]
        {
            Item(8),
            Item(9),
        };
        Assert.Equal(SavedPlace.Studio, SavedPlace.ForFavorite("Yaz kombini", pieces));
    }

    private static StyleBoardItemResponse Item(int id) => new(
        id,
        "user",
        "https://example.com/p",
        "Marka",
        "Ürün",
        "Üst",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "M",
        80,
        false,
        false,
        false,
        DateTimeOffset.UtcNow,
        DateTimeOffset.UtcNow);
}
