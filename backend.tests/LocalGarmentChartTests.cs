using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class LocalGarmentChartTests
{
    [Fact]
    public void ReadsTurkishHalfChestTableInsteadOfUnknown()
    {
        var engine = new LocalFitRecommendationEngine(
            new RegionalFitFeedbackService(),
            new ProductIdentityService(),
            new ProductFitTaxonomyService());

        var result = engine.Analyze(
            new UserProfile
            {
                UserId = "tester-chart-read",
                Age = 28,
                HeightCm = 178,
                WeightKg = 75,
                ShoulderWidthCm = 45,
                ChestCircumferenceCm = 106,
                WaistCircumferenceCm = 86,
                FitPreference = FitPreference.TrueToSize
            },
            [],
            new AnalyzeRecommendationRequest
            {
                UserId = "tester-chart-read",
                Product = new ProductDto
                {
                    Url = "http://127.0.0.1:8199/tee.html",
                    Brand = "Zara",
                    Name = "Heavyweight cotton tee",
                    FitLabel = "Regular fit",
                    Description = "Ağır gramajlı pamuklu tişört"
                },
                SizeChart = new SizeChartDto
                {
                    Found = true,
                    Title = "Beden tablosu (cm)",
                    Unit = "Centimeters",
                    Headers = ["Beden", "Göğüs eni (cm)", "Omuz (cm)", "Uzunluk (cm)"],
                    Rows =
                    [
                        new SizeChartRowDto { Cells = ["XS", "48", "40", "68"] },
                        new SizeChartRowDto { Cells = ["S", "50", "42", "70"] },
                        new SizeChartRowDto { Cells = ["M", "53", "44", "72"] },
                        new SizeChartRowDto { Cells = ["L", "56", "46", "74"] },
                        new SizeChartRowDto { Cells = ["XL", "59", "48", "76"] }
                    ],
                    RawText = "Beden | Göğüs eni (cm) | Omuz (cm) | Uzunluk (cm)\nXS | 48 | 40 | 68\nS | 50 | 42 | 70\nM | 53 | 44 | 72\nL | 56 | 46 | 74\nXL | 59 | 48 | 76"
                }
            });

        Assert.False(
            string.Equals(result.RecommendedSize, "Bilinmiyor", StringComparison.OrdinalIgnoreCase),
            result.Explanation);
        Assert.Contains(
            result.RecommendedSize,
            new[] { "S", "M", "L" },
            StringComparer.OrdinalIgnoreCase);
    }
}
