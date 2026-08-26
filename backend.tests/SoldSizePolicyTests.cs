using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class SoldSizePolicyTests
{
    [Fact]
    public void RejectsSizeThatIsNotSoldOnThePage()
    {
        var result = SoldSizePolicy.Apply(
            new RecommendationResult(
                "42",
                64,
                "42, bel ölçüne göre en tutarlı beden.",
                "42 beden uyduruldu.",
                [],
                [],
                "kanıt",
                "local"),
            ["XXS", "XS", "S", "M", "L", "XL"]);

        Assert.Equal("Bilinmiyor", result.RecommendedSize);
        Assert.Equal("sold-size-guard", result.DataSource);
        Assert.Equal(0, result.Confidence);
    }

    [Fact]
    public void KeepsNumericSizeWhenThePageSellsNumbers()
    {
        var result = SoldSizePolicy.Apply(
            new RecommendationResult(
                "42",
                70,
                "42, ölçülerinize en güçlü eşleşme.",
                "Bel ölçüsü 42 satırına oturur.",
                [],
                [],
                "kanıt",
                "local"),
            ["34", "36", "38", "40", "42", "44", "46"]);

        Assert.Equal("42", result.RecommendedSize);
        Assert.Equal("local", result.DataSource);
    }

    [Fact]
    public void JeanSoldAsNumbersMayRecommend42()
    {
        var result = Analyze(
            name: "Straight jean",
            category: "Jeans",
            chart: new SizeChartDto
            {
                Found = true,
                Title = "Ürün ölçüleri",
                Unit = "Centimeters",
                Headers = ["Beden", "Bel"],
                Rows =
                [
                    new SizeChartRowDto { Cells = ["34", "36"] },
                    new SizeChartRowDto { Cells = ["36", "38"] },
                    new SizeChartRowDto { Cells = ["38", "40"] },
                    new SizeChartRowDto { Cells = ["40", "42"] },
                    new SizeChartRowDto { Cells = ["42", "43"] },
                    new SizeChartRowDto { Cells = ["44", "45"] },
                    new SizeChartRowDto { Cells = ["46", "47"] }
                ],
                SellingSizes = ["34", "36", "38", "40", "42", "44", "46"]
            });

        Assert.Equal("42", result.RecommendedSize);
    }

    [Fact]
    public void TeeSoldAsLettersNeverRecommends42()
    {
        var result = Analyze(
            name: "Boxy fit tişört",
            category: "T-Shirt",
            chart: new SizeChartDto
            {
                Found = true,
                Title = "Ürün ölçüleri",
                Unit = "Centimeters",
                Headers = ["Beden", "Göğüs"],
                Rows =
                [
                    new SizeChartRowDto { Cells = ["S", "50"] },
                    new SizeChartRowDto { Cells = ["M", "53"] },
                    new SizeChartRowDto { Cells = ["L", "56"] },
                    new SizeChartRowDto { Cells = ["42", "59"] }
                ],
                RawText = "S M L XL 42",
                SellingSizes = ["XS", "S", "M", "L", "XL"]
            });

        Assert.DoesNotContain("42", result.RecommendedSize, StringComparison.Ordinal);
        Assert.Contains(
            result.RecommendedSize,
            new[] { "S", "M", "L", "Bilinmiyor" },
            StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void PairsAnyNumericJsonRowsOntoLetterChipsInOrder()
    {
        var aligned = SizeChartAligner.Align(new SizeChartDto
        {
            Found = true,
            Headers = ["Beden", "Göğüs"],
            Rows =
            [
                new SizeChartRowDto { Cells = ["44", "48"] },
                new SizeChartRowDto { Cells = ["46", "51"] },
                new SizeChartRowDto { Cells = ["48", "54"] },
                new SizeChartRowDto { Cells = ["50", "57"] }
            ],
            SellingSizes = ["S", "M", "L", "XL"]
        });

        Assert.Equal(["S", "M", "L", "XL"], aligned.Rows.Select(row => row.Cells[0]));
        Assert.Equal("51", aligned.Rows[1].Cells[1]);
    }

    private static RecommendationResult Analyze(string name, string category, SizeChartDto chart)
    {
        var engine = new LocalFitRecommendationEngine(
            new RegionalFitFeedbackService(),
            new ProductIdentityService(),
            new ProductFitTaxonomyService());
        return engine.Analyze(
            new UserProfile
            {
                UserId = "tester-sold-size",
                Age = 28,
                HeightCm = 178,
                WeightKg = 78,
                ShoulderWidthCm = 110,
                ChestCircumferenceCm = 105,
                WaistCircumferenceCm = 85,
                FitPreference = FitPreference.TrueToSize
            },
            [],
            new AnalyzeRecommendationRequest
            {
                UserId = "tester-sold-size",
                Product = new ProductDto
                {
                    Url = "http://127.0.0.1:8199/item.html",
                    Brand = "Zara",
                    Name = name,
                    Category = category
                },
                SizeChart = chart
            });
    }
}
