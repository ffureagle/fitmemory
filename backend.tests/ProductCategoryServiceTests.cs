using FitMemory.Api.Contracts;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class ProductCategoryServiceTests
{
    private readonly ProductCategoryService _service = new(new ProductIdentityService());

    [Theory]
    [InlineData("Erkek Tişörtleri", "Pantolon ve alt giyim", ProductCategoryGroup.Tees)]
    [InlineData("Baggy fit jean", "Üst giyim", ProductCategoryGroup.Bottoms)]
    [InlineData("Denim effect t-shirt", "Bottoms", ProductCategoryGroup.Tees)]
    [InlineData("Regular mont", "", ProductCategoryGroup.Outerwear)]
    [InlineData("Overshirt ceket", "", ProductCategoryGroup.Outerwear)]
    public void ClassifiesByProductNameAheadOfStoredCategory(
        string name,
        string category,
        ProductCategoryGroup expected)
    {
        var group = _service.GetGroup(new ProductDto
        {
            Url = "https://example.test/item",
            Brand = "Test",
            Name = name,
            Category = category
        });

        Assert.Equal(expected, group);
        if (expected == ProductCategoryGroup.Tees)
        {
            Assert.Equal("Tişört", _service.GetTurkishLabel(new ProductDto
            {
                Url = "https://example.test/item",
                Brand = "Test",
                Name = name,
                Category = category
            }));
        }
    }
}
