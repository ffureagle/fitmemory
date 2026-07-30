using FitMemory.Api.Contracts;
using Microsoft.Playwright;

namespace FitMemory.Api.Services;

internal interface IProductPageAdapter
{
    string Brand { get; }
    Task PrepareAsync(IPage page, ProductAgentInteraction interaction, CancellationToken token);
    Task<bool> OpenSizeUiAsync(IPage page, ProductAgentInteraction interaction, CancellationToken token);
}

internal static class ProductPageAdapterFactory
{
    public static IProductPageAdapter Create(string brandKey) => brandKey switch
    {
        "zara.com" => new ZaraProductPageAdapter(),
        "pullandbear.com" => new PullBearProductPageAdapter(),
        _ => throw new ArgumentOutOfRangeException(nameof(brandKey), "Desteklenmeyen marka adaptörü.")
    };
}

internal sealed class ZaraProductPageAdapter : IProductPageAdapter
{
    public string Brand => "Zara";

    public async Task PrepareAsync(IPage page, ProductAgentInteraction interaction, CancellationToken token)
    {
        var interstitial = await interaction.ClickFirstAsync(page,
            ["EVET, TÜRKİYE / TURKEY İNTERNET SİTESİNDE DEVAM ET",
             "TÜRKİYE İNTERNET SİTESİNDE DEVAM ET", "CONTINUE TO TURKEY"], token, 2200);
        interaction.Add("dismissing-interstitial", interstitial ? "success" : "skipped",
            interstitial ? "Zara Türkiye interstitial kapatıldı." : "Zara Türkiye interstitial görünmedi.");
        if (interstitial) await interaction.WaitForDomChangeAsync(page, 900, token);
        await interaction.DismissCookieConsentAsync(page, token);
    }

    public async Task<bool> OpenSizeUiAsync(IPage page, ProductAgentInteraction interaction, CancellationToken token)
    {
        var opened = await interaction.ClickFirstAsync(page,
            ["ÜRÜN BOYUTLARI", "Ürün boyutları", "ÖLÇÜLER", "Ölçüler", "Ölçüleri gör",
             "BEDEN REHBERİ", "Beden rehberi", "PRODUCT MEASUREMENTS", "MEASUREMENTS", "SIZE GUIDE"],
            token, 6500);
        if (!opened)
        {
            opened = await interaction.ClickFirstAsync(page,
                ["Beden seç", "Beden seçin", "BEDEN SEÇ", "Select size"], token, 2600);
            if (opened) await interaction.WaitForDomChangeAsync(page, 500, token);
            opened = await interaction.ClickFirstAsync(page,
                ["ÜRÜN BOYUTLARI", "Ürün boyutları", "ÖLÇÜLER", "Ölçüler", "Ölçüleri gör",
                 "BEDEN REHBERİ", "Beden rehberi", "PRODUCT MEASUREMENTS", "MEASUREMENTS", "SIZE GUIDE"],
                token, 4200);
        }
        interaction.Add("opening-size-ui", opened ? "success" : "failed",
            opened ? "Zara ölçü erişim noktası açıldı." : "Zara ölçü erişim noktası bulunamadı.");
        if (opened) await interaction.WaitForDomChangeAsync(page, 900, token);
        return opened;
    }

    internal static bool IsTurkeyInterstitialText(string text) =>
        ProductPageEvidenceClassifier.IsTurkeyInterstitial(text);
}

internal sealed class PullBearProductPageAdapter : IProductPageAdapter
{
    public string Brand => "Pull&Bear";

    public async Task PrepareAsync(IPage page, ProductAgentInteraction interaction, CancellationToken token)
    {
        await interaction.DismissCookieConsentAsync(page, token);
        var shellReady = await interaction.WaitForAnyTextAsync(page,
            ["Ekle", "Beden seç", "Beden seçin", "Ölçüleri görüntüle", "Add", "Select size"],
            9000, token);
        var visibleText = await page.Locator("body").InnerTextAsync(new LocatorInnerTextOptions { Timeout = 2500 });
        var emptyShell = ProductPageEvidenceClassifier.IsEmptyProductShell(visibleText);
        interaction.Add("preparing-page", shellReady ? "success" : "failed",
            shellReady ? "Pull&Bear ürün alanı render edildi." :
            emptyShell ? "Pull&Bear boş JS shell döndürdü." : "Pull&Bear ürün alanı zamanında render edilmedi.");
    }

