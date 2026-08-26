using FitMemory.Api.Contracts;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class ProductFitTaxonomyTests
{
    private readonly ProductFitTaxonomyService taxonomy = new();

    [Fact]
    public void LooseFitNameIsNotSuperBaggy()
    {
        var semantics = taxonomy.Describe(new ProductDto
        {
            Url = "https://www.pullandbear.com/tr/loose-fit",
            Name = "Loose Fit Straight Leg Jeans",
            FitLabel = "",
            FitEvidence = "This baggy look is trending this season.",
            Description = "Baggy streetwear silhouette with extra volume."
        });

        Assert.Equal(ProductFitFamily.Loose, semantics.Family);
        Assert.Equal("Loose Fit", semantics.Label);
    }

    [Fact]
    public void SuperBaggyNameStillWins()
    {
        var semantics = taxonomy.Describe(new ProductDto
        {
            Url = "https://www.pullandbear.com/tr/super-baggy",
            Name = "Super Baggy Jeans",
            FitLabel = "Loose Fit",
            Description = "Loose fit denim"
        });

        Assert.Equal(ProductFitFamily.SuperBaggy, semantics.Family);
    }

    [Fact]
    public void FitLabelLooseBeatsPageBaggyWhenNameIsGeneric()
    {
        var semantics = taxonomy.Describe(new ProductDto
        {
            Url = "https://www.pullandbear.com/tr/denim",
            Name = "Denim trousers",
            FitLabel = "Loose Fit",
            Description = "Baggy inspired wash"
        });

        Assert.Equal(ProductFitFamily.Loose, semantics.Family);
    }
}
