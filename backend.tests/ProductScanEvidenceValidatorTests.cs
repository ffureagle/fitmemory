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
    public void ExtractsSizeKeyedMapJson()
    {
        using var json = JsonDocument.Parse("""
            {"sizeGuide":{
              "XS":{"chest":57.0,"waist":44.0},
              "S":{"chest":59.0,"waist":46.0},
              "M":{"chest":61.0,"waist":48.0}
            }}
            """);
        var rows = ProductJsonSizeEvidenceExtractor.ExtractRows(json.RootElement);
        Assert.Equal(3, rows.Count);
        Assert.Equal("XS", rows[0].Size);
        Assert.Equal("57", rows[0].Measurements["chest"]);
        Assert.Equal("M", rows[2].Size);
        Assert.Equal("61", rows[2].Measurements["chest"]);
    }

    [Fact]
    public void ExtractsInditexSkuDimensions()
    {
        using var json = JsonDocument.Parse("""
            {"detail":{"colors":[{"sizes":[
              {"name":"XS","skuDimensions":[
                {"dimensionName":"1/2 Chest","value":49.0},
                {"dimensionName":"Front Length","value":62.0}
              ]},
              {"name":"S","skuDimensions":[
                {"dimensionName":"1/2 Chest","value":51.0},
                {"dimensionName":"Front Length","value":64.0}
              ]},
              {"name":"M","price":1590,"sku":6224308}
            ]}]}}
            """);
        var rows = ProductJsonSizeEvidenceExtractor.ExtractRows(json.RootElement);
        Assert.Equal(2, rows.Count);
        Assert.Equal("XS", rows[0].Size);
        Assert.Contains(rows[0].Measurements, pair =>
            pair.Key.Contains("Chest", StringComparison.OrdinalIgnoreCase) && pair.Value == "49");
        Assert.Equal("S", rows[1].Size);
        Assert.Contains(rows[1].Measurements, pair =>
            pair.Key.Contains("Length", StringComparison.OrdinalIgnoreCase) && pair.Value == "64");
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

    [Fact]
    public void AcceptsJeanWaistChartAsVerifiedProductMeasurement()
    {
        var product = new ProductDto
        {
            Url = "https://www.pullandbear.com/tr/straight-jean-l01234",
            Name = "Straight jean",
            Brand = "Pull&Bear",
            Category = "Jeans"
        };
        var chart = new SizeChartDto
        {
            Found = true,
            Headers = ["Beden", "Bel"],
            Rows = [new SizeChartRowDto { Cells = ["34", "36"] }]
        };
        Assert.True(ProductScanEvidenceValidator.IsVerifiedChart(product, chart));
    }
}
