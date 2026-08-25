using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class LocalPantsFitTests
{
    [Fact]
    public void Waist85PicksEu42WhenOnlyNarrowRowIsMeasured()
    {
        var result = Analyze(
            chart: new SizeChartDto
            {
                Found = true,
                Title = "Ürün ölçüleri",
                Unit = "Centimeters",
                Headers = ["Beden", "Bel"],
                Rows = [new SizeChartRowDto { Cells = ["34", "36"] }],
                RawText = "Beden 34 36 38 40 42 44 46 Bel 36"
            });

        Assert.Equal("42", result.RecommendedSize);
        Assert.DoesNotContain("Hedef", result.Explanation, StringComparison.Ordinal);
        Assert.Equal("local-waist-label-estimate", result.DataSource);
    }

    [Fact]
    public void Waist85PicksEu42FromFullJeanChart()
    {
        var result = Analyze(
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
                RawText = ""
            });

        Assert.Equal("42", result.RecommendedSize);
        Assert.DoesNotContain("Hedef", result.Explanation, StringComparison.Ordinal);
    }

    [Fact]
    public void PreviousKept34DoesNotLockJeanSize()
    {
        var profile = CreateProfile();
        var previous = new OrderHistoryItem
        {
            UserProfile = profile,
            Brand = "Pull&Bear",
            ProductName = "Eski straight jean",
            Category = "Jeans",
            PurchasedSize = "34",
            Outcome = OrderOutcome.KeptGoodFit,
            FitLabel = "Straight Fit",
            UpdatedAt = DateTimeOffset.UtcNow.AddDays(-30)
        };

        var result = Analyze(
            chart: new SizeChartDto
            {
                Found = true,
                Title = "Ürün ölçüleri",
                Unit = "Centimeters",
                Headers = ["Beden", "Bel"],
                Rows = [new SizeChartRowDto { Cells = ["34", "36"] }],
                RawText = "Beden 34 36 38 40 42 44 46 Bel 36"
            },
            orders: [previous],
            profile: profile);

        Assert.Equal("42", result.RecommendedSize);
        Assert.NotEqual("local-category-history", result.DataSource);
    }

    private static RecommendationResult Analyze(
        SizeChartDto chart,
        IReadOnlyList<OrderHistoryItem>? orders = null,
        UserProfile? profile = null)
    {
        var engine = new LocalFitRecommendationEngine(
            new RegionalFitFeedbackService(),
            new ProductIdentityService(),
            new ProductFitTaxonomyService());
        profile ??= CreateProfile();
        return engine.Analyze(
            profile,
            orders ?? [],
            new AnalyzeRecommendationRequest
            {
                UserId = profile.UserId,
                Product = new ProductDto
                {
                    Url = "http://127.0.0.1:8199/jean.html",
                    Brand = "Pull&Bear",
                    Name = "Straight jean",
                    Category = "Jeans",
                    FitLabel = "Straight Fit",
                    Description = "Straight fit denim"
                },
                SizeChart = chart
            });
    }

    private static UserProfile CreateProfile()
    {
        return new UserProfile
        {
            UserId = "tester-pants-fit",
            Age = 28,
            HeightCm = 178,
            WeightKg = 78,
            ShoulderWidthCm = 110,
            ChestCircumferenceCm = 105,
            WaistCircumferenceCm = 85,
            FitPreference = FitPreference.TrueToSize
        };
    }
}
