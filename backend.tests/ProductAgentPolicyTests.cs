using FitMemory.Api.Services;

namespace FitMemory.Api.Tests;

public sealed class ProductAgentPolicyTests
{
    [Theory]
    [InlineData("https://www.zara.com/tr/tr/product-p01234.html", "zara.com", "Zara")]
    [InlineData("https://www.pullandbear.com/tr/product-l01234", "pullandbear.com", "Pull&Bear")]
    public void AllowsOnlySupportedHttpsProductHosts(string url, string domain, string adapter)
    {
        Assert.True(ProductAgentUrlPolicy.TryValidateProductUrl(url, out _, out var actualDomain));
        Assert.Equal(domain, actualDomain);
        Assert.Equal(adapter, ProductPageAdapterFactory.Create(actualDomain).Brand);
    }

    [Theory]
    [InlineData("http://www.zara.com/tr/tr/product-p01234.html")]
    [InlineData("https://evil-zara.com/product")]
    [InlineData("https://www.zara.com/tr/tr/checkout")]
    [InlineData("https://www.zara.com/tr/tr/cart")]
    [InlineData("https://www.pullandbear.com/tr/payment")]
    [InlineData("https://www.pullandbear.com/tr/login")]
    public void RejectsUnsafeOrStatefulUrls(string url) =>
        Assert.False(ProductAgentUrlPolicy.TryValidateProductUrl(url, out _, out _));

    [Theory]
    [InlineData("GET", true)]
    [InlineData("HEAD", true)]
    [InlineData("OPTIONS", true)]
    [InlineData("POST", false)]
    [InlineData("PUT", false)]
    [InlineData("PATCH", false)]
    [InlineData("DELETE", false)]
    public void AllowsOnlyReadOnlyBrowserRequests(string method, bool expected) =>
        Assert.Equal(expected, ProductAgentUrlPolicy.IsReadOnlyMethod(method));

    [Fact]
    public void DetectsZaraTurkeyInterstitialFixture()
    {
        var html = Fixture("ZaraCountryInterstitial.html");
        Assert.True(ZaraProductPageAdapter.IsTurkeyInterstitialText(html));
    }

    [Fact]
    public void DetectsEmptyPullBearShellButNotRenderedProduct()
    {
        Assert.True(ProductPageEvidenceClassifier.IsEmptyProductShell(Fixture("PullBearEmptyShell.html")));
        Assert.False(ProductPageEvidenceClassifier.IsEmptyProductShell(Fixture("PullBearDelayedProductDom.html")));
    }

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
