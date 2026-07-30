using System.Text.Json;
using FitMemory.Api.Contracts;
using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class ProductScanEvidenceValidatorTests
{
    [Fact]
    public void AcceptsSizeRowsWithProductMeasurements()
    {
        var row = new AgentSizeTableRow("M", new Dictionary<string, string>
        {
            ["Göğüs"] = "53.8",
            ["Ön uzunluk"] = "68.8"
        });
        Assert.True(ProductScanEvidenceValidator.IsValidRow(row));
    }

    [Theory]
    [InlineData("Fiyat", "1590")]
    [InlineData("SKU", "6224308")]
    [InlineData("Model boyu", "189")]
    [InlineData("Stok", "12")]
    [InlineData("İndirim", "35")]
    public void RejectsMetadataNumbersAsMeasurements(string label, string value) =>
        Assert.False(ProductScanEvidenceValidator.IsValidMeasurement(label, value));

    [Fact]
    public void ExtractsOnlyVerifiedRowsFromNestedXhrJson()
    {
        using var json = JsonDocument.Parse("""
            {"items":[
              {"size":"M","measurements":{"chest":53.8,"front length":"68.8"},"price":1590},
              {"size":"L","measurements":{"sku":6224308,"stock":4}}
            ]}
            """);
        var rows = ProductJsonSizeEvidenceExtractor.ExtractRows(json.RootElement);
        var row = Assert.Single(rows);
        Assert.Equal("M", row.Size);
        Assert.Equal(2, row.Measurements.Count);
    }

    [Fact]
    public void RecommendationRequiresNameBrandSizeAndNumericProductMeasurement()
    {
        var product = new ProductDto
        {
            Url = "https://www.zara.com/tr/tr/boxy-fit-t-shirt-p01234.html",
            Name = "Boxy fit tişört",
            Brand = "Zara"
        };
        var valid = new SizeChartDto
        {
            Found = true,
            Headers = ["Beden", "Göğüs"],
            Rows = [new SizeChartRowDto { Cells = ["M", "53.8"] }]
        };
        var invalid = new SizeChartDto
        {
            Found = true,
            Headers = ["Beden", "Fiyat"],
            Rows = [new SizeChartRowDto { Cells = ["M", "1590"] }]
        };
        Assert.True(ProductScanEvidenceValidator.IsVerifiedChart(product, valid));
        Assert.False(ProductScanEvidenceValidator.IsVerifiedChart(product, invalid));
    }
}
