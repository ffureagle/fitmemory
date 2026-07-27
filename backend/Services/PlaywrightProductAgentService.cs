using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using FitMemory.Api.Contracts;
using Microsoft.Playwright;

namespace FitMemory.Api.Services;

public sealed partial class PlaywrightProductAgentService(
    GeminiProductScanClient visionClient,
    ILogger<PlaywrightProductAgentService> logger) : IAsyncDisposable
{
    private static readonly HashSet<string> AllowedDomains =
        ["pullandbear.com", "zara.com"];
    private static readonly string[] SizeLabels =
        ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
    private readonly SemaphoreSlim _browserGate = new(1, 1);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _lastHostRun = new();
    private IPlaywright? _playwright;
    private IBrowser? _browser;

    public async Task<AgentProductScanResponse> ExtractAsync(
        AgentProductScanRequest request,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        if (!TryValidateUrl(request.Url, out var target, out var domain))
        {
            return Failure(request, stopwatch, 201,
                "Bu ajan yalnız Pull&Bear ve Zara ürün adreslerini kabul eder.");
        }

        await _browserGate.WaitAsync(cancellationToken);
        try
        {
            await ThrottleHostAsync(domain, cancellationToken);
            return await ExtractLockedAsync(request, target, domain, stopwatch, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Failure(request, stopwatch, 500, "Ürün çıkarma işlemi zaman aşımına uğradı.");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Playwright product agent failed for {Domain}", domain);
            return Failure(request, stopwatch, 500, "Ürün sayfası güvenli biçimde işlenemedi.");
        }
        finally
        {
            _lastHostRun[domain] = DateTimeOffset.UtcNow;
            _browserGate.Release();
        }
    }

    private async Task<AgentProductScanResponse> ExtractLockedAsync(
        AgentProductScanRequest request,
        Uri target,
        string domain,
        Stopwatch stopwatch,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(request.MaxWaitMs, 8000, 30000)));
        var browser = await EnsureBrowserAsync();
        var userAgent = SafeUserAgent(request.UserAgentHint);
        await using var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            Locale = request.Language == "en" ? "en-US" : "tr-TR",
            UserAgent = userAgent,
            ViewportSize = new ViewportSize { Width = 390, Height = 844 },
            JavaScriptEnabled = true,
            ServiceWorkers = ServiceWorkerPolicy.Block
        });
        await context.ClearCookiesAsync();
        var xhrBodies = new ConcurrentQueue<string>();
        var xhrUrls = new ConcurrentQueue<string>();
        var page = await context.NewPageAsync();
        page.SetDefaultTimeout(Math.Clamp(request.MaxWaitMs, 8000, 30000));

        await page.RouteAsync("**/*", async route =>
        {
            var method = route.Request.Method.ToUpperInvariant();
            if (method is not ("GET" or "HEAD" or "OPTIONS"))
            {
                await route.AbortAsync();
                return;
            }
            await route.ContinueAsync();
        });
        page.Response += (_, response) =>
        {
            if (response.Request.ResourceType is not ("xhr" or "fetch")) return;
            if (!response.Headers.TryGetValue("content-type", out var contentType) ||
                !contentType.Contains("json", StringComparison.OrdinalIgnoreCase)) return;
            _ = CaptureJsonResponseAsync(response, xhrBodies, xhrUrls);
        };

        await page.GotoAsync(target.AbsoluteUri, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.DOMContentLoaded,
            Timeout = Math.Clamp(request.MaxWaitMs, 8000, 30000)
        });
        try
        {
            await page.WaitForLoadStateAsync(LoadState.NetworkIdle,
                new PageWaitForLoadStateOptions { Timeout = 4500 });
        }
        catch (TimeoutException) { }

        var evidence = await ReadPageEvidenceAsync(page);
        if (!HasUsableSizeTable(evidence))
        {
            await WaitForDynamicContentAsync(page, 2400, timeout.Token);
            evidence = await ReadPageEvidenceAsync(page);
        }
        if (!HasUsableSizeTable(evidence))
        {
            await OpenSizeUiAsync(page, domain, timeout.Token);
            evidence = await ReadPageEvidenceAsync(page);
        }

        var interactiveRows = await CollectInteractiveSizeRowsAsync(page, timeout.Token);
        if (interactiveRows.Count > evidence.SizeTable.Count)
        {
            evidence.SizeTable = interactiveRows;
            evidence.AvailableSizes = evidence.AvailableSizes
                .Concat(interactiveRows.Select(row => row.Size))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var xhrEvidence = ParseXhrEvidence(xhrBodies.ToArray());
        evidence = MergeEvidence(evidence, xhrEvidence);
        var usedSources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (evidence.JsonLdDocuments > 0) usedSources.Add("JSON-LD");
        if (evidence.DomTextLength > 0) usedSources.Add("DOM");
        if (xhrEvidence.AvailableSizes.Count > 0 ||
            !string.IsNullOrWhiteSpace(xhrEvidence.FitDescription)) usedSources.Add("XHR");
        if (evidence.OpenShadowRoots > 0) usedSources.Add("SHADOW");
        if (evidence.SameOriginFrames > 0) usedSources.Add("IFRAME");

        var visionUsed = false;
        if (!HasUsableSizeTable(evidence))
        {
            var screenshot = await page.ScreenshotAsync(new PageScreenshotOptions
            {
                Type = ScreenshotType.Jpeg,
                Quality = 70,
                FullPage = false
            });
            try
            {
                var vision = await visionClient.AnalyzeAsync(new VisionProductScanRequest
                {
                    UserId = "server-agent",
                    Product = new ProductDto
                    {
                        Url = target.AbsoluteUri,
                        Brand = evidence.Brand,
                        Name = evidence.ProductName,
                        FitLabel = evidence.FitDescription
                    },
                    PageText = evidence.VisibleText[..Math.Min(evidence.VisibleText.Length, 20000)],
                    ScreenshotDataUrl = "data:image/jpeg;base64," + Convert.ToBase64String(screenshot),
                    Language = request.Language
                }, timeout.Token);
                evidence = MergeVision(evidence, vision.SizeChart);
                visionUsed = true;
                usedSources.Add("VISION");
            }
            catch (Exception exception)
            {
                logger.LogInformation(exception, "Vision fallback found no verified size table for {Domain}", domain);
            }
        }

        var confidence = CalculateConfidence(usedSources, visionUsed, HasUsableSizeTable(evidence));
        var notes = new List<string>(evidence.Notes);
        if (confidence < .85) notes.Add("Ön doğrulama gerektirir.");
        if (evidence.CrossOriginFrames > 0) notes.Add("Cross-origin iframe içeriği okunmadı.");
        var status = HasUsableSizeTable(evidence)
            ? visionUsed ? 400 : confidence >= .85 ? 100 : 203
            : 201;
        var source = SelectPrimarySource(usedSources, visionUsed);
        var hints = xhrUrls.Select(MaskUrl).Distinct().Take(4).ToArray();

        return new AgentProductScanResponse(
            request.RequestId, target.AbsoluteUri, evidence.Brand, evidence.ProductName,
            evidence.AvailableSizes, evidence.UnavailableSizes, evidence.SizeChartUrl,
            evidence.SizeTable, evidence.FitDescription, confidence, source,
            notes.Distinct().Take(8).ToArray(), stopwatch.ElapsedMilliseconds, status,
            new AgentRawSourcesMeta(evidence.JsonLdDocuments, evidence.DomTextLength,
                xhrBodies.Count, evidence.SameOriginFrames, evidence.OpenShadowRoots, hints));
    }

    private async Task<IBrowser> EnsureBrowserAsync()
    {
        if (_browser is { IsConnected: true }) return _browser;
        _playwright?.Dispose();
        _playwright = await Playwright.CreateAsync();
        _browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = true,
            Args = ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox", "--single-process"]
        });
        return _browser;
    }

    private static async Task OpenSizeUiAsync(IPage page, string domain, CancellationToken token)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(9);
        if (domain == "zara.com")
        {
            var measurementsTab = page.GetByRole(AriaRole.Tab, new PageGetByRoleOptions
            {
                Name = "Ölçüler",
                Exact = true
            }).Last;
            if (await SafeVisibleAsync(measurementsTab))
            {
                await SafeActivateAsync(measurementsTab);
                await Task.Delay(650, token);
            }
        }

        var addPatterns = domain == "pullandbear.com"
            ? new[] { "Ekle", "Sepete ekle", "Add", "Add to bag" }
            : new[] { "Ekle", "Add", "Choose size", "Beden seç" };
        foreach (var pattern in addPatterns)
        {
            token.ThrowIfCancellationRequested();
            var locator = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions
            {
                Name = pattern,
                Exact = true
            }).Last;
            if (!await SafeVisibleAsync(locator))
                locator = page.GetByText(pattern, new PageGetByTextOptions { Exact = true }).Last;
            if (await SafeVisibleAsync(locator))
            {
                await SafeActivateAsync(locator);
                await Task.Delay(500, token);
                break;
            }
        }
        while (DateTimeOffset.UtcNow < deadline)
        {
            token.ThrowIfCancellationRequested();
            foreach (var pattern in new[]
            {
                "Ölçüleri görüntüle", "Ölçüleri gör", "Ürün boyutları", "Ölçüler", "ÖLÇÜLERİ GÖR",
                "Size guide", "Product measurements", "Measurements"
            })
            {
                var locator = page.GetByRole(AriaRole.Tab, new PageGetByRoleOptions
                {
                    Name = pattern,
                    Exact = true
                }).Last;
                if (!await SafeVisibleAsync(locator))
                    locator = page.GetByText(pattern, new PageGetByTextOptions { Exact = true }).Last;
                if (!await SafeVisibleAsync(locator)) continue;
                await SafeActivateAsync(locator);
                await Task.Delay(700, token);
                return;
            }
            await Task.Delay(100, token);
        }
    }

    private static async Task SafeActivateAsync(ILocator locator)
    {
        try { await locator.ClickAsync(new LocatorClickOptions { Timeout = 1200 }); return; }
        catch (PlaywrightException) { }
        try
        {
            await locator.DispatchEventAsync("click", new { bubbles = true, cancelable = true });
            return;
        }
        catch (PlaywrightException) { }
        try
        {
            await locator.DispatchEventAsync("touchstart", new { bubbles = true, cancelable = true });
            await locator.DispatchEventAsync("touchend", new { bubbles = true, cancelable = true });
        }
        catch (PlaywrightException) { }
    }

    private static async Task<List<AgentSizeTableRow>> CollectInteractiveSizeRowsAsync(
        IPage page, CancellationToken token)
    {
        string[] labels;
        try
        {
            labels = await page.EvaluateAsync<string[]>("""
                () => {
                  const normalizeSize=v=>{const t=String(v||'').trim().toUpperCase();return (t.match(/^EU\s*(\d{1,3})(?:\s*\([^)]*\))?$/i)||[])[1]||(t.match(/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:[/-]\d{1,3})?)(?:\s*\([^)]*\))?$/i)||[])[1]||''};
                  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
                  const scopes=[...document.querySelectorAll('[role=dialog],aside,[class*="drawer" i],[class*="sheet" i],[class*="modal" i],[class*="size-guide" i]')].filter(visible);
                  const root=scopes.at(-1)||document;
                  return [...new Set([...root.querySelectorAll('button,[role=radio],[role=option],[role=button],[role=tab],li,label')]
                    .filter(visible).map(e=>normalizeSize(e.innerText||e.textContent)).filter(Boolean))].slice(0,12);
                }
                """);
        }
        catch (PlaywrightException)
        {
            return [];
        }
        var rows = new List<AgentSizeTableRow>();
        foreach (var label in labels)
        {
            token.ThrowIfCancellationRequested();
            bool clicked;
            try
            {
                clicked = await page.EvaluateAsync<bool>("""
                    size => {
                      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
                      const scopes=[...document.querySelectorAll('[role=dialog],aside,[class*="drawer" i],[class*="sheet" i],[class*="modal" i],[class*="size-guide" i]')].filter(visible);
                      const root=scopes.at(-1)||document;
                      const normalizeSize=v=>{const t=String(v||'').trim().toUpperCase();return (t.match(/^EU\s*(\d{1,3})(?:\s*\([^)]*\))?$/i)||[])[1]||(t.match(/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:[/-]\d{1,3})?)(?:\s*\([^)]*\))?$/i)||[])[1]||''};
                      const target=[...root.querySelectorAll('button,[role=radio],[role=option],[role=button],[role=tab],li,label')]
                        .find(e=>visible(e)&&normalizeSize(e.innerText||e.textContent)===String(size).toUpperCase());
                      if(!target)return false;
                      target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
                      target.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}));
                      target.click(); return true;
                    }
                    """, label);
            }
            catch (PlaywrightException)
            {
                clicked = false;
            }
            if (!clicked) continue;
            await Task.Delay(800, token);
            var current = await ReadPageEvidenceAsync(page);
            var measurements = current.SizeTable
                .SelectMany(row => row.Measurements)
                .GroupBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.Last().Value,
                    StringComparer.OrdinalIgnoreCase);
            if (measurements.Count > 0) rows.Add(new AgentSizeTableRow(label, measurements));
        }
        return rows;
    }

    private static async Task<bool> SafeVisibleAsync(ILocator locator)
    {
        try { return await locator.IsVisibleAsync(); }
        catch (PlaywrightException) { return false; }
    }

    private static async Task WaitForDynamicContentAsync(IPage page, int milliseconds, CancellationToken token)
    {
        await page.EvaluateAsync("""
            duration => new Promise(resolve => {
              let timer;
              const done = () => { observer.disconnect(); resolve(true); };
              const observer = new MutationObserver(() => {
                clearTimeout(timer); timer = setTimeout(done, 180);
              });
              observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true});
              timer = setTimeout(done, duration);
            })
            """, milliseconds);
        token.ThrowIfCancellationRequested();
    }

    private static async Task<PageEvidence> ReadPageEvidenceAsync(IPage page)
    {
        var json = await page.EvaluateAsync<JsonElement>(ExtractionScript);
        return JsonSerializer.Deserialize<PageEvidence>(json.GetRawText(), JsonOptions) ?? new PageEvidence();
    }

    private static readonly string ExtractionScript = """
        () => {
          const clean = v => String(v || '').replace(/\s+/g,' ').trim();
          const fold = v => clean(v).toLocaleLowerCase('tr-TR').normalize('NFD')
            .replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ş/g,'s')
            .replace(/ğ/g,'g').replace(/ç/g,'c').replace(/ö/g,'o').replace(/ü/g,'u');
          const visible = e => { if (!e || !e.getBoundingClientRect) return false;
            const r=e.getBoundingClientRect(),s=getComputedStyle(e);
            return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'; };
          const roots=[document]; let shadows=0;
          for (const e of document.querySelectorAll('*')) if (e.shadowRoot) { roots.push(e.shadowRoot); shadows++; }
          const all = selector => [...new Set(roots.flatMap(r => [...r.querySelectorAll(selector)]))];
          const text = clean(document.body?.innerText).slice(0,24000);
          const scripts=[...document.querySelectorAll('script[type="application/ld+json"]')];
          let product={};
          const findProduct = v => { if (!v||typeof v!=='object') return null;
            if (Array.isArray(v)) { for(const x of v){const y=findProduct(x);if(y)return y;} return null; }
            const t=v['@type']; if(t==='Product'||(Array.isArray(t)&&t.includes('Product')))return v;
            for(const x of Object.values(v)){const y=findProduct(x);if(y)return y;} return null; };
          for(const s of scripts){try{product=findProduct(JSON.parse(s.textContent||''))||product;}catch{}}
          const sizeRx=/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:[/-]\d{1,3})?)$/i;
          const normalizeSize = value => {
            const v=clean(value).toUpperCase();
            return (v.match(/^EU\s*(\d{1,3})(?:\s*\([^)]*\))?$/i)||[])[1] ||
              (v.match(/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:[/-]\d{1,3})?)(?:\s*\([^)]*\))?$/i)||[])[1] || '';
          };
          const sizes=[]; const unavailable=[];
          for(const e of all('button,[role=option],[role=radio],[role=tab],li,label')){
            if(!visible(e))continue; const value=normalizeSize(e.innerText||e.textContent);
            if(!value)continue; const disabled=e.disabled||e.getAttribute('aria-disabled')==='true'||/disabled|sold|tukendi/i.test(e.className+' '+e.innerText);
            (disabled?unavailable:sizes).push(value);
          }
          const metricRx=/göğüs|gogus|chest|bust|omuz|shoulder|bel|waist|kalça|kalca|basen|hip|uzunluk|length|kol|sleeve|inseam|uyluk|thigh|paça|paca|rise/i;
          const sizeTable=[];
          for(const table of all('table,[role=table]')){
            if(!visible(table))continue; const rows=[...table.querySelectorAll('tr,[role=row]')].map(r=>[...r.querySelectorAll('th,td,[role=cell],[role=columnheader]')].map(c=>clean(c.innerText||c.textContent))).filter(r=>r.length>1);
            if(rows.length<2)continue; const headers=rows[0];
            for(const row of rows.slice(1)){ const size=normalizeSize(row[0]); if(!size)continue; const measurements={};
              for(let i=1;i<row.length;i++) if(row[i]&&headers[i]) measurements[headers[i]]=row[i];
              if(Object.keys(measurements).length)sizeTable.push({size,measurements}); }
          }
          if(!sizeTable.length){
            const candidates=all('[role=tabpanel],[role=dialog],section,aside,div').filter(visible).map(scope=>{
              const t=clean(scope.innerText||scope.textContent);
              const r=scope.getBoundingClientRect();
              const metricHits=(t.match(/göğüs|gogus|chest|bust|omuz|shoulder|bel|waist|kalça|kalca|basen|hip|uzunluk|length|kol|sleeve|inseam|uyluk|thigh|paça|paca|rise/gi)||[]).length;
              const numberHits=(t.match(/\b\d{1,3}(?:[.,]\d+)?\b/g)||[]).length;
              return {scope,t,r,metricHits,numberHits};
            }).filter(x=>x.t.length<8000&&x.metricHits>0&&x.numberHits>1)
              .sort((a,b)=>(a.r.width*a.r.height)-(b.r.width*b.r.height));
            const scope=candidates[0]?.scope;
            if(scope){
              const leaves=[...scope.querySelectorAll('*')].filter(e=>visible(e)&&e.childElementCount===0)
                .map(e=>({e,t:clean(e.innerText||e.textContent),r:e.getBoundingClientRect()}))
                .filter(x=>x.t&&x.t.length<70);
              const headers=[];
              for(const leaf of leaves){
                const size=normalizeSize(leaf.t); if(!size)continue;
                if(!headers.some(h=>h.size===size))headers.push({size,x:leaf.r.left+leaf.r.width/2,y:leaf.r.top+leaf.r.height/2});
              }
              const metrics=leaves.filter(x=>metricRx.test(x.t)&&!normalizeSize(x.t));
              const numbers=leaves.filter(x=>/^\d{1,3}(?:[.,]\d+)?(?:\s*(?:cm|in|inç))?$/i.test(x.t));
              for(const header of headers){
                const measurements={};
                for(const metric of metrics){
                  const my=metric.r.top+metric.r.height/2;
                  const value=numbers.filter(n=>Math.abs((n.r.top+n.r.height/2)-my)<34)
                    .sort((a,b)=>Math.abs((a.r.left+a.r.width/2)-header.x)-Math.abs((b.r.left+b.r.width/2)-header.x))[0];
                  if(value&&Math.abs((value.r.left+value.r.width/2)-header.x)<150)measurements[metric.t]=value.t;
                }
                if(Object.keys(measurements).length)sizeTable.push({size:header.size,measurements});
              }
            }
          }
          if(!sizeTable.length){
            const selected=all('[aria-selected=true],[aria-checked=true],[aria-pressed=true],.selected,.active').map(e=>normalizeSize(e.innerText||e.textContent)).find(Boolean)||sizes[0]||'';
            const measurements={};
            for(const e of all('tr,li,div,p,dl')){if(!visible(e))continue;const t=clean(e.innerText||e.textContent);if(t.length>160||!metricRx.test(t))continue;
              const m=t.match(/(.{2,45}?)\s+(\d{1,3}(?:[.,]\d+)?)(?:\s*(?:cm|in|inç))?$/i);if(m)measurements[clean(m[1])]=m[2];}
            if(selected&&Object.keys(measurements).length)sizeTable.push({size:selected,measurements});
          }
          const fit=(text.match(/(?:super\s+baggy|baggy|boxy|oversized?|relaxed|straight|regular|slim|skinny|muscle|wide\s+leg)\s*(?:fit)?/i)||[])[0]||'';
          const sameOriginFrames=[...document.querySelectorAll('iframe')].filter(f=>{try{return f.contentDocument&&new URL(f.src||location.href,location.href).origin===location.origin}catch{return false}}).length;
          const crossOriginFrames=Math.max(0,document.querySelectorAll('iframe').length-sameOriginFrames);
          return { brand:clean(product?.brand?.name||product?.brand||document.querySelector('meta[property="og:site_name"]')?.content||location.hostname.split('.')[1]),
            productName:clean(product?.name||document.querySelector('meta[property="og:title"]')?.content||document.querySelector('h1')?.innerText||document.title),
            availableSizes:[...new Set(sizes)], unavailableSizes:[...new Set(unavailable)], sizeChartUrl:'', sizeTable,
            fitDescription:clean(fit), visibleText:text, notes:[], jsonLdDocuments:scripts.length, domTextLength:text.length,
            sameOriginFrames, crossOriginFrames, openShadowRoots:shadows };
        }
        """;

    private static PageEvidence ParseXhrEvidence(IEnumerable<string> bodies)
    {
        var result = new PageEvidence();
        foreach (var body in bodies.Take(12))
        {
            try
            {
                using var document = JsonDocument.Parse(body);
                WalkJson(document.RootElement, result, "");
            }
            catch (JsonException) { }
        }
        return result;
    }

    private static void WalkJson(JsonElement element, PageEvidence evidence, string parent)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                var key = property.Name;
                if (key.Contains("fit", StringComparison.OrdinalIgnoreCase) && property.Value.ValueKind == JsonValueKind.String)
                    evidence.FitDescription = property.Value.GetString() ?? evidence.FitDescription;
                if ((key.Contains("size", StringComparison.OrdinalIgnoreCase) || key.Contains("beden", StringComparison.OrdinalIgnoreCase)) &&
                    property.Value.ValueKind == JsonValueKind.String)
                {
                    var value = property.Value.GetString()?.Trim().ToUpperInvariant() ?? "";
                    if (IsSize(value)) evidence.AvailableSizes.Add(value);
                }
                WalkJson(property.Value, evidence, key);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray()) WalkJson(item, evidence, parent);
        }
    }

    private static PageEvidence MergeEvidence(PageEvidence page, PageEvidence xhr)
    {
        page.AvailableSizes = page.AvailableSizes.Concat(xhr.AvailableSizes).Distinct().ToList();
        if (string.IsNullOrWhiteSpace(page.FitDescription)) page.FitDescription = xhr.FitDescription;
        return page;
    }

    private static PageEvidence MergeVision(PageEvidence evidence, SizeChartDto chart)
    {
        if (!chart.Found) return evidence;
        evidence.SizeTable = chart.Rows.Select(row =>
        {
            var cells = row.Cells;
            var measurements = new Dictionary<string, string>();
            for (var index = 1; index < cells.Count && index < chart.Headers.Count; index++)
                measurements[chart.Headers[index]] = cells[index];
            return new AgentSizeTableRow(cells.FirstOrDefault() ?? "", measurements);
        }).Where(row => IsSize(row.Size) && row.Measurements.Values.Any(HasNumericValue)).ToList();
        return evidence;
    }

    private static async Task CaptureJsonResponseAsync(
        IResponse response, ConcurrentQueue<string> bodies, ConcurrentQueue<string> urls)
    {
        try
        {
            var body = await response.TextAsync();
            if (body.Length is > 1 and <= 250000)
            {
                bodies.Enqueue(body);
                urls.Enqueue(response.Url);
            }
        }
        catch (PlaywrightException) { }
    }

    private async Task ThrottleHostAsync(string domain, CancellationToken token)
    {
        if (!_lastHostRun.TryGetValue(domain, out var previous)) return;
        var delay = TimeSpan.FromSeconds(1) - (DateTimeOffset.UtcNow - previous);
        if (delay > TimeSpan.Zero) await Task.Delay(delay, token);
    }

    private static double CalculateConfidence(HashSet<string> sources, bool vision, bool found)
    {
        if (!found) return 0;
        var score = 0d;
        if (sources.Contains("JSON-LD")) score += .50;
        if (sources.Contains("DOM")) score += .25;
        if (sources.Contains("XHR")) score += .15;
        if (sources.Contains("SHADOW") || sources.Contains("IFRAME")) score += .05;
        score = Math.Clamp(score / .95, 0, 1);
        if (vision) score -= .20;
        return Math.Round(Math.Clamp(score, 0, 1), 2);
    }

    private static string SelectPrimarySource(HashSet<string> sources, bool vision)
    {
        if (sources.Contains("JSON-LD")) return "JSON-LD";
        if (sources.Contains("DOM")) return "DOM";
        if (sources.Contains("XHR")) return "XHR";
        if (sources.Contains("SHADOW")) return "SHADOW";
        if (sources.Contains("IFRAME")) return "IFRAME";
        return vision ? "VISION" : "DOM";
    }

    private static bool HasUsableSizeTable(PageEvidence evidence) =>
        evidence.SizeTable.Any(row =>
            IsSize(row.Size) && row.Measurements.Values.Any(HasNumericValue));

    private static bool HasNumericValue(string value) =>
        Regex.IsMatch(value ?? "", @"\d{1,3}(?:[.,]\d+)?");

    private static bool TryValidateUrl(string value, out Uri uri, out string domain)
    {
        domain = "";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps)
        {
            uri = null!;
            return false;
        }
        uri = parsed;
        domain = AllowedDomains.FirstOrDefault(item =>
            parsed.Host.Equals(item, StringComparison.OrdinalIgnoreCase) ||
            parsed.Host.EndsWith("." + item, StringComparison.OrdinalIgnoreCase)) ?? "";
        return domain.Length > 0;
    }

    private static string SafeUserAgent(string hint)
    {
        var cleaned = Regex.Replace(hint ?? "", "[\\r\\n]", "").Trim();
        return cleaned.Length is >= 30 and <= 300 ? cleaned :
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    }

    private static string MaskUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return "masked";
        return uri.GetLeftPart(UriPartial.Authority) + "/…";
    }

    private static bool IsSize(string value) =>
        SizeLabels.Contains(value) || NumericSize().IsMatch(value);

    private static AgentProductScanResponse Failure(
        AgentProductScanRequest request, Stopwatch stopwatch, int status, string note) =>
        new(request.RequestId, request.Url, "", "", [], [], "", [], "", 0,
            "DOM", [note, "Ön doğrulama gerektirir."], stopwatch.ElapsedMilliseconds, status,
            new AgentRawSourcesMeta(0, 0, 0, 0, 0, []));

    public async ValueTask DisposeAsync()
    {
        if (_browser is not null) await _browser.DisposeAsync();
        _playwright?.Dispose();
        _browserGate.Dispose();
    }

    [GeneratedRegex(@"^\d{1,3}(?:[/-]\d{1,3})?$")]
    private static partial Regex NumericSize();

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private sealed class PageEvidence
    {
        public string Brand { get; set; } = "";
        public string ProductName { get; set; } = "";
        public List<string> AvailableSizes { get; set; } = [];
        public List<string> UnavailableSizes { get; set; } = [];
        public string SizeChartUrl { get; set; } = "";
        public List<AgentSizeTableRow> SizeTable { get; set; } = [];
        public string FitDescription { get; set; } = "";
        public string VisibleText { get; set; } = "";
        public List<string> Notes { get; set; } = [];
        public int JsonLdDocuments { get; set; }
        public int DomTextLength { get; set; }
        public int SameOriginFrames { get; set; }
        public int CrossOriginFrames { get; set; }
        public int OpenShadowRoots { get; set; }
    }
}