    public async Task<bool> OpenSizeUiAsync(IPage page, ProductAgentInteraction interaction, CancellationToken token)
    {
        var opened = await interaction.ClickFirstAsync(page,
            ["Ölçüleri görüntüle", "ÖLÇÜLERİ GÖRÜNTÜLE", "Ölçüleri gör", "ÖLÇÜLERİ GÖR",
             "Ölçü rehberi", "Beden rehberi", "View measurements", "Product measurements", "Size guide"],
            token, 2200);
        if (!opened)
        {
            // POST/PUT is blocked by the browser route. "Ekle" can therefore only reveal
            // the size drawer; it cannot mutate cart state in this isolated context.
            var selectorOpened = await interaction.ClickFirstAsync(page,
                ["Beden seç", "Beden seçin", "BEDEN SEÇ", "Ekle", "Select size"], token, 4200);
            interaction.Add("opening-size-ui", selectorOpened ? "success" : "failed",
                selectorOpened ? "Pull&Bear beden seçici açıldı." : "Pull&Bear beden seçici bulunamadı.");
            if (selectorOpened) await interaction.WaitForDomChangeAsync(page, 650, token);
            opened = await interaction.ClickFirstAsync(page,
                ["Ölçüleri görüntüle", "ÖLÇÜLERİ GÖRÜNTÜLE", "Ölçüleri gör", "ÖLÇÜLERİ GÖR",
                 "Ölçü rehberi", "Beden rehberi", "View measurements", "Product measurements", "Size guide"],
                token, 6500);
        }
        interaction.Add("opening-size-ui", opened ? "success" : "failed",
            opened ? "Pull&Bear ölçü paneli açıldı." : "Pull&Bear ölçü bağlantısı bulunamadı.");
        if (opened) await interaction.WaitForDomChangeAsync(page, 850, token);
        return opened;
    }
}

internal sealed class ProductAgentInteraction(
    IList<AgentScanTraceStep> trace,
    System.Diagnostics.Stopwatch stopwatch)
{
    public void Add(string stage, string status, string message, IReadOnlyList<string>? details = null) =>
        trace.Add(new AgentScanTraceStep(stage, status, message, stopwatch.ElapsedMilliseconds, details));

    public async Task<bool> ClickFirstAsync(
        IPage page, IReadOnlyList<string> labels, CancellationToken token, int maxWaitMs)
    {
        var deadline = DateTimeOffset.UtcNow.AddMilliseconds(maxWaitMs);
        var wrapped = false;
        while (DateTimeOffset.UtcNow < deadline)
        {
            token.ThrowIfCancellationRequested();
            foreach (var label in labels)
            {
                var locators = new[]
                {
                    page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = label, Exact = true }).Last,
                    page.GetByRole(AriaRole.Tab, new PageGetByRoleOptions { Name = label, Exact = true }).Last,
                    page.GetByText(label, new PageGetByTextOptions { Exact = true }).Last
                };
                foreach (var locator in locators)
                {
                    if (!await IsVisibleAsync(locator)) continue;
                    if (await TryActivateAsync(locator, label)) return true;
                }
            }
            wrapped = await page.EvaluateAsync<bool>("""
                wrapped => {
                  const maxY=Math.max(0,document.documentElement.scrollHeight-innerHeight);
                  if(window.scrollY>=maxY-20&&!wrapped){window.scrollTo(0,0);return true;}
                  window.scrollBy(0,Math.max(280,innerHeight*.72)); return wrapped;
                }
                """, wrapped);
            await Task.Delay(120, token);
        }
        return false;
    }

    public async Task<bool> WaitForAnyTextAsync(
        IPage page, IReadOnlyList<string> labels, int maxWaitMs, CancellationToken token)
    {
        var deadline = DateTimeOffset.UtcNow.AddMilliseconds(maxWaitMs);
        while (DateTimeOffset.UtcNow < deadline)
        {
            token.ThrowIfCancellationRequested();
            foreach (var label in labels)
            {
                if (await IsVisibleAsync(page.GetByText(label, new PageGetByTextOptions { Exact = true }).Last))
                    return true;
            }
            await Task.Delay(180, token);
        }
        return false;
    }

    public async Task DismissCookieConsentAsync(IPage page, CancellationToken token)
    {
        var dismissed = await ClickFirstAsync(page,
            ["Yalnızca gerekli çerezler", "Gerekli çerezler", "Reddet", "Reject all", "Only necessary"],
            token, 900);
        if (dismissed) Add("preparing-page", "success", "Çerez bildirimi güvenli seçenekle kapatıldı.");
    }

    public async Task WaitForDomChangeAsync(IPage page, int milliseconds, CancellationToken token)
    {
        await page.EvaluateAsync("""
            duration => new Promise(resolve => {
              let timer=setTimeout(done,duration);
              const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(done,160);});
              function done(){observer.disconnect();resolve(true);}
              observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
            })
            """, milliseconds);
        token.ThrowIfCancellationRequested();
    }

    private async Task<bool> TryActivateAsync(ILocator locator, string label)
    {
        try
        {
            await locator.ScrollIntoViewIfNeededAsync(new LocatorScrollIntoViewIfNeededOptions { Timeout = 1200 });
        }
        catch (PlaywrightException exception)
        {
            Add("opening-size-ui", "failed", $"{label} görünür alana taşınamadı.", [exception.GetType().Name]);
        }
        try
        {
            await locator.ClickAsync(new LocatorClickOptions { Timeout = 1400 });
            return true;
        }
        catch (PlaywrightException clickException)
        {
            Add("opening-size-ui", "failed", $"{label} normal click kabul etmedi.", [clickException.GetType().Name]);
        }
        try
        {
            await locator.DispatchEventAsync("click", new { bubbles = true, cancelable = true });
            return true;
        }
        catch (PlaywrightException dispatchException)
        {
            Add("opening-size-ui", "failed", $"{label} event click kabul etmedi.", [dispatchException.GetType().Name]);
            return false;
        }
    }

    private static async Task<bool> IsVisibleAsync(ILocator locator)
    {
        try { return await locator.IsVisibleAsync(); }
        catch (PlaywrightException) { return false; }
    }
}
