const scannerBootstrap = String.raw`
(function () {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    if (!element || !(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      rect.width > 2 &&
      rect.height > 2;
  };
  const roots = () => {
    const result = [document];
    const queue = [document];
    while (queue.length && result.length < 100) {
      const root = queue.shift();
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot && !result.includes(element.shadowRoot)) {
          result.push(element.shadowRoot);
          queue.push(element.shadowRoot);
        }
      }
    }
    return result;
  };
  const all = (selector) => {
    const result = [];
    for (const root of roots()) {
      for (const element of root.querySelectorAll(selector)) {
        if (!result.includes(element)) result.push(element);
      }
    }
    return result;
  };
  const meta = (key, property = true) =>
    document.querySelector(
      "meta[" + (property ? "property" : "name") + "='" + key + "']"
    )?.getAttribute("content") || "";
  const absoluteUrl = (value) => {
    try {
      const result = new URL(value, location.href);
      return /^https?:$/.test(result.protocol) ? result.href : "";
    } catch {
      return "";
    }
  };
  const findTyped = (value, type) => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const match = findTyped(item, type);
        if (match) return match;
      }
      return null;
    }
    const ownType = value["@type"];
    if (ownType === type ||
        (Array.isArray(ownType) && ownType.includes(type))) {
      return value;
    }
    for (const nested of Object.values(value)) {
      const match = findTyped(nested, type);
      if (match) return match;
    }
    return null;
  };
  const productJson = () => {
    for (const script of document.querySelectorAll(
      "script[type='application/ld+json']"
    )) {
      try {
        const match = findTyped(JSON.parse(script.textContent || ""), "Product");
        if (match) return match;
      } catch {}
    }
    return null;
  };
  const firstImageValue = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = firstImageValue(item);
        if (result) return result;
      }
    }
    if (value && typeof value === "object") {
      return value.url || value.contentUrl || value.thumbnailUrl || "";
    }
    return "";
  };
  const chooseProductImage = (structured, title) => {
    const fixed = [
      firstImageValue(structured?.image),
      meta("og:image"),
      meta("twitter:image", false)
    ].map(absoluteUrl).find(Boolean);
    if (fixed) return fixed;
    const titleTokens = clean(title).toLocaleLowerCase("tr-TR")
      .split(" ").filter((part) => part.length > 3);
    return all("main img, [class*='product' i] img, img")
      .filter(visible)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        const context = clean([
          image.alt,
          image.className,
          image.parentElement?.className
        ].join(" "));
        let score = Math.min(50, Math.sqrt(rect.width * rect.height) / 7);
        if (image.closest("main")) score += 18;
        if (/(gallery|product|pdp|carousel)/i.test(context)) score += 20;
        if (/(logo|icon|avatar|payment|size.?guide)/i.test(context)) score -= 80;
        if (titleTokens.some((token) =>
          clean(image.alt).toLocaleLowerCase("tr-TR").includes(token))) {
          score += 12;
        }
        return {
          url: absoluteUrl(
            image.currentSrc ||
            image.src ||
            image.getAttribute("data-src") ||
            ""
          ),
          score
        };
      })
      .filter((candidate) => candidate.url)
      .sort((left, right) => right.score - left.score)[0]?.url || "";
  };
  const fitDetails = () => {
    const text = clean([
      ...all(
        "[class*='fit' i], [data-testid*='fit' i], " +
        "[class*='description' i], [class*='product-detail' i], main"
      ).filter(visible).map((element) => element.innerText || element.textContent),
      document.body?.innerText || ""
    ].join(" ")).slice(0, 100000);
    const patterns = [
      ["Super Baggy Fit", /\bsuper\s+baggy\s*(?:fit)?\b/i],
      ["Baggy Fit", /\bbaggy\s*(?:fit|kalıp)?\b/i],
      ["Boxy Fit", /\bboxy\s*(?:fit|kalıp)?\b/i],
      ["Oversize Fit", /\b(?:oversized?|over size)\s*(?:fit|kalıp)?\b/i],
      ["Relaxed Fit", /\b(?:relaxed|comfort)\s*(?:fit|kalıp)?\b/i],
      ["Straight Fit", /\bstraight\s*(?:fit|kalıp)?\b/i],
      ["Regular Fit", /\b(?:regular|standard|standart)\s*(?:fit|kalıp)\b/i],
      ["Slim Fit", /\b(?:slim|skinny|muscle|fitted)\s*(?:fit|kalıp)?\b/i],
      ["Wide Leg", /\bwide\s*(?:leg|fit)?\b/i],
      ["Loose Fit", /\b(?:loose|bol)\s*(?:fit|kalıp)?\b/i]
    ];
    for (const [label, pattern] of patterns) {
      const match = pattern.exec(text);
      if (match) {
        const start = Math.max(0, match.index - 70);
        return {
          label,
          evidence: clean(text.slice(start, match.index + 180)).slice(0, 300)
        };
      }
    }
    return { label: "", evidence: "" };
  };
  const modelDetails = () => {
    const text = clean(document.body?.innerText || "").slice(0, 120000);
    const index = text.search(/\bmodel(?:in)?\b/i);
    if (index < 0) return { heightCm: null, size: "", evidence: "" };
    const segment = text.slice(Math.max(0, index - 80), index + 500);
    const height = segment.match(/\b(1[5-9]\d|2[0-1]\d)\s*cm\b/i);
    const size = segment.match(
      /(?:beden(?:i)?|size|giyiyor|wears?|wearing)\s*[:.-]?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})\b/i
    );
    return {
      heightCm: height ? Number(height[1]) : null,
      size: clean(size?.[1]).toUpperCase(),
      evidence: height || size ? clean(segment).slice(0, 300) : ""
    };
  };
  const openSizeGuide = async () => {
    const trigger = all("button, a, [role='button'], summary")
      .filter(visible)
      .find((element) =>
        /(ölçüleri görüntüle|ölçüler|beden rehberi|beden tablosu|size guide|measurements?)/i
          .test(clean(element.innerText || element.textContent)) &&
        !/(sepete|satın al|checkout|ödeme)/i
          .test(clean(element.innerText || element.textContent))
      );
    if (trigger) {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 850));
    }
  };
  const tableChart = () => {
    const candidates = all("table, [role='table']")
      .filter(visible)
      .map((table) => {
        const text = clean(table.innerText || table.textContent);
        const signal = /(beden|size|göğüs|chest|omuz|shoulder|bel|waist|uzunluk|length|inseam|cm|inch)/i
          .test(text);
        return { table, text, score: (signal ? 20 : 0) + (text.match(/\d/g) || []).length };
      })
      .filter((candidate) => candidate.score >= 24)
      .sort((left, right) => right.score - left.score);
    if (!candidates[0]) return null;
    const table = candidates[0].table;
    const rows = [...table.querySelectorAll("tr, [role='row']")]
      .map((row) => [...row.querySelectorAll(
        "th, td, [role='columnheader'], [role='rowheader'], [role='cell']"
      )].map((cell) => clean(cell.innerText || cell.textContent)).filter(Boolean))
      .filter((cells) => cells.length >= 2)
      .slice(0, 30);
    if (!rows.length) return null;
    const first = rows[0];
    const firstLooksHeader = first.some((cell) =>
      /(beden|size|ölçü|measurement|cm|inch|göğüs|chest|bel|waist)/i.test(cell)
    );
    const headers = (firstLooksHeader
      ? first
      : first.map((_, index) => index === 0 ? "Beden" : "Ölçü " + index)
    ).slice(0, 12);
    const body = (firstLooksHeader ? rows.slice(1) : rows)
      .map((cells) => ({ cells: cells.slice(0, 12) }));
    return {
      found: true,
      title: clean(table.querySelector("caption")?.textContent) || "Beden tablosu",
      unit: /\bcm\b/i.test(candidates[0].text) ? "Centimeters" :
        /\b(inch|inç)\b/i.test(candidates[0].text) ? "Inches" : "Unknown",
      headers,
      rows: body,
      rawText: candidates[0].text.slice(0, 8000)
    };
  };
  const panelChart = async () => {
    const panels = all(
      "[role='dialog'], aside, [class*='measure' i], " +
      "[class*='size-guide' i], [class*='sizeguide' i], " +
      "[class*='size-chart' i], [class*='drawer' i]"
    ).filter(visible).map((panel) => {
      const text = clean(panel.innerText || panel.textContent);
      const score =
        (/(göğüs|chest|omuz|shoulder|bel|waist|uzunluk|length|inseam)/i.test(text) ? 20 : 0) +
        (/(XXS|XS|\bS\b|\bM\b|\bL\b|XL|\b3[02468]\b|\b4[02468]\b)/.test(text) ? 10 : 0) +
        (text.match(/\d+(?:[.,]\d+)?/g) || []).length;
      return { panel, text, score };
    }).filter((candidate) => candidate.score >= 32)
      .sort((left, right) => right.score - left.score);
    if (!panels[0]) return null;
    const panel = panels[0].panel;
    const sizePattern = /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3})$/i;
    const buttons = all("button, [role='button']")
      .filter((button) => panel.contains(button) && visible(button))
      .filter((button) => sizePattern.test(clean(button.innerText || button.textContent)))
      .slice(0, 15);
    const labels = [
      ["Göğüs", /(?:göğüs|chest)\s*[:.-]?\s*(\d+(?:[.,]\d+)?)/i],
      ["Omuz", /(?:omuz|shoulder)\s*[:.-]?\s*(\d+(?:[.,]\d+)?)/i],
      ["Bel", /(?:bel|waist)\s*[:.-]?\s*(\d+(?:[.,]\d+)?)/i],
      ["Ön uzunluk", /(?:ön uzunluk|front length|uzunluk|length)\s*[:.-]?\s*(\d+(?:[.,]\d+)?)/i],
      ["Kol", /(?:kol uzunluğu|sleeve length|kol|sleeve)\s*[:.-]?\s*(\d+(?:[.,]\d+)?)/i],
      ["İç bacak", /(?:iç bacak|inseam)\s*[:.-]?\s*(\d+(?:[.,]\d+)?)/i]
    ];
    const selectedBefore = buttons.find((button) =>
      button.getAttribute("aria-pressed") === "true" ||
      button.getAttribute("aria-selected") === "true" ||
      button.classList.toString().match(/selected|active/i)
    );
    const rows = [];
    for (const button of buttons) {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const text = clean(panel.innerText || panel.textContent);
      const values = labels.map(([, pattern]) => {
        const match = pattern.exec(text);
        return match ? String(match[1]).replace(",", ".") : "";
      });
      if (values.some(Boolean)) {
        rows.push({
          cells: [
            clean(button.innerText || button.textContent).toUpperCase(),
            ...values
          ]
        });
      }
    }
    selectedBefore?.click();
    const finalText = clean(panel.innerText || panel.textContent);
    return {
      found: rows.length > 0 || /\d+(?:[.,]\d+)?/.test(finalText),
      title: "Ürün ölçüleri",
      unit: /\bcm\b/i.test(finalText) ? "Centimeters" :
        /\b(inch|inç)\b/i.test(finalText) ? "Inches" : "Unknown",
      headers: ["Beden", ...labels.map(([label]) => label)],
      rows: rows.slice(0, 30),
      rawText: finalText.slice(0, 8000)
    };
  };
  const scrapeProduct = async () => {
    await openSizeGuide();
    const structured = productJson();
    const title = clean(
      structured?.name ||
      meta("og:title") ||
      all("main h1, h1").filter(visible)[0]?.textContent ||
      document.title
    ).slice(0, 240);
    const brandValue = typeof structured?.brand === "string"
      ? structured.brand
      : structured?.brand?.name;
    const brand = clean(
      brandValue ||
      meta("og:site_name") ||
      location.hostname.replace(/^www\./, "").split(".")[0]
    ).slice(0, 120);
    const fit = fitDetails();
    const model = modelDetails();
    const offers = Array.isArray(structured?.offers)
      ? structured.offers[0]
      : structured?.offers;
    const pageText = clean(document.body?.innerText || "");
    const reference = clean(
      structured?.sku ||
      structured?.productID ||
      pageText.match(/(?:ref(?:erans)?|ürün kodu|product code)\s*[:.]?\s*([A-Z0-9./-]{5,})/i)?.[1]
    ).slice(0, 120);
    const chart = tableChart() || await panelChart();
    if (!chart?.found) {
      throw new Error(
        "Beden tablosu okunamadı. Ürün sayfasında beden rehberini açıp tekrar deneyin."
      );
    }
    return {
      product: {
        url: location.href.slice(0, 1000),
        brand,
        name: title,
        category: clean(
          structured?.category ||
          meta("product:category") ||
          all("[aria-label*='breadcrumb' i] li, nav ol li")
            .filter(visible).slice(-2)[0]?.textContent ||
          "Diğer"
        ).slice(0, 120),
        price: clean([
          offers?.price || meta("product:price:amount"),
          offers?.priceCurrency || meta("product:price:currency")
        ].filter(Boolean).join(" ")).slice(0, 80),
        imageUrl: chooseProductImage(structured, title).slice(0, 1000),
        productReference: reference,
        fitLabel: fit.label,
        fitEvidence: fit.evidence,
        description: clean(
          structured?.description ||
          all("[class*='description' i], main details")
            .filter(visible).map((element) => element.innerText)
            .find((text) => clean(text).length > 30) ||
          ""
        ).slice(0, 1200),
        modelHeightCm: model.heightCm,
        modelWornSize: model.size,
        modelEvidence: model.evidence
      },
      sizeChart: chart,
      capturedAt: new Date().toISOString()
    };
  };
  const sensitive = (text) =>
    /(e-?posta|e-?mail|telefon|phone|adres|address|fatura|billing|ödeme|payment|kart|card|alıcı|recipient|sipariş no|order no|tracking|takip no|müşteri no)/i
      .test(text);
  const redactSensitiveVisible = () => {
    for (const previous of document.querySelectorAll(
      "[data-fitmemory-redaction='true']"
    )) {
      previous.remove();
    }
    const targets = all(
      "input, textarea, p, span, dt, dd, address, " +
      "[class*='address' i], [class*='payment' i], " +
      "[class*='customer' i], [class*='order-number' i]"
    ).filter(visible).filter((element) => {
      const ownText = clean(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? element.value
          : [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent)
              .join(" ")
      );
      return ownText && (
        sensitive(ownText) ||
        /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(ownText) ||
        /\b(?:\+?90\s*)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/.test(ownText)
      );
    }).slice(0, 80);
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight ||
          rect.width < 3 || rect.height < 3) continue;
      const cover = document.createElement("div");
      cover.dataset.fitmemoryRedaction = "true";
      Object.assign(cover.style, {
        position: "fixed",
        zIndex: "2147483647",
        left: Math.max(0, rect.left) + "px",
        top: Math.max(0, rect.top) + "px",
        width: Math.min(innerWidth, rect.right) -
          Math.max(0, rect.left) + "px",
        height: Math.min(innerHeight, rect.bottom) -
          Math.max(0, rect.top) + "px",
        background: "#111",
        borderRadius: "2px",
        pointerEvents: "none"
      });
      document.documentElement.appendChild(cover);
    }
  };
  const safeText = (element) =>
    String(element.innerText || element.textContent || "")
      .split(/\n+/)
      .map(clean)
      .filter((line) => line && !sensitive(line))
      .filter((line, index, lines) => lines.indexOf(line) === index)
      .join(" · ")
      .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[gizlendi]")
      .replace(/\b(?:\+?90\s*)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g, "[gizlendi]")
      .slice(0, 4000);
  const closestProductContainer = (start) => {
    let current = start;
    for (let depth = 0; current && depth < 14; depth += 1) {
      const text = safeText(current);
      if (text.length >= 8 && text.length <= 1800 &&
          /(XXS|XS|\bS\b|\bM\b|\bL\b|XL|\b2[4-9]\b|\b3\d\b|\b4\d\b|\b5[0-9]\b|beden|size)/i.test(text) &&
          /(jean|pantolon|tişört|shirt|sweat|hoodie|ceket|mont|kaban|etek|elbise|kazak|hırka|ayakkabı|shoe|sneaker|fit)/i.test(text)) {
        return current;
      }
      current = current.parentElement;
    }
    return start.closest("article, li, [role='listitem']") || start.parentElement;
  };
  const scrapeOrders = () => {
    const controls = all("button, [role='button']")
      .filter(visible)
      .filter((button) =>
        /(ayrıntıları|detayları)\s+göster|show\s+details/i
          .test(clean(button.innerText || button.textContent))
      ).slice(0, 12);
    controls.forEach((control) => control.click());
    const candidates = [];
    for (const image of all("main img, img").filter(visible)) {
      const rect = image.getBoundingClientRect();
      if (rect.width < 55 || rect.height < 65) continue;
      const container = closestProductContainer(image);
      if (container && !candidates.includes(container)) candidates.push(container);
    }
    for (const selector of [
      "[class*='order-item' i]",
      "[class*='order-product' i]",
      "[data-testid*='order' i] [data-testid*='product' i]",
      "[data-qa*='order' i] [data-qa*='product' i]"
    ]) {
      for (const element of all(selector).filter(visible)) {
        if (!candidates.includes(element)) candidates.push(element);
      }
    }
    const orderCards = candidates.map((element) => {
      const text = safeText(element);
      const links = [...element.querySelectorAll("a[href]")]
        .map((link) => absoluteUrl(link.href))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 8);
      const images = [...element.querySelectorAll("img")]
        .filter(visible)
        .map((image) => {
          const link = image.closest("a[href]");
          return {
            url: absoluteUrl(
              image.currentSrc ||
              image.src ||
              image.getAttribute("data-src") ||
              ""
            ),
            alt: clean(image.alt).slice(0, 500),
            productUrl: absoluteUrl(link?.href || "")
          };
        })
        .filter((image) => image.url)
        .filter((image, index, values) =>
          values.findIndex((candidate) => candidate.url === image.url) === index
        ).slice(0, 12);
      const lines = String(element.innerText || "")
        .split(/\n+/).map(clean).filter(Boolean);
      const size = lines.find((line) =>
        /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2})$/i.test(line)
      ) || text.match(/\b(?:beden|size)\s*[:.]?\s*(XXS|XS|S|M|L|XL|XXL|\d{2})\b/i)?.[1] || "";
      const name = lines
        .filter((line) => line.length >= 4 && line.length <= 160)
        .find((line) =>
          /(jean|pantolon|tişört|t-?shirt|shirt|sweat|hoodie|ceket|jacket|mont|coat|etek|skirt|elbise|dress|kazak|hırka|ayakkabı|shoe|sneaker|fit)/i.test(line)
        ) || clean(images[0]?.alt);
      return {
        text,
        brand: clean(meta("og:site_name") ||
          location.hostname.replace(/^www\./, "").split(".")[0]).slice(0, 100),
        productName: name.slice(0, 240),
        purchasedSize: clean(size).toUpperCase().slice(0, 30),
        productLinks: links,
        imageAlt: images[0]?.alt || "",
        imageUrl: images[0]?.url || "",
        images
      };
    }).filter((card) =>
      card.text.length >= 8 &&
      (card.productName || card.purchasedSize || card.images.length)
    ).slice(0, 25);
    if (!orderCards.length) {
      throw new Error(
        "Görünür sipariş ürünü bulunamadı. Sipariş ayrıntısını açıp ürün görseli ve bedeni ekranda tutun."
      );
    }
    redactSensitiveVisible();
    return {
      pageUrl: location.href.slice(0, 1000),
      pageTitle: clean(document.title).slice(0, 240),
      retailer: clean(meta("og:site_name") ||
        location.hostname.replace(/^www\./, "").split(".")[0]).slice(0, 120),
      sanitizedText: orderCards.map((card, index) =>
        "KART " + (index + 1) + ": " + card.text
      ).join("\n\n").slice(0, 30000),
      orderCards
    };
  };
  window.__fitmemoryScan = async (mode) => {
    try {
      const snapshot = mode === "orders"
        ? scrapeOrders()
        : await scrapeProduct();
      if (mode === "orders") {
        await new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(resolve)));
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: mode === "orders" ? "fitmemory-orders" : "fitmemory-product",
        snapshot
      }));
    } catch (error) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "fitmemory-error",
        message: error?.message || "Sayfa taranamadı."
      }));
    }
  };
  window.__fitmemoryRestoreRedactions = () => {
    for (const element of document.querySelectorAll(
      "[data-fitmemory-redaction='true']"
    )) {
      element.remove();
    }
  };
})();true;
`;

export function createScanScript(mode: "product" | "orders") {
  return `${scannerBootstrap}
window.__fitmemoryScan(${JSON.stringify(mode)});
true;`;
}
