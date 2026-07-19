(() => {
  const CONTENT_SCRIPT_VERSION = "1.17.0";
  if (globalThis.__fitMemoryContentScriptVersion === CONTENT_SCRIPT_VERSION) {
    return;
  }
  globalThis.__fitMemoryContentScriptVersion = CONTENT_SCRIPT_VERSION;

  const SIZE_TERMS = [
    "size",
    "chest",
    "bust",
    "waist",
    "hip",
    "shoulder",
    "length",
    "sleeve",
    "inseam",
    "measure",
    "cm",
    "inch",
    "beden",
    "göğüs",
    "bel",
    "kalça",
    "omuz",
    "uzunluk",
    "kol",
    "iç bacak",
    "ölçü"
  ];
  const ORDER_CARD_SELECTORS = [
    '[data-testid*="order" i]',
    '[data-testid*="purchase" i]',
    "order-item",
    "purchase-order",
    '[class*="order-card" i]',
    '[class*="order-item" i]',
    '[class*="order-product" i]',
    '[class*="purchase-item" i]',
    '[class*="product-item" i]',
    '[class*="shipment-item" i]',
    '[id*="order-item" i]',
    '[role="listitem"]'
  ];
  const MAX_ROWS = 30;
  const MAX_COLUMNS = 12;
  const MAX_RAW_TEXT = 8000;
  let reportTimer = null;
  let rootObservationTimer = null;
  let lastFingerprint = "";
  let isCollectingSizeChart = false;
  const observedRoots = new WeakSet();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCRAPE_FITMEMORY_PAGE" ||
        message?.type === "SCRAPE_FITMEMORY_PAGE_V120") {
      scrapePageAsync()
        .then((snapshot) => sendResponse({ snapshot }))
        .catch((error) => sendResponse({ error: error?.message || "Beden tablosu okunamadı." }));
      return true;
    }

    if (message?.type === "SCAN_FITMEMORY_ORDERS" ||
        message?.type === "SCAN_FITMEMORY_ORDERS_V120") {
      scrapeOrderHistoryAsync()
        .then((history) => sendResponse({ history }))
        .catch((error) => sendResponse({ error: error?.message || "Sipariş geçmişi okunamadı." }));
      return true;
    }

    if (message?.type === "SCRAPE_FITMEMORY_PRODUCT_RESEARCH_V130" ||
        message?.type === "SCRAPE_FITMEMORY_PRODUCT_RESEARCH_V140" ||
        message?.type === "SCRAPE_FITMEMORY_PRODUCT_RESEARCH_V160") {
      scrapeProductResearchAsync()
        .then((research) => sendResponse({ research }))
        .catch((error) => sendResponse({
          error: error?.message || "Resmi ürün sayfası okunamadı."
        }));
      return true;
    }

    if (message?.type === "SHOW_FITMEMORY_RECOMMENDATION") {
      if (
        message.productUrl &&
        new URL(message.productUrl, location.href).href !== location.href
      ) {
        sendResponse({ shown: false, stale: true });
        return;
      }
      showRecommendation(message.payload);
      sendResponse({ shown: true });
      return;
    }

    if (message?.type === "CLEAR_FITMEMORY_RECOMMENDATION") {
      document.getElementById("fitmemory-page-card-host")?.remove();
      sendResponse({ cleared: true });
    }
  });

  const observer = new MutationObserver(() => {
    clearTimeout(rootObservationTimer);
    rootObservationTimer = setTimeout(observeOpenRoots, 120);
    clearTimeout(reportTimer);
    reportTimer = setTimeout(reportSnapshot, 1200);
  });

  if (document.documentElement) {
    observeRoot(document.documentElement);
    observeOpenRoots();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reportSnapshot, { once: true });
  } else {
    reportSnapshot();
  }

  function reportSnapshot() {
    if (isCollectingSizeChart) {
      return;
    }
    const snapshot = scrapePage();
    const fingerprint = `${snapshot.product.url}|${snapshot.sizeChart.rawText}`;
    if (fingerprint === lastFingerprint) {
      return;
    }
    lastFingerprint = fingerprint;
    chrome.runtime.sendMessage({
      type: "FITMEMORY_PAGE_SNAPSHOT",
      payload: snapshot
    }).catch(() => undefined);
  }

  function scrapePage() {
    return {
      product: scrapeProduct(),
      sizeChart: scrapeSizeChart(),
      capturedAt: new Date().toISOString()
    };
  }

  async function scrapePageAsync() {
    await openSizeGuideForResearch();
    return {
      product: scrapeProduct(),
      sizeChart: await scrapeSizeChartAsync(),
      capturedAt: new Date().toISOString()
    };
  }

  async function scrapeOrderHistoryAsync() {
    await expandOrderDetails();
    await hydrateVisibleOrderImages();
    return scrapeOrderHistory();
  }

  async function scrapeProductResearchAsync() {
    await openProductDetailsForResearch();
    await openSizeGuideForResearch();
    const snapshot = await scrapePageAsync();
    const fit = detectFitDetails();
    return {
      product: snapshot.product,
      sizeChart: snapshot.sizeChart?.found ? snapshot.sizeChart : null,
      fitLabel: fit.label,
      fitEvidence: fit.evidence,
      pageText: extractProductResearchText()
    };
  }

  async function openProductDetailsForResearch() {
    const roots = collectOpenRoots();
    deepQuerySelectorAll("details", roots).forEach((element) => {
      const text = cleanText(element.textContent).toLocaleLowerCase("tr");
      if (/(ürün|product|açıklama|description|detay|detail|kalıp|fit|stil|style|içerik|composition)/i.test(text)) {
        element.open = true;
      }
    });

    const controls = deepQuerySelectorAll(
      'button, [role="button"], summary',
      roots
    ).filter((element) => {
      if (!isVisible(element) || element.getAttribute("aria-expanded") === "true") {
        return false;
      }
      const text = cleanText(element.textContent).toLocaleLowerCase("tr");
      return /(ürün bilgisi|ürün detay|açıklama|içerik ve bakım|kalıp|stil|product info|product detail|description|fit|style)/i.test(text) &&
        !/(sepete|satın al|checkout|ödeme|beden seç)/i.test(text);
    }).slice(0, 6);

    for (const control of controls) {
      control.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      observeOpenRoots();
    }
  }

  async function openSizeGuideForResearch() {
    const current = scrapeSizeChart();
    if (current.requiresInteraction ||
        current.rows?.some((row) =>
          row.cells?.slice(1).some((cell) => /\d/.test(cell)))) {
      return;
    }

    const roots = collectOpenRoots();
    const triggers = deepQuerySelectorAll(
      'button, a, [role="button"], summary',
      roots
    ).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }
      const text = cleanText(element.textContent).toLocaleLowerCase("tr");
      return /(ölçüleri görüntüle|ölçüler|beden rehberi|beden tablosu|size guide|measurements?)/i
        .test(text) &&
        !/(sepete|satın al|checkout|ödeme)/i.test(text);
    });
    const trigger = triggers[0];
    if (!trigger) {
      return;
    }

    trigger.click();
    await waitForCondition(
      () => {
        const chart = scrapeSizeChart();
        return Boolean(findInteractiveMeasurePanel(collectOpenRoots())) ||
          chart.rows?.some((row) =>
            row.cells?.slice(1).some((cell) => /\d/.test(cell)));
      },
      2_500
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  function detectFitDetails() {
    const roots = collectOpenRoots();
    const targeted = deepQuerySelectorAll(
      '[data-testid*="fit" i], [class*="fit" i], [id*="fit" i], [class*="style" i], [class*="description" i], main',
      roots
    ).filter(isVisible);
    const text = [
      ...targeted.map((element) => cleanText(deepElementText(element))),
      ...roots.map((root) => cleanText(deepElementText(root)))
    ].join(" ").slice(0, 100_000);
    const patterns = [
      { label: "Boxy Fit", pattern: /\bboxy\s*(?:fit|cut|kalıp)?\b/i },
      { label: "Oversize Fit", pattern: /\b(?:oversized?|over size)\s*(?:fit|kalıp)?\b/i },
      { label: "Relaxed Fit", pattern: /\b(?:relaxed|comfort)\s*(?:fit|kalıp)?\b/i },
      { label: "Regular Fit", pattern: /\b(?:regular|standard|standart)\s+(?:fit|cut|kalıp)\b/i },
      { label: "Slim Fit", pattern: /\b(?:slim|skinny|fitted)\s+(?:fit|cut|kalıp)\b/i },
      { label: "Loose Fit", pattern: /\b(?:loose|wide)\s*(?:fit|kalıp)?\b/i },
      { label: "Rahat Kalıp", pattern: /\brahat\s+kalıp\b/i },
      { label: "Dar Kalıp", pattern: /\bdar\s+kalıp\b/i },
      { label: "Bol Kalıp", pattern: /\bbol\s+kalıp\b/i }
    ];
    for (const candidate of patterns) {
      const match = candidate.pattern.exec(text);
      if (match) {
        const start = Math.max(0, match.index - 70);
        const end = Math.min(text.length, match.index + match[0].length + 120);
        return {
          label: candidate.label,
          evidence: cleanText(text.slice(start, end)).slice(0, 300)
        };
      }
    }
    return { label: "", evidence: "" };
  }

  function extractProductResearchText() {
    const roots = collectOpenRoots();
    const selectors = [
      "main",
      '[class*="product-detail" i]',
      '[class*="description" i]',
      '[class*="composition" i]',
      '[class*="fit" i]',
      '[data-testid*="fit" i]',
      '[class*="style" i]'
    ];
    return deepQuerySelectorAll(selectors.join(","), roots)
      .filter(isVisible)
      .map((element) => sanitizeInlineText(deepElementText(element)))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" · ")
      .slice(0, 5_000);
  }

  function scrapeProduct() {
    const productJson = findProductJsonLd();
    const roots = collectOpenRoots();
    const hostname = location.hostname.replace(/^www\./, "");
    const siteName = getMeta("property", "og:site_name");
    const title = selectProductTitle(productJson, roots);
    const brand =
      cleanText(typeof productJson?.brand === "string" ? productJson.brand : productJson?.brand?.name) ||
      cleanText(siteName) ||
      hostname.split(".")[0].replace(/(^\w|\s\w)/g, (letter) => letter.toUpperCase());
    const category =
      cleanText(productJson?.category) ||
      cleanText(deepQuerySelectorAll('[aria-label*="breadcrumb" i] li:nth-last-child(2)', roots)[0]?.textContent) ||
      cleanText(deepQuerySelectorAll("nav ol li:nth-last-child(2)", roots)[0]?.textContent) ||
      "Unspecified";
    const offers = Array.isArray(productJson?.offers) ? productJson.offers[0] : productJson?.offers;
    const price =
      cleanText(offers?.price) ||
      cleanText(getMeta("property", "product:price:amount")) ||
      cleanText(deepQuerySelectorAll('[itemprop="price"]', roots)[0]?.getAttribute("content")) ||
      cleanText(deepQuerySelectorAll('[itemprop="price"]', roots)[0]?.textContent);
    const currency =
      cleanText(offers?.priceCurrency) ||
      cleanText(getMeta("property", "product:price:currency")) ||
      "";
    const fit = detectFitDetails();
    const productReference = detectProductReference(productJson);
    const model = detectModelDetails(roots);
    const description = selectProductDescription(productJson, roots);

    return {
      url: location.href,
      brand: brand.slice(0, 120),
      name: title.slice(0, 240),
      category: category.slice(0, 120),
      price: [price, currency].filter(Boolean).join(" ").slice(0, 80),
      imageUrl: selectProductImage(
        productJson,
        roots,
        title,
        brand,
        productReference).slice(0, 1000),
      productReference: productReference.slice(0, 120),
      fitLabel: fit.label,
      fitEvidence: fit.evidence,
      description: description.slice(0, 1200),
      modelHeightCm: model.heightCm,
      modelWornSize: model.size,
      modelEvidence: model.evidence
    };
  }

  function selectProductImage(
    productJson,
    roots,
    title,
    brand,
    productReference) {
    const candidates = new Map();
    const titleTokens = cleanText(title)
      .toLocaleLowerCase("tr")
      .split(/\s+/)
      .filter((token) => token.length >= 4);
    const imageIdentity = productImageIdentity(productReference);
    const rejectedMediaPattern =
      /(logo|brandmark|wordmark|sprite|avatar|payment|badge|flag|favicon|spacer|pixel|transparent|placeholder|no-image|image-not-found|size[-_ ]?guide|measurement|measure[-_ ]?how|dimension|ölçü)/i;

    const addCandidate = (
      rawUrl,
      element = null,
      rawAlt = "",
      sourceScore = 0) => {
      const url = cleanImageUrl(rawUrl);
      if (!url) {
        return;
      }

      const alt = cleanText(rawAlt);
      const path = new URL(url).pathname;
      const context = imageElementContext(element);
      const rejectionText = `${path} ${alt} ${context}`;
      if (rejectedMediaPattern.test(rejectionText) ||
          element?.closest?.("header, nav, footer")) {
        return;
      }

      const rect = element?.getBoundingClientRect?.();
      const renderedArea = rect
        ? Math.max(0, rect.width) * Math.max(0, rect.height)
        : 0;
      const naturalWidth = Number(element?.naturalWidth || 0);
      const naturalHeight = Number(element?.naturalHeight || 0);
      const naturalArea = naturalWidth * naturalHeight;
      const ratio = naturalWidth > 0 && naturalHeight > 0
        ? naturalWidth / naturalHeight
        : 0;
      if (naturalArea > 0 && naturalArea <= 4_096) {
        return;
      }

      let score =
        sourceScore +
        Math.min(30, Math.sqrt(renderedArea) / 12) +
        Math.min(28, Math.sqrt(naturalArea) / 70);
      if (element?.closest?.("main")) {
        score += 16;
      }
      if (/(gallery|carousel|product[-_ ]?(?:media|image|photo)|pdp[-_ ]?(?:media|image)|zoom)/i.test(context)) {
        score += 34;
      }
      if (/(recommend|related|similar|complete[-_ ]?look|thumbnail)/i.test(context)) {
        score -= 22;
      }
      if (ratio >= 0.48 && ratio <= 1.35) {
        score += 18;
      } else if (ratio >= 2.2 || (ratio > 0 && ratio <= 0.25)) {
        score -= 22;
      }
      if (element && isVisible(element)) {
        score += 10;
      }
      if (titleTokens.some((token) =>
        alt.toLocaleLowerCase("tr").includes(token))) {
        score += 12;
      }
      if (brand &&
          alt.toLocaleLowerCase("tr") ===
            cleanText(brand).toLocaleLowerCase("tr")) {
        score -= 35;
      }
      const compactUrl = decodeURIComponent(url)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const styleMatches = imageIdentity.styleTokens.some((token) =>
        token.length >= 6 && compactUrl.includes(token));
      const colorMatches = imageIdentity.colorToken &&
        compactUrl.includes(imageIdentity.colorToken);
      if (styleMatches) {
        score += 105;
      } else if (imageIdentity.styleTokens.length > 0 &&
                 /\d{7,}/.test(compactUrl)) {
        score -= 55;
      }
      if (styleMatches && colorMatches) {
        score += 45;
      }
      const linkedProduct = element
        ? findLinkedProductUrl(element)
        : "";
      if (linkedProduct) {
        const linkedIdentity = productImageIdentity(linkedProduct);
        const sameLinkedStyle = linkedIdentity.styleTokens.some((token) =>
          imageIdentity.styleTokens.includes(token));
        score += sameLinkedStyle ? 28 : -80;
      }

      const existing = candidates.get(url);
      if (!existing || score > existing.score) {
        candidates.set(url, { url, score });
      }
    };

    for (const value of structuredImageValues(productJson?.image)) {
      addCandidate(value, null, title, 72);
    }
    addCandidate(
      getMeta("property", "og:image"),
      null,
      getMeta("property", "og:image:alt") || title,
      38);
    addCandidate(
      getMeta("name", "twitter:image"),
      null,
      getMeta("name", "twitter:image:alt") || title,
      34);

    const media = deepQuerySelectorAll(
      "main img, main picture source, [data-testid*='product' i] img, [class*='product' i] img, [class*='gallery' i] img, [class*='carousel' i] img, img",
      roots
    ).slice(0, 800);
    for (const element of media) {
      const alt =
        element.getAttribute("alt") ||
        composedParent(element)?.getAttribute?.("aria-label") ||
        "";
      const directValues = [
        element.currentSrc,
        element.src,
        element.getAttribute("src"),
        element.getAttribute("data-src"),
        element.getAttribute("data-original"),
        element.getAttribute("data-lazy-src"),
        element.getAttribute("data-image"),
        element.getAttribute("data-zoom-image")
      ];
      directValues.forEach((value, index) =>
        addCandidate(value, element, alt, index < 2 ? 42 : 32));

      const srcsets = [
        element.getAttribute("srcset"),
        element.getAttribute("data-srcset")
      ].filter(Boolean);
      for (const srcset of srcsets) {
        srcset
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/)[0])
          .filter(Boolean)
          .forEach((value, index, values) =>
            addCandidate(
              value,
              element,
              alt,
              38 + index / Math.max(values.length, 1) * 8));
      }
    }

    const backgrounds = deepQuerySelectorAll(
      "main [style], main [data-bg], main [data-background], main [data-background-image]",
      roots
    ).slice(0, 300);
    for (const element of backgrounds) {
      const values = [
        element.getAttribute("data-bg"),
        element.getAttribute("data-background"),
        element.getAttribute("data-background-image"),
        getComputedStyle(element).backgroundImage
      ].filter(Boolean);
      const alt =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        "";
      for (const value of values) {
        const matches = String(value).matchAll(
          /url\(\s*(['"]?)(.*?)\1\s*\)/gi);
        for (const match of matches) {
          addCandidate(match[2], element, alt, 28);
        }
      }
    }

    return [...candidates.values()]
      .sort((left, right) => right.score - left.score)[0]?.url || "";
  }

  function productImageIdentity(productReference) {
    let identityUrl = null;
    if (/^https?:/i.test(cleanText(productReference))) {
      try {
        identityUrl = new URL(productReference);
      } catch {
        identityUrl = null;
      }
    }
    const referenceDigits = cleanText(productReference)
      .replace(/\D/g, "")
      .replace(/^0+/, "");
    const pathDigits = decodeURIComponent(
      identityUrl?.pathname || location.pathname)
      .replace(/\D/g, "")
      .replace(/^0+/, "");
    const styleTokens = [
      referenceDigits,
      pathDigits,
      referenceDigits.length >= 8
        ? referenceDigits.slice(0, 7)
        : "",
      pathDigits.length >= 8
        ? pathDigits.slice(0, 7)
        : ""
    ]
      .filter((value) => value.length >= 6)
      .filter((value, index, values) => values.indexOf(value) === index);
    const colorToken = cleanText(
      (identityUrl || new URL(location.href))
        .searchParams.get("cS") || "")
      .replace(/\D/g, "");
    return { styleTokens, colorToken };
  }

  function structuredImageValues(value) {
    if (!value) {
      return [];
    }
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap(structuredImageValues);
    }
    if (typeof value === "object") {
      return [
        value.url,
        value.contentUrl,
        value.thumbnailUrl
      ].flatMap(structuredImageValues);
    }
    return [];
  }

  function imageElementContext(element) {
    const values = [];
    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1) {
      values.push(
        current.id || "",
        typeof current.className === "string" ? current.className : "",
        current.getAttribute?.("data-testid") || "",
        current.getAttribute?.("aria-label") || "");
      current = composedParent(current);
    }
    return cleanText(values.join(" ")).slice(0, 1_500);
  }

  function selectProductDescription(productJson, roots) {
    const structured = cleanText(productJson?.description);
    const visible = deepQuerySelectorAll(
      '[data-testid*="description" i], [class*="description" i], [class*="product-info" i], [class*="product-detail" i] details, main details',
      roots
    )
      .filter(isVisible)
      .map((element) => cleanText(deepElementText(element)))
      .filter((text) => text.length >= 24 && text.length <= 2_500)
      .sort((left, right) => {
        const leftScore = descriptionEvidenceScore(left);
        const rightScore = descriptionEvidenceScore(right);
        return rightScore - leftScore || left.length - right.length;
      })[0] || "";
    return (structured || visible).slice(0, 1_200);
  }

  function descriptionEvidenceScore(text) {
    const normalized = text.toLocaleLowerCase("tr");
    return [
      /(ürün|product|açıklama|description)/i.test(normalized) ? 4 : 0,
      /(model|beden|size|boy|height)/i.test(normalized) ? 3 : 0,
      /(pamuk|cotton|polyester|kumaş|fabric)/i.test(normalized) ? 2 : 0,
      /(relax|boxy|regular|oversize|kalıp|fit)/i.test(normalized) ? 3 : 0
    ].reduce((sum, value) => sum + value, 0);
  }

  function detectModelDetails(roots) {
    const text = cleanText([
      ...deepQuerySelectorAll(
        '[class*="model" i], [data-testid*="model" i], [class*="description" i], [class*="product-info" i], main',
        roots
      )
        .filter(isVisible)
        .map((element) => deepElementText(element)),
      document.body?.innerText || ""
    ].join(" ")).slice(0, 120_000);
    const modelIndex = text.search(/\bmodel(?:in)?\b/i);
    if (modelIndex < 0) {
      return { heightCm: null, size: "", evidence: "" };
    }

    const segment = text
      .slice(Math.max(0, modelIndex - 80), modelIndex + 420);
    const heightMatch = segment.match(
      /\b(1[5-9]\d|2[0-1]\d)\s*(?:cm|santimetre)\b/i);
    const sizePatterns = [
      /(?:beden(?:i)?|size)\s*[:.-]?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})\b/i,
      /\b(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})\s*beden(?:i)?\s*(?:giy|kullan|wear)/i,
      /(?:giyiyor|giymektedir|wears?|wearing)\s*[:.-]?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})\b/i
    ];
    const sizeMatch = sizePatterns
      .map((pattern) => segment.match(pattern))
      .find(Boolean);
    const heightCm = heightMatch
      ? Number.parseInt(heightMatch[1], 10)
      : null;
    const size = cleanText(sizeMatch?.[1] || "").toUpperCase();
    if (!heightCm && !size) {
      return { heightCm: null, size: "", evidence: "" };
    }
    return {
      heightCm,
      size,
      evidence: sanitizeInlineText(segment).slice(0, 300)
    };
  }

  function selectProductTitle(productJson, roots) {
    const structuredTitle = cleanText(productJson?.name);
    const headingTitles = deepQuerySelectorAll(
      "main h1, [data-testid*='product' i] h1, h1",
      roots
    )
      .filter(isVisible)
      .map((element) => cleanText(element.textContent))
      .filter(Boolean);
    const socialTitle = cleanText(getMeta("property", "og:title"));
    const documentTitle = cleanText(document.title);
    const candidates = [
      structuredTitle,
      ...headingTitles,
      socialTitle,
      productTitleFromUrl(),
      documentTitle
    ];
    return candidates.find((value) =>
      value &&
      !isGenericRetailTitle(value)) ||
      productTitleFromUrl() ||
      documentTitle;
  }

  function isGenericRetailTitle(value) {
    const normalized = cleanText(value).toLocaleLowerCase("tr");
    if (normalized.length < 4) {
      return true;
    }
    const generic =
      /^(?:indirim|sale|erkek|kadın|kadin|çocuk|cocuk|yeni koleksiyon|new collection)$/i;
    return generic.test(normalized) ||
      /(?:favori (?:erkek|kadın|kadin) ürünleri|tüm ürünler|tum urunler|yaz indirimi|kış indirimi|kis indirimi|online alışveriş|online alisveris)/i
        .test(normalized);
  }

  function productTitleFromUrl() {
    try {
      const segments = decodeURIComponent(location.pathname)
        .split("/")
        .filter(Boolean);
      const slug = segments.at(-1) || "";
      const withoutProductCode = slug
        .replace(/[-_](?:c0)?[pl]\d{6,14}.*$/i, "")
        .replace(/[-_]l\d{6,14}.*$/i, "")
        .replace(/\.[a-z0-9]+$/i, "");
      return cleanText(
        withoutProductCode
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("tr"))
      );
    } catch {
      return "";
    }
  }

  function detectProductReference(productJson) {
    const structured = [
      productJson?.productID,
      productJson?.sku,
      productJson?.mpn,
      productJson?.gtin,
      getMeta("property", "product:retailer_item_id"),
      getMeta("name", "product_id")
    ].map(cleanText).find(Boolean);

    const pathMatch = location.pathname.match(/(?:^|[-_/])(?:c0)?([pl]\d{7,12})(?:[./_-]|$)/i);
    if (pathMatch) {
      return pathMatch[1].toUpperCase();
    }
    if (structured) {
      return structured;
    }

    const visibleText = cleanText(document.body?.innerText || "").slice(0, 80_000);
    const referenceMatch = visibleText.match(
      /(?:ref(?:erans)?|reference|ürün\s*kodu|product\s*code)\s*[.:#-]?\s*([a-z0-9/.-]{5,40})/i
    );
    return cleanText(referenceMatch?.[1] || "");
  }

  function scrapeSizeChart() {
    const roots = collectOpenRoots();
    const interactivePanel = findInteractiveMeasurePanel(roots);
    if (interactivePanel) {
      const panelText = cleanText(interactivePanel.root.textContent);
      return {
        found: true,
        title: "Ürün ölçüleri",
        unit: inferUnit(panelText),
        headers: [],
        rows: [],
        rawText: panelText.slice(0, MAX_RAW_TEXT),
        requiresInteraction: true
      };
    }

    const tableCandidates = deepQuerySelectorAll("table, [role='table']", roots)
      .filter(isVisible)
      .map((element) => {
        const matrix = extractMatrix(element);
        return {
          element,
          matrix,
          score: scoreMatrix(matrix, element)
        };
      })
      .filter((candidate) => candidate.matrix.length > 1)
      .sort((left, right) => right.score - left.score);

    const bestTable = tableCandidates[0];
    if (bestTable && bestTable.score >= 4) {
      const headers = inferHeaders(bestTable.matrix);
      const dataRows = headers.consumedFirstRow ? bestTable.matrix.slice(1) : bestTable.matrix;
      return {
        found: true,
        title: findChartTitle(bestTable.element),
        unit: inferUnit(bestTable.matrix.flat().join(" ")),
        headers: headers.values,
        rows: dataRows.slice(0, MAX_ROWS).map((cells) => ({
          cells: padCells(cells, headers.values.length)
        })),
        rawText: bestTable.matrix.map((row) => row.join(" | ")).join("\n").slice(0, MAX_RAW_TEXT),
        requiresInteraction: false
      };
    }

    const textCandidate = findSizeGuideText(roots);
    if (textCandidate) {
      return {
        found: true,
        title: textCandidate.title,
        unit: inferUnit(textCandidate.text),
        headers: [],
        rows: [],
        rawText: textCandidate.text.slice(0, MAX_RAW_TEXT),
        requiresInteraction: false
      };
    }

    return {
      found: false,
      title: "",
      unit: "Unknown",
      headers: [],
      rows: [],
      rawText: "",
      requiresInteraction: false
    };
  }

  async function scrapeSizeChartAsync() {
    const roots = collectOpenRoots();
    const interactivePanel = findInteractiveMeasurePanel(roots);
    if (!interactivePanel) {
      return scrapeSizeChart();
    }

    const collected = await collectInteractiveSizeChart(interactivePanel);
    return collected || scrapeSizeChart();
  }

  function findInteractiveMeasurePanel(roots) {
    for (const root of roots) {
      const table = findBestMeasureTable(root);
      if (!table) {
        continue;
      }

      const panelRoot = findMeasurePanelRoot(table, root);
      const sizeButtons = findMeasureSizeButtons(panelRoot);
      const rootText = cleanText(
        panelRoot instanceof Document
          ? panelRoot.body?.innerText ||
            panelRoot.documentElement?.textContent ||
            ""
          : panelRoot.textContent || ""
      ).toLocaleLowerCase("tr");
      const looksLikeMeasures =
        /(ölçüler|ölçüleri|measurements?|size guide)/i.test(rootText) &&
        /(göğüs|gogus|chest|bel|waist|uzunluk|length|kol|sleeve)/i.test(rootText);
      if (looksLikeMeasures && sizeButtons.length >= 2) {
        return { root: panelRoot, table, sizeButtons };
      }
    }
    return null;
  }

  async function collectInteractiveSizeChart(panel) {
    const initialButton = panel.sizeButtons.find(isSizeButtonSelected);
    const initialLabel = cleanText(initialButton?.textContent);
    const sizeLabels = panel.sizeButtons
      .map((button) => cleanText(button.textContent).toUpperCase())
      .filter(isSizeLabel)
      .filter((size, index, values) => values.indexOf(size) === index);
    const records = [];
    let canonicalHeaders = null;

    isCollectingSizeChart = true;
    try {
      for (const size of sizeLabels.slice(0, 20)) {
        const button = findMeasureSizeButtons(panel.root)
          .find((candidate) =>
            cleanText(candidate.textContent).toUpperCase() === size);
        if (!button) {
          continue;
        }

        if (!isSizeButtonSelected(button)) {
          const beforeSignature = measureTableSignature(panel.root);
          button.click();
          await waitForCondition(
            () =>
              isSizeButtonSelected(button) ||
              measureTableSignature(panel.root) !== beforeSignature,
            1_200
          );
          await new Promise((resolve) => setTimeout(resolve, 140));
        }

        const currentTable = findBestMeasureTable(panel.root);
        const record = extractSelectedSizeRecord(currentTable, size);
        if (!record || record.values.length < 2) {
          continue;
        }
        canonicalHeaders ||= record.headers;
        records.push({
          cells: padCells(record.values, canonicalHeaders.length)
        });
      }
    } finally {
      const restoreButton = initialLabel
        ? findMeasureSizeButtons(panel.root).find((button) =>
            cleanText(button.textContent) === initialLabel)
        : null;
      if (restoreButton && !isSizeButtonSelected(restoreButton)) {
        restoreButton.click();
        await waitForCondition(
          () => isSizeButtonSelected(restoreButton),
          800
        );
      }
      isCollectingSizeChart = false;
    }

    if (!canonicalHeaders || records.length === 0) {
      return null;
    }

    const note = Array.from(panel.root.querySelectorAll(".note"))
      .map((element) => cleanText(element.textContent))
      .filter(Boolean)
      .join(" ");
    const rawLines = [
      canonicalHeaders.join(" | "),
      ...records.map((row) => row.cells.join(" | ")),
      note
    ].filter(Boolean);

    return {
      found: true,
      title: "Ürün ölçüleri",
      unit: "Centimeters",
      headers: canonicalHeaders,
      rows: records,
      rawText: rawLines.join("\n").slice(0, MAX_RAW_TEXT),
      requiresInteraction: false
    };
  }

  function findMeasureSizeButtons(root) {
    return Array.from(root.querySelectorAll?.(
      [
        'button[role="radio"]',
        '[role="radio"]',
        'button[aria-pressed]',
        'button[aria-selected]',
        '[role="option"]',
        "button"
      ].join(",")
    ) || [])
      .filter(isVisible)
      .filter((button) =>
        isSizeLabel(cleanText(button.textContent)));
  }

  function isSizeButtonSelected(button) {
    if (!button) {
      return false;
    }

    if (
      button.getAttribute("aria-checked") === "true" ||
      button.getAttribute("aria-selected") === "true" ||
      button.getAttribute("aria-pressed") === "true"
    ) {
      return true;
    }

    const stateText = cleanText([
      button.getAttribute("data-state"),
      button.getAttribute("data-selected"),
      button.className
    ].join(" ")).toLowerCase();
    return /(?:^|\s|[-_])(active|checked|selected)(?:$|\s|[-_])/.test(
      stateText);
  }

  function measureTableSignature(root) {
    const table = findBestMeasureTable(root);
    if (!table) {
      return "";
    }
    const matrix = extractMatrix(table);
    return matrix.length > 0
      ? matrix.map((row) => row.join("|")).join("\n")
      : cleanText(table.textContent);
  }

  function findBestMeasureTable(root) {
    const candidates = Array.from(root.querySelectorAll?.(
      "table.sizes-table, table, [role='table']"
    ) || [])
      .filter(isVisible)
      .map((table) => {
        const matrix = extractMatrix(table);
        const text = cleanText(
          matrix.length > 0
            ? matrix.flat().join(" ")
            : table.textContent || ""
        ).toLocaleLowerCase("tr");
        const metricMatches = (
          text.match(
            /göğüs|gogus|chest|bel|waist|uzunluk|length|kol|sleeve/g
          ) || []
        ).length;
        const numericMatches = (text.match(/\d+(?:[.,]\d+)?/g) || [])
          .length;
        return {
          table,
          score:
            scoreMatrix(matrix, table) +
            Math.min(metricMatches * 3, 15) +
            Math.min(numericMatches, 12)
        };
      })
      .filter((candidate) => candidate.score >= 6)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.table || null;
  }

  function findMeasurePanelRoot(table, boundary) {
    let current = table.parentElement;
    while (current) {
      const text = cleanText(current.textContent)
        .toLocaleLowerCase("tr");
      const sizeButtons = findMeasureSizeButtons(current);
      if (
        sizeButtons.length >= 2 &&
        /(göğüs|gogus|chest|bel|waist|uzunluk|length|kol|sleeve)/i
          .test(text)
      ) {
        return current;
      }
      if (current === boundary || !current.parentElement) {
        break;
      }
      current = current.parentElement;
    }
    return boundary;
  }

  function extractSelectedSizeRecord(table, size) {
    if (!table) {
      return null;
    }
    const matrix = extractMatrix(table);
    const unitHeaders = (matrix[0] || [])
      .map((value) => value.toLocaleLowerCase("tr"));
    const cmIndex = unitHeaders.findIndex((value) =>
      value === "cm" || value.includes("santimetre"));
    const valueIndex = cmIndex >= 0 ? cmIndex : 1;
    let measurements = matrix.length >= 2
      ? matrix
      .slice(1)
      .filter((row) => row.length > valueIndex)
      .map((row) => ({
        label: normalizeMeasurementLabel(row[0]),
        value: row[valueIndex]
      }))
      .filter((item) => item.label && /\d/.test(item.value))
      : [];
    if (measurements.length === 0) {
      measurements = extractMeasurementsFromTableText(table);
    }

    return {
      headers: ["Beden", ...measurements.map((item) => item.label)],
      values: [size, ...measurements.map((item) => item.value)]
    };
  }

  function extractMeasurementsFromTableText(table) {
    const text = String(table.innerText || table.textContent || "");
    const pattern =
      /(göğüs|gogus|chest|bust|ön\s*uzunluk|front\s*length|kol\s*uzunluğu|kol\s*uzunlugu|sleeve(?:\s*length)?|bel|waist|kalça|kalca|hip|omuz|shoulder|iç\s*bacak|ic\s*bacak|inseam)\s*[:\-]?\s*(\d{1,3}(?:[.,]\d+)?)/giu;
    const measurements = [];
    const seen = new Set();
    for (const match of text.matchAll(pattern)) {
      const label = normalizeMeasurementLabel(match[1]);
      const value = match[2];
      if (!label || !value || seen.has(label)) {
        continue;
      }
      seen.add(label);
      measurements.push({ label, value });
    }
    return measurements;
  }

  function normalizeMeasurementLabel(value) {
    const normalized = cleanText(value);
    const lower = normalized.toLocaleLowerCase("tr");
    if (/^(göğüs|gogus|chest|bust)$/.test(lower)) {
      return "Göğüs eni";
    }
    if (/ön uzunluk|front length/.test(lower)) {
      return "Ön uzunluk";
    }
    if (/kol uzunluğu|kol uzunlugu|sleeve/.test(lower)) {
      return "Kol uzunluğu";
    }
    if (/bel|waist/.test(lower)) {
      return "Bel eni";
    }
    if (/kalça|kalca|hip/.test(lower)) {
      return "Kalça eni";
    }
    if (/omuz|shoulder/.test(lower)) {
      return "Omuz";
    }
    if (/iç bacak|ic bacak|inseam/.test(lower)) {
      return "İç bacak";
    }
    return normalized.slice(0, 120);
  }

  function isSizeLabel(value) {
    return /^(?:XXXXL|XXXL|XXL|XL|L|M|S|XS|XXS|XXXS|\d{1,3}(?:[/-]\d{1,3})?)$/i.test(
      cleanText(value)
    );
  }

  async function waitForCondition(predicate, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  function collectOpenRoots(start = document, maxRoots = 120) {
    const roots = [];
    const queue = [start];
    const visited = new WeakSet();

    while (queue.length > 0 && roots.length < maxRoots) {
      const root = queue.shift();
      if (!root || visited.has(root)) {
        continue;
      }
      visited.add(root);
      roots.push(root);

      if (root instanceof Element && root.shadowRoot) {
        queue.push(root.shadowRoot);
      }

      const elements = Array.from(root.querySelectorAll?.("*") || []);
      for (const element of elements) {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          queue.push(element.shadowRoot);
        }
      }
    }

    return roots;
  }

  function deepQuerySelectorAll(selector, roots = collectOpenRoots()) {
    const results = [];
    const seen = new Set();

    for (const root of roots) {
      if (root instanceof Element && root.matches(selector) && !seen.has(root)) {
        seen.add(root);
        results.push(root);
      }
      for (const element of Array.from(root.querySelectorAll?.(selector) || [])) {
        if (!seen.has(element)) {
          seen.add(element);
          results.push(element);
        }
      }
    }

    return results;
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) {
      return;
    }
    try {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "open", "aria-hidden", "aria-checked"]
      });
      observedRoots.add(root);
    } catch {
      return;
    }
  }

  function observeOpenRoots() {
    for (const root of collectOpenRoots()) {
      if (root instanceof ShadowRoot) {
        observeRoot(root);
      }
    }
  }

  function deepElementText(element) {
    if (!element) {
      return "";
    }
    const parts = [element.innerText || element.textContent || ""];
    for (const root of collectOpenRoots(element)) {
      if (root instanceof ShadowRoot) {
        parts.push(root.textContent || "");
      }
    }
    return parts.join("\n");
  }

  function composedParent(element) {
    if (!element) {
      return null;
    }
    if (element.parentElement) {
      return element.parentElement;
    }
    const root = element.getRootNode?.();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function deepContains(ancestor, descendant) {
    let current = descendant;
    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = composedParent(current);
    }
    return false;
  }

  function extractMatrix(element) {
    const rowElements = element.matches("table")
      ? Array.from(element.querySelectorAll("tr"))
      : Array.from(element.querySelectorAll('[role="row"]'));

    return rowElements
      .slice(0, MAX_ROWS + 1)
      .map((row) => {
        const cells = row.matches("tr")
          ? Array.from(row.querySelectorAll(":scope > th, :scope > td"))
          : Array.from(row.querySelectorAll('[role="columnheader"], [role="cell"], [role="rowheader"]'));
        return cells
          .slice(0, MAX_COLUMNS)
          .map((cell) => cleanText(cell.textContent).slice(0, 120))
          .filter(Boolean);
      })
      .filter((row) => row.length > 0);
  }

  function scoreMatrix(matrix, element) {
    const text = matrix.flat().join(" ").toLowerCase();
    const termScore = SIZE_TERMS.reduce((score, term) => score + (text.includes(term) ? 2 : 0), 0);
    const numericCells = matrix.flat().filter((cell) => /\d/.test(cell)).length;
    const sizeLabels = matrix.flat().filter((cell) => /^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,3})$/i.test(cell.trim())).length;
    const context = cleanText(element.parentElement?.textContent).slice(0, 500).toLowerCase();
    const contextScore = /size\s*(guide|chart)|measurements?|beden\s*(rehberi|tablosu)|ölçüler?/.test(context) ? 4 : 0;
    return termScore + Math.min(numericCells, 8) + Math.min(sizeLabels * 2, 8) + contextScore;
  }

  function inferHeaders(matrix) {
    const first = matrix[0] || [];
    const hasHeaderCells = first.some((cell) => SIZE_TERMS.some((term) => cell.toLowerCase().includes(term)));
    const mostlyNonNumeric = first.filter((cell) => !/\d/.test(cell)).length >= Math.ceil(first.length / 2);
    if (hasHeaderCells || mostlyNonNumeric) {
      return {
        values: first.map((cell, index) => cell || `Column ${index + 1}`),
        consumedFirstRow: true
      };
    }

    return {
      values: first.map((_cell, index) => (index === 0 ? "Size" : `Measurement ${index}`)),
      consumedFirstRow: false
    };
  }

  function padCells(cells, length) {
    return Array.from({ length: Math.max(length, cells.length) }, (_unused, index) => cells[index] || "");
  }

  function findChartTitle(element) {
    const caption = cleanText(element.querySelector("caption")?.textContent);
    if (caption) {
      return caption.slice(0, 160);
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const root = element.getRootNode?.();
      const labelled = cleanText(
        root?.getElementById?.(labelledBy)?.textContent ||
        document.getElementById(labelledBy)?.textContent
      );
      if (labelled) {
        return labelled.slice(0, 160);
      }
    }

    let previous = element.previousElementSibling;
    for (let index = 0; index < 3 && previous; index += 1) {
      const text = cleanText(previous.textContent);
      if (text && text.length <= 160) {
        return text;
      }
      previous = previous.previousElementSibling;
    }

    return "Product size guide";
  }

  function findSizeGuideText(roots = collectOpenRoots()) {
    const selectors = [
      '[class*="size-chart" i]',
      '[class*="sizechart" i]',
      '[class*="size-guide" i]',
      '[class*="sizeguide" i]',
      '[id*="size-chart" i]',
      '[id*="sizeguide" i]',
      '[aria-label*="size guide" i]',
      '[aria-label*="size chart" i]',
      '[aria-label*="ölçü" i]',
      "measures-app"
    ];

    const candidates = deepQuerySelectorAll(selectors.join(","), roots)
      .filter(isVisible)
      .map((element) => {
        const text = cleanText(deepElementText(element));
        const lower = text.toLowerCase();
        const score =
          SIZE_TERMS.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0) +
          Math.min((text.match(/\d/g) || []).length / 3, 8);
        return { element, text, score };
      })
      .filter((candidate) => candidate.text.length >= 30 && candidate.text.length <= 12000)
      .sort((left, right) => right.score - left.score);

    const best = candidates[0];
    if (!best || best.score < 5) {
      return null;
    }

    return {
      title: cleanText(best.element.getAttribute("aria-label")) || "Product size guide",
      text: best.text
    };
  }

  function inferUnit(text) {
    const normalized = text.toLowerCase();
    if (/\b(inch|inches|in\.)\b/.test(normalized) && /\bcm\b/.test(normalized)) {
      return "Mixed";
    }
    if (/\b(inch|inches|in\.)\b/.test(normalized)) {
      return "Inches";
    }
    if (/\bcm\b|centimet|santimetre/.test(normalized)) {
      return "Centimeters";
    }
    return "Unknown";
  }

  function findProductJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent);
        const product = findTypedObject(parsed, "Product");
        if (product) {
          return product;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function findTypedObject(value, type) {
    if (!value || typeof value !== "object") {
      return null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findTypedObject(item, type);
        if (found) {
          return found;
        }
      }
      return null;
    }
    const objectType = value["@type"];
    if (objectType === type || (Array.isArray(objectType) && objectType.includes(type))) {
      return value;
    }
    for (const nested of Object.values(value)) {
      const found = findTypedObject(nested, type);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function getMeta(attribute, value) {
    return document.querySelector(`meta[${attribute}="${CSS.escape(value)}"]`)?.getAttribute("content") || "";
  }

  function scrapeOrderHistory() {
    const roots = collectOpenRoots();
    const candidates = new Set();
    for (const selector of ORDER_CARD_SELECTORS) {
      deepQuerySelectorAll(selector, roots).forEach((element) => candidates.add(element));
    }

    const pageContext = cleanText([
      location.pathname,
      document.title,
      ...deepQuerySelectorAll("h1, h2", roots)
        .slice(0, 12)
        .map((heading) => heading.textContent)
    ].join(" ")).toLowerCase();
    const looksLikeOrderPage =
      /(orders?|purchases?|order.?history|sipari[sş]|satın.?al|geçmiş)/i.test(pageContext);
    const isBershkaOrderDetail =
      isBershkaOrderDetailPage();
    if (looksLikeOrderPage) {
      deepQuerySelectorAll("article, li, [role='listitem']", roots)
        .slice(0, 800)
        .forEach((element) => candidates.add(element));
    }
    if (isBershkaOrderDetail) {
      collectBershkaOrderDetailCandidates(roots)
        .forEach((element) => candidates.add(element));
    }

    const detailControls = deepQuerySelectorAll("button, [role='button']", roots)
      .filter((element) =>
        /(ayrıntıları|detayları)\s+(göster|gizle)|show\s+details/i.test(
          cleanText(element.textContent)
        ));
    for (const control of detailControls) {
      const container = findOrderContainer(control);
      if (container) {
        candidates.add(container);
      }
    }

    const scored = Array.from(candidates)
      .filter((element) => isVisible(element) && intersectsViewport(element))
      .map((element) => {
        const text = sanitizeOrderText(element);
        return {
          element,
          text,
          score: scoreOrderCard(
            element,
            text,
            looksLikeOrderPage,
            isBershkaOrderDetail)
        };
      })
      .filter((candidate) =>
        candidate.text.length >= 16 &&
        candidate.text.length <= 4_000 &&
        candidate.score >= (looksLikeOrderPage ? 5 : 8))
      .sort((left, right) =>
        right.score - left.score ||
        elementArea(left.element) - elementArea(right.element));

    const selected = [];
    for (const candidate of scored) {
      if (selected.length >= 25) {
        break;
      }
      if (selected.some((existing) =>
        existing.element === candidate.element ||
        deepContains(existing.element, candidate.element) ||
        deepContains(candidate.element, existing.element))) {
        continue;
      }
      selected.push(candidate);
    }

    const orderCards = selected.map(({ element, text }) => {
      const scopedRoots = collectOpenRoots(element);
      const structured = extractBershkaOrderFields(element);
      const links = deepQuerySelectorAll("a[href]", scopedRoots)
        .map((link) => cleanProductUrl(link.href))
        .filter(Boolean)
        .filter((href, index, values) => values.indexOf(href) === index)
        .slice(0, 8);
      const images = extractOrderCardImages(scopedRoots);
      const primaryImage = images[0] || {
        url: "",
        alt: "",
        productUrl: ""
      };
      return {
        text,
        brand: structured.brand,
        productName: structured.productName,
        purchasedSize: structured.purchasedSize,
        productLinks: links,
        imageAlt: primaryImage.alt,
        imageUrl: primaryImage.url,
        images
      };
    });
    const selectedElements = selected.map((candidate) => candidate.element);
    const cropRect = unionVisibleRects(selectedElements);
    const redactionRects = findSensitiveRects(selectedElements);
    const retailer =
      cleanText(getMeta("property", "og:site_name")) ||
      location.hostname.replace(/^www\./, "").split(".")[0];

    return {
      pageUrl: safePageUrl().slice(0, 1_000),
      pageTitle: cleanText(document.title).slice(0, 240),
      retailer: retailer.slice(0, 120),
      sanitizedText: selected.map((candidate, index) =>
        `KART ${index + 1}: ${candidate.text}`).join("\n\n").slice(0, 30_000),
      orderCards,
      cropRect,
      redactionRects,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      }
    };
  }

  function isBershkaOrderDetailPage() {
    const retailer =
      cleanText(getMeta("property", "og:site_name")) ||
      cleanText(document.title);
    const brandSignal =
      /(^|\.)bershka\.com$/i.test(location.hostname) ||
      /\bbershka\b/i.test(retailer);
    const headingSignal = deepQuerySelectorAll(
      "h1, h2",
      collectOpenRoots()
    )
      .slice(0, 12)
      .some((heading) =>
        /sipariş\s*no|order\s*(?:no|number)/i.test(
          cleanText(heading.textContent)));
    return brandSignal && (
      /\/online-order-detail(?:\.html)?$/i.test(location.pathname) ||
      headingSignal
    );
  }

  function collectBershkaOrderDetailCandidates(roots) {
    const candidates = new Set();
    deepQuerySelectorAll(
      '[class*="order-detail" i] [class*="product" i], [data-qa*="order" i] [data-qa*="product" i], [data-testid*="order" i] [data-testid*="product" i]',
      roots
    )
      .filter((element) =>
        isVisible(element) &&
        intersectsViewport(element))
      .forEach((element) => {
        if (hasBershkaProductEvidence(element)) {
          candidates.add(element);
        }
      });

    deepQuerySelectorAll("img", roots)
      .filter((image) => {
        if (!isVisible(image) || !intersectsViewport(image)) {
          return false;
        }
        const rect = image.getBoundingClientRect();
        const naturalArea =
          Number(image.naturalWidth || 0) *
          Number(image.naturalHeight || 0);
        return (
          rect.width >= 80 &&
          rect.height >= 100 &&
          rect.width * rect.height >= 12_000
        ) || naturalArea >= 30_000;
      })
      .forEach((image) => {
        const container =
          findBershkaOrderProductContainer(image);
        if (container) {
          candidates.add(container);
        }
      });

    return [...candidates];
  }

  function findBershkaOrderProductContainer(image) {
    let current = image;
    for (let depth = 0; current && depth < 16; depth += 1) {
      const text = sanitizeOrderText(current);
      if (
        text.length >= 8 &&
        text.length <= 1_600 &&
        hasBershkaProductEvidence(current)
      ) {
        return current;
      }
      current = composedParent(current);
    }
    return null;
  }

  function hasBershkaProductEvidence(element) {
    const fields = extractBershkaOrderFields(element);
    if (!fields.productName || !fields.purchasedSize) {
      return false;
    }
    const text = cleanText(deepElementText(element));
    const hasPrice =
      /(?:₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})/i
        .test(text);
    const hasImage = deepQuerySelectorAll(
      "img",
      collectOpenRoots(element)
    ).some((image) => isVisible(image));
    return hasPrice && hasImage;
  }

  function extractBershkaOrderFields(element) {
    if (!isBershkaOrderDetailPage() || !element) {
      return {
        brand: "",
        productName: "",
        purchasedSize: ""
      };
    }

    const candidates = [
      element,
      ...deepQuerySelectorAll(
        'h1, h2, h3, h4, h5, h6, a, p, span, div, dt, dd, [class*="name" i], [class*="title" i], [class*="size" i], [data-qa*="name" i], [data-qa*="size" i], [data-testid*="name" i], [data-testid*="size" i]',
        collectOpenRoots(element))
    ];
    const directLines = candidates
      .map((candidate) => ({
        element: candidate,
        text: directElementText(candidate)
      }))
      .filter((candidate) => candidate.text);

    const purchasedSize = directLines
      .map((candidate) => candidate.text)
      .find(isPlausiblePurchasedSize) || "";

    const productName = directLines
      .filter((candidate) =>
        isPlausibleBershkaProductName(candidate.text))
      .map((candidate) => ({
        ...candidate,
        score: scoreBershkaProductName(
          candidate.element,
          candidate.text)
      }))
      .sort((left, right) =>
        right.score - left.score ||
        right.text.length - left.text.length)[0]?.text || "";

    return {
      brand: "Bershka",
      productName: productName.slice(0, 240),
      purchasedSize: purchasedSize.toUpperCase().slice(0, 30)
    };
  }

  function directElementText(element) {
    return cleanText(
      Array.from(element?.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
    );
  }

  function isPlausiblePurchasedSize(value) {
    const normalized = cleanText(value).toUpperCase();
    if (/^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL)$/.test(normalized)) {
      return true;
    }
    if (!/^\d{1,2}$/.test(normalized)) {
      return false;
    }
    const numeric = Number(normalized);
    return numeric >= 24 && numeric <= 60;
  }

  function isPlausibleBershkaProductName(value) {
    const text = cleanText(value);
    if (
      text.length < 4 ||
      text.length > 160 ||
      isPlausiblePurchasedSize(text) ||
      /(?:₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})/i.test(text) ||
      /(sipariş|alışveriş tarihi|son iade|ürün$|e-?fatura|merhaba|profilim|iadeler|oturumu kapat)/i.test(text)
    ) {
      return false;
    }
    return /[a-zçğıöşü]/i.test(text) &&
      /(jean|denim|pantolon|trouser|pants|tişört|t-?shirt|shirt|gömlek|sweat|hoodie|kazak|hırka|ceket|jacket|mont|kaban|coat|parka|şort|short|etek|skirt|elbise|dress|tulum|jumpsuit|top|polo|bluz|blouse|yelek|vest)/i.test(text);
  }

  function scoreBershkaProductName(element, text) {
    const signature = [
      element.className,
      element.getAttribute?.("data-qa"),
      element.getAttribute?.("data-testid")
    ].filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
    let score = 20;
    if (/(name|title|description|product)/i.test(signature)) {
      score += 14;
    }
    if (text === text.toLocaleUpperCase("tr")) {
      score += 4;
    }
    if (/\b(?:fit|baggy|straight|wide|relaxed|regular|slim|skinny|boxy|oversize)\b/i.test(text)) {
      score += 5;
    }
    return score;
  }

  async function expandOrderDetails() {
    const controls = deepQuerySelectorAll("button, [role='button']")
      .filter((element) => isVisible(element) && intersectsViewport(element))
      .filter((element) =>
        /^(?:ayrıntıları|detayları)\s+göster$|^show\s+details$/i.test(
          cleanText(element.textContent)
        ))
      .slice(0, 16);

    for (const control of controls) {
      control.click();
      await waitForCondition(
        () =>
          /(gizle|hide)/i.test(cleanText(control.textContent)) ||
          control.getAttribute("aria-expanded") === "true",
        650
      );
      observeOpenRoots();
    }

    if (controls.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function hydrateVisibleOrderImages() {
    const images = deepQuerySelectorAll(
      "img",
      collectOpenRoots()
    )
      .filter((image) =>
        isVisible(image) &&
        intersectsViewport(image))
      .slice(0, 120);

    for (const image of images) {
      image.loading = "eager";
      const lazySource =
        image.getAttribute("data-src") ||
        image.getAttribute("data-original") ||
        image.getAttribute("data-lazy-src");
      const lazySrcset = image.getAttribute("data-srcset");
      if (lazySource && cleanImageUrl(lazySource)) {
        image.src = lazySource;
      }
      if (lazySrcset) {
        image.srcset = lazySrcset;
      }
    }

    await Promise.race([
      Promise.allSettled(images.map((image) =>
        typeof image.decode === "function"
          ? image.decode()
          : Promise.resolve())),
      new Promise((resolve) => setTimeout(resolve, 900))
    ]);
  }

  function findOrderContainer(control) {
    let current = control;
    for (let depth = 0; current && depth < 16; depth += 1) {
      const text = cleanText(deepElementText(current));
      const hasOrderSignal =
        /(?:^|\s)no\.\s*\d|sipariş|order|teslim|delivered|iade|returned/i.test(text);
      const hasCommercialSignal =
        /(₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})/i.test(text) ||
        deepQuerySelectorAll("img", collectOpenRoots(current)).length > 0;
      if (text.length >= 20 &&
          text.length <= 5_000 &&
          hasOrderSignal &&
          hasCommercialSignal) {
        return current;
      }
      current = composedParent(current);
    }
    return null;
  }

  function scoreOrderCard(
    element,
    text,
    looksLikeOrderPage,
    isBershkaOrderDetail = false) {
    const lower = text.toLocaleLowerCase("tr");
    const signature = [
      element.id,
      element.className,
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label")
    ].filter((value) => typeof value === "string").join(" ").toLowerCase();
    let score = 0;
    if (/(order|purchase|shipment|sipari[sş]|satın)/i.test(signature)) {
      score += 4;
    }
    if (/\b(size|beden)\b/i.test(lower)) {
      score += 4;
    }
    if (/(delivered|returned|cancelled|shipped|teslim|iade|iptal|kargoda|hazırlanıyor)/i.test(lower)) {
      score += 3;
    }
    if (/(₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})/i.test(lower)) {
      score += 1;
    }
    if (/(t-?shirt|shirt|jean|dress|jacket|hoodie|coat|trouser|pant|tişört|gömlek|pantolon|elbise|ceket|mont|kazak|hırka)/i.test(lower)) {
      score += 2;
    }
    const scopedRoots = collectOpenRoots(element);
    if (deepQuerySelectorAll("img", scopedRoots).length > 0) {
      score += 1;
    }
    if (deepQuerySelectorAll("a[href]", scopedRoots).length > 0) {
      score += 1;
    }
    if (looksLikeOrderPage) {
      score += 1;
    }
    if (isBershkaOrderDetail) {
      const fields = extractBershkaOrderFields(element);
      if (fields.productName) {
        score += 5;
      }
      if (fields.purchasedSize) {
        score += 5;
      }
    }
    if (text.length > 2_500) {
      score -= 3;
    }
    return score;
  }

  function sanitizeOrderText(element) {
    const rawLines = String(deepElementText(element))
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter(Boolean);
    const safeLines = rawLines
      .filter((line) => !isSensitiveLine(line))
      .map(sanitizeInlineText)
      .filter(Boolean);
    return safeLines
      .filter((line, index, lines) => lines.indexOf(line) === index)
      .join(" · ")
      .slice(0, 4_000);
  }

  function isSensitiveLine(line) {
    if (/^\s*no\.\s*\d/i.test(line)) {
      return true;
    }
    return /(e-?posta|e-?mail|telefon|phone|adres|address|teslimat adres|billing|fatura adres|ödeme|payment|kart bilg|card ending|alıcı|recipient|ad soyad|teslim alan|sipariş no|order no|order number|takip no|tracking no|müşteri no|customer id)/i.test(line);
  }

  function sanitizeInlineText(value) {
    return cleanText(value)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-posta gizlendi]")
      .replace(/\b(?:\d[ -]?){11,19}\b/g, "[numara gizlendi]")
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (match) =>
        (match.match(/\d/g) || []).length >= 9 ? "[telefon gizlendi]" : match);
  }

  function extractOrderCardImages(scopedRoots) {
    const byUrl = new Map();
    const addCandidate = (
      rawUrl,
      element,
      rawAlt,
      sourceScore = 0) => {
      const url = cleanImageUrl(rawUrl);
      if (!url ||
          /^(?:none|initial|inherit|unset)$/i.test(
            String(rawUrl).trim()) ||
          /(logo|sprite|avatar|payment|badge|flag|favicon|spacer|pixel|transparent|placeholder|no-image|image-not-found)/i
            .test(new URL(url).pathname)) {
        return;
      }

      const alt = sanitizeInlineText(rawAlt || "").slice(0, 500);
      const rect = element?.getBoundingClientRect?.();
      const area = rect
        ? Math.max(0, rect.width) * Math.max(0, rect.height)
        : 0;
      const naturalArea =
        Number(element?.naturalWidth || 0) *
        Number(element?.naturalHeight || 0);
      if (naturalArea > 0 && naturalArea <= 64) {
        return;
      }

      const productUrl = findLinkedProductUrl(element);
      let score =
        sourceScore +
        Math.min(35, Math.sqrt(area) / 4) +
        Math.min(18, Math.sqrt(naturalArea) / 40);
      if (productUrl) {
        score += 22;
      }
      if (alt.length >= 6) {
        score += 9;
      }
      if (/\b(product|ürün|tişört|gömlek|pantolon|ceket|elbise|shirt|jean|dress|jacket)\b/i.test(alt)) {
        score += 8;
      }
      if (element && isVisible(element)) {
        score += 8;
      }

      const existing = byUrl.get(url);
      if (!existing || score > existing.score) {
        byUrl.set(url, {
          url: url.slice(0, 2_000),
          alt,
          productUrl: productUrl.slice(0, 1_000),
          score
        });
      }
    };

    const media = deepQuerySelectorAll(
      "img, picture source",
      scopedRoots
    );
    for (const element of media) {
      const alt =
        element.getAttribute("alt") ||
        composedParent(element)?.getAttribute?.("aria-label") ||
        "";
      const directValues = [
        element.currentSrc,
        element.src,
        element.getAttribute("src"),
        element.getAttribute("data-src"),
        element.getAttribute("data-original"),
        element.getAttribute("data-lazy-src"),
        element.getAttribute("data-image"),
        element.getAttribute("data-zoom-image")
      ];
      directValues.forEach((value, index) =>
        addCandidate(
          value,
          element,
          alt,
          index < 2 ? 20 : 14));

      const srcsets = [
        element.getAttribute("srcset"),
        element.getAttribute("data-srcset")
      ].filter(Boolean);
      for (const srcset of srcsets) {
        srcset
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/)[0])
          .filter(Boolean)
          .forEach((value, index, values) =>
            addCandidate(
              value,
              element,
              alt,
              18 + index / Math.max(values.length, 1) * 4));
      }
    }

    const backgroundElements = deepQuerySelectorAll(
      "[style], [data-bg], [data-background], [data-background-image]",
      scopedRoots
    ).slice(0, 300);
    for (const element of backgroundElements) {
      const values = [
        element.getAttribute("data-bg"),
        element.getAttribute("data-background"),
        element.getAttribute("data-background-image"),
        getComputedStyle(element).backgroundImage
      ].filter(Boolean);
      const alt =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        "";
      for (const value of values) {
        const matches = String(value).matchAll(
          /url\(\s*(['"]?)(.*?)\1\s*\)/gi);
        let matched = false;
        for (const match of matches) {
          matched = true;
          addCandidate(match[2], element, alt, 12);
        }
        if (!matched) {
          addCandidate(value, element, alt, 10);
        }
      }
    }

    return [...byUrl.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
      .map(({ url, alt, productUrl }) => ({
        url,
        alt,
        productUrl
      }));
  }

  function findLinkedProductUrl(element) {
    let current = element;
    for (let depth = 0; current && depth < 12; depth += 1) {
      if (current instanceof HTMLAnchorElement) {
        const url = cleanProductUrl(current.href);
        if (url) {
          return url;
        }
      }
      current = composedParent(current);
    }
    return "";
  }

  function cleanImageUrl(value) {
    if (typeof value !== "string" ||
        !value.trim() ||
        /^(?:data|blob):/i.test(value.trim())) {
      return "";
    }
    try {
      const url = new URL(value.trim(), location.href);
      if (!["http:", "https:"].includes(url.protocol)) {
        return "";
      }
      for (const key of Array.from(url.searchParams.keys())) {
        if (/(auth|session|email|user|customer)/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function cleanProductUrl(value) {
    if (typeof value !== "string" || !/^https?:/i.test(value)) {
      return "";
    }
    try {
      const url = new URL(value);
      if (/(\/|^)(account|orders?|order-history|sipari[sş]|hesabım|tracking|returns?|iade)(\/|$)/i.test(url.pathname)) {
        return "";
      }
      url.hash = "";
      for (const key of Array.from(url.searchParams.keys())) {
        if (/(token|signature|auth|session|email|user|customer|order|tracking)/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      return url.href;
    } catch {
      return "";
    }
  }

  function safePageUrl() {
    try {
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      url.pathname = url.pathname
        .split("/")
        .map((segment) =>
          segment.length >= 8 && /\d/.test(segment) ? "gizlendi" : segment)
        .join("/");
      return url.href;
    } catch {
      return `${location.origin}/`;
    }
  }

  function findSensitiveRects(elements) {
    const rects = [];
    const seen = new Set();
    for (const root of elements) {
      const descendants = [root, ...deepQuerySelectorAll("*", collectOpenRoots(root))];
      for (const element of descendants) {
        const directText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(" ");
        const hasSensitiveNumber =
          (directText.match(/\d/g) || []).length >= 9 &&
          /(?:\+?\d[\d\s().-]{7,}\d)/.test(directText);
        const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(directText);
        if (!isSensitiveLine(directText) && !hasSensitiveNumber && !hasEmail) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.top >= window.innerHeight) {
          continue;
        }
        const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        rects.push({
          left: Math.max(0, Math.round(rect.left - 3)),
          top: Math.max(0, Math.round(rect.top - 2)),
          width: Math.min(window.innerWidth, Math.round(rect.width + 6)),
          height: Math.min(window.innerHeight, Math.round(rect.height + 4))
        });
      }
    }
    return rects.slice(0, 80);
  }

  function unionVisibleRects(elements) {
    const visibleRects = elements
      .map((element) => element.getBoundingClientRect())
      .map((rect) => ({
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right),
        bottom: Math.min(window.innerHeight, rect.bottom)
      }))
      .filter((rect) => rect.right - rect.left >= 20 && rect.bottom - rect.top >= 20);
    if (visibleRects.length === 0) {
      return null;
    }

    const padding = 12;
    const left = Math.max(0, Math.min(...visibleRects.map((rect) => rect.left)) - padding);
    const top = Math.max(0, Math.min(...visibleRects.map((rect) => rect.top)) - padding);
    const right = Math.min(window.innerWidth, Math.max(...visibleRects.map((rect) => rect.right)) + padding);
    const bottom = Math.min(window.innerHeight, Math.max(...visibleRects.map((rect) => rect.bottom)) + padding);
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    };
  }

  function elementArea(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function intersectsViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  }

  function cleanText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function recommendationStrength(recommendation) {
    const source = recommendation?.dataSource || "";
    const confidence = Number(recommendation?.confidence) || 0;
    const size = cleanText(recommendation?.recommendedSize)
      .toLocaleLowerCase("tr-TR");
    if (size === "bilinmiyor" || source.includes("insufficient")) {
      return { label: "Ölçü gerekli", width: 30 };
    }
    if (source.includes("category-history") ||
        source.includes("family-match")) {
      return { label: "Dolapta doğrulandı", width: 92 };
    }
    if (source.includes("model-reference")) {
      return { label: "Model referanslı", width: 76 };
    }
    if (source.includes("body-label") ||
        source.includes("footwear-size")) {
      return { label: "Profil eşleşmesi", width: 68 };
    }
    if (confidence >= 78) {
      return { label: "Çok güçlü", width: 94 };
    }
    if (confidence >= 60) {
      return { label: "Güçlü", width: 82 };
    }
    return { label: "Dengeli", width: 66 };
  }

  function showRecommendation(recommendation) {
    if (!recommendation?.recommendedSize) {
      return;
    }

    document.getElementById("fitmemory-page-card-host")?.remove();

    const host = document.createElement("div");
    host.id = "fitmemory-page-card-host";
    host.style.position = "fixed";
    host.style.right = "20px";
    host.style.bottom = "20px";
    host.style.zIndex = "2147483647";
    host.style.all = "initial";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .card {
        width: 330px;
        overflow: hidden;
        border: 1px solid #deddd8;
        border-radius: 3px;
        background: #fff;
        color: #111;
        box-shadow: 0 20px 55px rgba(20,20,20,.16);
        font-family:"Segoe UI Variable Text","Segoe UI",Helvetica,Arial,sans-serif;
        animation: fitmemory-rise .32s cubic-bezier(.2,.8,.2,1);
      }
      @keyframes fitmemory-rise {
        from { opacity: 0; transform: translateY(14px) scale(.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .top { display:flex; align-items:center; justify-content:space-between; padding:13px 15px; border-bottom:1px solid #e6e5e1; }
      .brand { display:flex; align-items:center; gap:9px; font-size:10px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
      .mark { display:grid; place-items:center; width:27px; height:27px; border-radius:2px; color:#fff; background:#111; font-size:9px; }
      .close { width:28px; height:28px; border:0; border-radius:50%; color:#5f5f5b; background:#f4f3ef; cursor:pointer; font-size:17px; line-height:1; }
      .body { display:flex; gap:16px; padding:18px; }
      .size { display:grid; flex:0 0 auto; place-items:center; width:82px; height:82px; border-radius:2px; color:#fff; background:#111; font-size:30px; font-weight:900; letter-spacing:-.06em; text-transform:uppercase; }
      .copy { min-width:0; padding-top:2px; }
      .eyebrow { color:#74746f; font-size:9px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; }
      .verdict { margin:6px 0 0; font-size:15px; font-weight:650; line-height:1.25; letter-spacing:-.015em; }
      .detail { margin:7px 0 0; color:#50504b; font-size:11px; line-height:1.5; }
      .wardrobe { margin:0 18px 14px; overflow:hidden; border:1px solid #b8c5ea; border-radius:5px; background:#f5f7ff; }
      .wardrobe summary { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; color:#111; cursor:pointer; list-style:none; font-size:11px; font-weight:650; }
      .wardrobe summary::-webkit-details-marker { display:none; }
      .wardrobe-count { display:grid; min-width:25px; height:25px; padding:0 7px; place-items:center; border-radius:999px; color:#fff; background:#1746d1; font-size:10px; }
      .wardrobe-content { border-top:1px solid #cbd4ef; padding:10px 12px 11px; background:#fff; }
      .age-context { margin:0 0 9px; color:#50504b; font-size:9px; line-height:1.45; }
      .outfit { padding:8px 0; border-top:1px solid #e2e2dd; }
      .outfit:first-of-type { border-top:0; padding-top:0; }
      .outfit-title { margin:0; color:#111; font-size:10px; font-weight:700; }
      .outfit-pieces { margin:4px 0 0; color:#50504b; font-size:9px; line-height:1.45; }
      .confidence { display:flex; align-items:center; gap:8px; padding:0 18px 17px; color:#31312f; font-size:10px; font-weight:700; }
      .track { flex:1; height:3px; overflow:hidden; background:#e4e3de; }
      .fill { height:100%; background:#315cf4; }
      @media (max-width: 520px) { .card { width: calc(100vw - 28px); } }
      @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    `;

    const card = document.createElement("section");
    card.className = "card";
    card.setAttribute("aria-label", "FitMemory beden önerisi");

    const top = document.createElement("div");
    top.className = "top";
    const brand = document.createElement("div");
    brand.className = "brand";
    brand.innerHTML = '<span class="mark">FM</span><span>FitMemory kararı</span>';
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.setAttribute("aria-label", "Beden önerisini kapat");
    close.textContent = "×";
    close.addEventListener("click", () => host.remove());
    top.append(brand, close);

    const body = document.createElement("div");
    body.className = "body";
    const size = document.createElement("div");
    size.className = "size";
    size.textContent = recommendation.recommendedSize;
    const copy = document.createElement("div");
    copy.className = "copy";
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    const strength = recommendationStrength(recommendation);
    eyebrow.textContent = `Öneri dayanağı · ${strength.label}`;
    eyebrow.title =
      `Teknik kanıt güveni: %${recommendation.confidence}`;
    const verdict = document.createElement("p");
    verdict.className = "verdict";
    verdict.textContent = recommendation.verdict;
    const detail = document.createElement("p");
    detail.className = "detail";
    detail.textContent = recommendation.explanation;
    copy.append(eyebrow, verdict, detail);
    body.append(size, copy);

    const confidence = document.createElement("div");
    confidence.className = "confidence";
    const label = document.createElement("span");
    label.textContent = strength.label;
    label.title =
      `Kanıt güveni %${recommendation.confidence}; bu değer ürünün olma olasılığı değildir.`;
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = `${strength.width}%`;
    track.append(fill);
    confidence.append(label, track);

    card.append(top, body);
    const wardrobeStyle = recommendation.style;
    if (wardrobeStyle) {
      const wardrobe = document.createElement("details");
      wardrobe.className = "wardrobe";
      const wardrobeSummary = document.createElement("summary");
      const wardrobeLabel = document.createElement("span");
      wardrobeLabel.textContent =
        wardrobeStyle.headline || "Dolabından kombinle";
      const wardrobeCount = document.createElement("span");
      wardrobeCount.className = "wardrobe-count";
      wardrobeCount.textContent = String(
        Math.max(0, Number(wardrobeStyle.compatibleItemCount) || 0));
      wardrobeSummary.append(wardrobeLabel, wardrobeCount);

      const wardrobeContent = document.createElement("div");
      wardrobeContent.className = "wardrobe-content";
      const ageContext = document.createElement("p");
      ageContext.className = "age-context";
      ageContext.textContent =
        wardrobeStyle.ageContext || wardrobeStyle.summary || "";
      wardrobeContent.append(ageContext);

      const outfits = Array.isArray(wardrobeStyle.outfits)
        ? wardrobeStyle.outfits
        : [];
      if (outfits.length === 0) {
        const empty = document.createElement("p");
        empty.className = "outfit-pieces";
        empty.textContent =
          "Bu ürün için tamamlayıcı dolap parçası henüz bulunamadı.";
        wardrobeContent.append(empty);
      } else {
        outfits.slice(0, 3).forEach((outfit) => {
          const outfitElement = document.createElement("div");
          outfitElement.className = "outfit";
          const outfitTitle = document.createElement("p");
          outfitTitle.className = "outfit-title";
          outfitTitle.textContent = outfit.title || "Kombin";
          const outfitPieces = document.createElement("p");
          outfitPieces.className = "outfit-pieces";
          outfitPieces.textContent = (outfit.pieces || [])
            .map((piece) =>
              `${piece.brand} ${piece.productName} (${piece.purchasedSize})`)
            .join(" · ");
          outfitElement.append(outfitTitle, outfitPieces);
          wardrobeContent.append(outfitElement);
        });
      }

      wardrobe.append(wardrobeSummary, wardrobeContent);
      card.append(wardrobe);
    }
    card.append(confidence);
    shadow.append(style, card);
    document.documentElement.append(host);
  }
})();
