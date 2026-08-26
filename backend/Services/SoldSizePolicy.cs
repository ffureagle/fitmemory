using FitMemory.Api.Contracts;

namespace FitMemory.Api.Services;

public static class SoldSizePolicy
{
    public static RecommendationResult Apply(
        RecommendationResult result,
        IReadOnlyList<string> legalSizes)
    {
        if (string.Equals(result.RecommendedSize, "Bilinmiyor", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(result.RecommendedSize) ||
            legalSizes.Count < 2)
        {
            return result;
        }

        if (legalSizes.Contains(result.RecommendedSize.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            return result;
        }

        return result with
        {
            RecommendedSize = "Bilinmiyor",
            Confidence = 0,
            Verdict = "Sayfada satılan bedenlerden biri seçilemedi.",
            Explanation =
                "Önerilen beden bu ürünün satış listesinde yok. FitMemory yalnızca sayfada tıklanabilen bedenlerden birini yazar.",
            DataSource = "sold-size-guard",
            Comparisons = []
        };
    }
}
