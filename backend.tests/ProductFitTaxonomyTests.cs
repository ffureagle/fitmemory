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
    public void BarrelFitNameIsItsOwnCut()
    {
        var semantics = taxonomy.Describe(new ProductDto
        {
            Url = "https://www.pullandbear.com/tr/barrel",
            Name = "Barrel Fit Jeans",
            FitLabel = "Relaxed Fit",
            Description = "Relaxed denim with extra room"
        });

        Assert.Equal(ProductFitFamily.Barrel, semantics.Family);
        Assert.Equal("Barrel Fit", semantics.Label);
    }

    [Fact]
    public void BalancedPreferenceDoesNotStackEaseOnRelaxed()
    {
        var playbook = taxonomy.Playbook(
            new ProductDto
            {
                Url = "https://www.pullandbear.com/tr/relaxed-tee",
                Name = "Relaxed Fit T-shirt",
                FitLabel = "Relaxed Fit"
            },
            FitMemory.Api.Models.FitPreference.TrueToSize);

        Assert.True(playbook.VolumeAlreadyInPattern);
        Assert.True(playbook.DoNotAddExtraEaseOnTop);
        Assert.Contains("5-6 cm", playbook.PreferenceNote, StringComparison.Ordinal);
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
