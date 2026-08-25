using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static class SavedPlace
{
    public const string Wardrobe = "wardrobe";
    public const string Studio = "studio";

    public static string ForFavorite(
        string title,
        IReadOnlyList<StyleBoardItemResponse> items)
    {
        if (title.StartsWith("Dolap · ", StringComparison.Ordinal))
        {
            return Wardrobe;
        }

        if (items.Count > 0 && items.All(item => item.Id < 0))
        {
            return Wardrobe;
        }

        return Studio;
    }
}
