using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class LocalUpperFitTests
{
    [Fact]
    public void TeeWithoutGarmentMeasurementsDoesNotGuessLetterSize()
    {
        var result = AnalyzeTee(new SizeChartDto
        {
            Found = true,
            Title = "Bedenler",
            Unit = "Unknown",
            Headers = ["Beden"],
            Rows =
            [
                new SizeChartRowDto { Cells = ["XS"] },
                new SizeChartRowDto { Cells = ["S"] },
                new SizeChartRowDto { Cells = ["M"] },
                new SizeChartRowDto { Cells = ["L"] },
                new SizeChartRowDto { Cells = ["XL"] },
                new SizeChartRowDto { Cells = ["XXL"] }
            ],
            RawText = "XS S M L XL XXL Büyük beden. Bir beden küçük almanızı öneririz."
        });

        Assert.Equal("Bilinmiyor", result.RecommendedSize);
        Assert.Equal("local-insufficient", result.DataSource);
        Assert.Contains("ölçü", result.Explanation, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MerchantOneSizeDownShiftsMeasuredTee()
    {
        var result = AnalyzeTee(
            new SizeChartDto
            {
                Found = true,
                Title = "Ürün ölçüleri",
                Unit = "Centimeters",
                Headers = ["Beden", "Göğüs"],
                Rows =
                [
                    new SizeChartRowDto { Cells = ["S", "48"] },
                    new SizeChartRowDto { Cells = ["M", "51"] },
                    new SizeChartRowDto { Cells = ["L", "54"] },
                    new SizeChartRowDto { Cells = ["XL", "57"] }
                ],
                RawText = ""
            },
            merchantAdvice: "Büyük beden. Bir beden küçük almanızı öneririz.");

        Assert.NotEqual("Bilinmiyor", result.RecommendedSize);
        Assert.Equal("M", result.RecommendedSize);
        Assert.True(result.Explanation.Length >= 160);
        Assert.Contains("rahat", result.Explanation, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SingleMeasuredSizeAmongListedSizesIsInsufficient()
    {
        var result = AnalyzeTee(new SizeChartDto
        {
            Found = true,
            Title = "Ürün ölçüleri",
            Unit = "Centimeters",
            Headers = ["Beden", "Göğüs"],
            Rows = [new SizeChartRowDto { Cells = ["M", "53"] }],
            RawText = "M | Göğüs 53\nMevcut bedenler: S M L XL",
            AvailableSizes = ["S", "M", "L", "XL"]
        });

        Assert.Equal("Bilinmiyor", result.RecommendedSize);
        Assert.Equal("local-insufficient", result.DataSource);
        Assert.Contains("tek beden", result.Explanation, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void OneSizeGarmentWithSingleRowIsNotTreatedAsIncompleteWalk()
    {
        var result = AnalyzeTee(new SizeChartDto
        {
            Found = true,
            Title = "Ürün ölçüleri",
            Unit = "Centimeters",
            Headers = ["Beden", "Göğüs"],
            Rows = [new SizeChartRowDto { Cells = ["M", "53"] }],
            RawText = "M | Göğüs 53",
            AvailableSizes = ["M"]
        });

        Assert.DoesNotContain("diğer bedenler toplanamadı", result.Explanation, StringComparison.OrdinalIgnoreCase);
    }

    private static RecommendationResult AnalyzeTee(
        SizeChartDto chart,
        string merchantAdvice = "")
    {
        var engine = new LocalFitRecommendationEngine(
            new RegionalFitFeedbackService(),
            new ProductIdentityService(),
            new ProductFitTaxonomyService());
        var profile = new UserProfile
        {
            UserId = "tester-tee-fit",
            Age = 28,
            HeightCm = 178,
            WeightKg = 78,
            ShoulderWidthCm = 110,
            ChestCircumferenceCm = 105,
            WaistCircumferenceCm = 85,
            FitPreference = FitPreference.TrueToSize
        };
        return engine.Analyze(
            profile,
            [],
            new AnalyzeRecommendationRequest
            {
                UserId = profile.UserId,
                Product = new ProductDto
                {
                    Url = "https://www.pullandbear.com/tr/basic-slim-fit-tshirt-l01234",
                    Brand = "Pull&Bear",
                    Name = "Basic slim fit tişört",
                    Category = "Tişört",
                    FitLabel = "Slim Fit",
                    MerchantFitAdvice = merchantAdvice,
                    FitEvidence = merchantAdvice
                },
                SizeChart = chart
            });
    }
}
