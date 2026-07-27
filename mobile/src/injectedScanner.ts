const scannerBootstrap = String.raw`
(function () {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const fold = (value) => clean(value)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
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
  let rootCache = null;
  const roots = (refresh = false) => {
    if (!refresh && rootCache) return rootCache;
    const result = [document];
    const queue = [document];
    while (queue.length && result.length < 100) {
      const root = queue.shift();
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot && !result.includes(element.shadowRoot)) {
          result.push(element.shadowRoot);
          queue.push(element.shadowRoot);
        }
        if (element.tagName === "IFRAME") {
          try {
            const frameDocument = element.contentDocument;
            if (frameDocument && !result.includes(frameDocument)) {
              result.push(frameDocument);
              queue.push(frameDocument);
            }
          } catch {}
        }
      }
    }
    rootCache = result;
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
  const materialDetails = async () => {
    const trigger = findShortTextControl(
      /^(icerik ve bakim|icerik & bakim|composition|materials?|fabric and care|details)$/i
    );
    if (trigger) {
      await clickElement(trigger);
      await sleep(500);
    }
    const candidates = all(
      "details, [class*='composition' i], [class*='material' i], " +
      "[class*='care' i], [data-testid*='composition' i]"
    ).filter(visible).map((element) => clean(element.innerText || element.textContent))
      .filter((text) => text.length >= 8 && text.length <= 5000);
    const body = clean(document.body?.innerText || "");
    const foldedBody = fold(body);
    const start = Math.max(0, foldedBody.search(
      /icerik ve bakim|bilesim|composition|materials?|fabric and care/
    ));
    const evidence = candidates.sort((a, b) => b.length - a.length)[0] ||
      (start >= 0 ? body.slice(start, start + 1600) : "");
    const matches = [...evidence.matchAll(/(?:%\s*)?\d{1,3}\s*%?\s*(?:pamuk|cotton|polyester|keten|linen|viskon|viscose|yün|wool|elastan|elastane|polyamid|polyamide)/gi)]
      .map((match) => clean(match[0]));
    return {
      summary: matches.slice(0, 4).join(" · ").slice(0, 240),
      evidence: evidence.slice(0, 1600)
    };
  };
  const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  const progress = (message) => {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "fitmemory-progress",
        message
      }));
    } catch {}
  };
  let guideStage = "Beden paneli aranıyor";
  const waitFor = async (predicate, timeout = 4000, interval = 80) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      try {
        const value = predicate();
        if (value) return value;
      } catch {}
      await sleep(interval);
    }
    return null;
  };
  const controlText = (element) => clean(
    element.innerText || element.textContent || element.value ||
    element.getAttribute?.("aria-label") || element.getAttribute?.("title") ||
    element.getAttribute?.("data-testid") || ""
  );
  const clickable = (element) =>
    element?.closest?.("button, a, [role='button'], [role='radio'], [role='option'], summary") || element;
  const clickElement = async (element) => {
    const target = clickable(element);
    if (!target) return false;
    if (target.tagName === "A") {
      const href = clean(target.getAttribute("href"));
      if (href && !href.startsWith("#") &&
          !href.toLowerCase().startsWith("javascript:")) return false;
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    await sleep(100);
    try { target.focus?.({ preventScroll: true }); } catch {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      } catch {}
    }
    try { target.click?.(); } catch {}
    roots(true);
    return true;
  };
  const findShortTextControl = (pattern) => all(
    "button, a, [role='button'], [role='radio'], [role='option'], summary, " +
    "[data-testid], [data-qa], [aria-label], span, div"
  ).filter(visible).map((element) => ({
    element,
    text: controlText(element)
  })).filter(({ text }) => text && text.length <= 90 && pattern.test(fold(text)))
    .sort((left, right) =>
      left.text.length - right.text.length ||
      left.element.childElementCount - right.element.childElementCount
    )[0]?.element || null;
  const findExactControl = (pattern) => all(
    "button, [role='button'], input[type='button'], input[type='submit'], a"
  ).filter(visible).map((element) => ({
    element,
    text: clean(element.value || controlText(element))
  })).filter(({ text }) => text && text.length <= 80 && pattern.test(fold(text)))
    .sort((left, right) => left.text.length - right.text.length)[0]?.element || null;
  const findExactVisibleTextControl = (pattern) =>
    findExactControl(pattern) || findShortTextControl(pattern);
  const measurementPattern =
    /^(?:urun\s+)?olculeri(?:ni)?\s+(?:gor|goster|goruntule)$|^olculeri?\s+gor$|^olculer$|beden rehberi|beden tablosu|size guide|view measurements?|measurements?/i;
  const findMeasurementTrigger = () =>
    all(
      "button, a, [role='button'], summary, [data-testid*='measure' i], " +
      "[data-qa*='measure' i], [aria-label*='ölç' i], " +
      "[aria-label*='size guide' i], [class*='measure' i], span, div"
    ).filter(visible).map((element) => ({
      element,
      text: controlText(element),
      folded: fold(controlText(element))
    })).filter(({ text, folded }) => text.length <= 120 &&
      measurementPattern.test(folded) &&
      !/(sepete|satin al|checkout|odeme)/i.test(folded)
    ).sort((left, right) =>
      left.text.length - right.text.length ||
      left.element.childElementCount - right.element.childElementCount
    )[0]?.element || null;
  const sizePattern = /^(XXXL|XXL|XL|L|M|S|XS|XXS|XXXS|\d{1,3}(?:[/-]\d{1,3})?)$/i;
  const sizeLabelFromText = (value) => {
    const text = clean(value).toUpperCase();
    return text.match(/^(XXXL|XXL|XL|L|M|S|XS|XXS|XXXS|\d{1,3}(?:[/-]\d{1,3})?)(?:\s*\([^)]*\))?$/i)?.[1]?.toUpperCase() ||
      text.match(/\((?:US\s*)?(XXXL|XXL|XL|L|M|S|XS|XXS|XXXS|\d{1,3})\)/i)?.[1]?.toUpperCase() || "";
  };
  const measurementNamePattern =
    /gogus|chest|bust|omuz|shoulder|bel|waist|kalca|basen|hip|on uzunluk|front length|uzunluk|length|kol|sleeve|ic bacak|inseam|uyluk|thigh|paca|leg opening|yukseklik|rise/i;
  const panelText = (panel) => clean(panel?.innerText || panel?.textContent || "");
  const ownText = (element) => clean([...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "").join(" "));
  const findMeasurePanel = () => {
    const candidates = all(
      "[role='dialog'], aside, table, [role='table'], " +
      "[class*='measure' i], [class*='size-guide' i], " +
      "[class*='sizeguide' i], [class*='size-chart' i], " +
      "[class*='drawer' i], [class*='sheet' i], [class*='modal' i], " +
      "[class*='product-size' i]"
    ).filter(visible);
    const metricLabels = all("th, td, dt, dd, p, span, li, div")
      .filter(visible)
      .filter((element) => {
        const text = fold(ownText(element));
        return text.length > 0 && text.length <= 42 && measurementNamePattern.test(text);
      });
    for (const label of metricLabels.slice(0, 80)) {
      let ancestor = label.parentElement;
      for (let depth = 0; ancestor && depth < 7; depth += 1) {
        const text = fold(panelText(ancestor));
        if (text.length >= 15 && text.length <= 4500 &&
            (text.match(/\d{1,3}(?:[.,]\d+)?/g) || []).length >= 2) {
          candidates.push(ancestor);
        }
        ancestor = ancestor.parentElement;
      }
    }
    const unique = [...new Set(candidates)];
    return unique.map((panel) => {
      const text = fold(panelText(panel));
      const metricCount = (text.match(/gogus|chest|bust|omuz|shoulder|bel|waist|kalca|hip|uzunluk|length|kol|sleeve|inseam/g) || []).length;
      const numericCount = (text.match(/\d{1,3}(?:[.,]\d+)?/g) || []).length;
      const sizeCount = findSizeButtons(panel).length;
      return {
        panel,
        metricCount,
        numericCount,
        sizeCount,
        isTable: panel.matches("table, [role='table']"),
        score: Math.min(metricCount, 8) * 8 + Math.min(numericCount, 14) + Math.min(sizeCount, 10) * 4 - Math.min(text.length / 3000, 5)
      };
    }).filter((candidate) =>
      candidate.metricCount >= 1 &&
      candidate.numericCount >= 2 &&
      (candidate.sizeCount >= 1 || candidate.isTable) &&
      candidate.score >= 13
    )
      .sort((left, right) => right.score - left.score)[0]?.panel || null;
  };
  function findSizeButtons(panel) {
    if (!panel) return [];
    const result = [];
    const seen = new Set();
    const candidates = [panel, ...panel.querySelectorAll(
      "button, [role='radio'], [role='option'], [role='button'], li, label, span"
    )];
    for (const element of candidates) {
      if (!visible(element)) continue;
      const label = sizeLabelFromText(controlText(element));
      if (!label || !sizePattern.test(label)) continue;
      const target = clickable(element);
      if (!target || !panel.contains(target) || seen.has(target)) continue;
      seen.add(target);
      result.push(target);
    }
    return result.slice(0, 24);
  }
  const selectedSizeButton = (button) => {
    if (!button) return false;
    if (button.getAttribute("aria-checked") === "true" ||
        button.getAttribute("aria-selected") === "true" ||
        button.getAttribute("aria-pressed") === "true") return true;
    return /(?:^|[\s_-])(active|checked|selected)(?:$|[\s_-])/i.test(clean([
      button.getAttribute("data-state"),
      button.getAttribute("data-selected"),
      button.className
    ].join(" ")));
  };
  const openSizeGuide = async () => {
    if (tableChart() || geometryChart() || (() => {
      const panel = findMeasurePanel();
      return panel && extractMeasurements(panel).length > 0;
    })()) {
      guideStage = "Ölçü paneli açık";
      return true;
    }
    let measurement = findMeasurementTrigger();
    if (measurement && await clickElement(measurement)) {
      guideStage = "Ölçüleri görüntüle tıklandı";
      progress(guideStage);
      const panel = await waitFor(() => tableChart() || geometryChart() || (() => {
        const found = findMeasurePanel();
        return found && extractMeasurements(found).length > 0;
      })(), 7000, 160);
      if (panel) return true;
    }
    const isPullAndBear = /(?:^|\.)pullandbear\.com$/i.test(location.hostname);
    const addControl = isPullAndBear
      ? findExactVisibleTextControl(/^(ekle|sepete ekle|add|add to bag|add to basket)$/i)
      : /(?:^|\.)(bershka|zara)\.com$/i.test(location.hostname)
        ? findExactVisibleTextControl(/^(ekle|sepete ekle|add|add to bag|add to basket)$/i)
        : null;
    const sizeControl = findExactVisibleTextControl(
      /^(bir\s+)?beden sec$|^beden secin$|^choose size$|^select size$|^beden$|^size$/i
    );
    const opener = isPullAndBear ? addControl : (sizeControl || addControl);
    if (opener) {
      guideStage = isPullAndBear ? "Ekle düğmesi bulundu" : "Beden seçici bulundu";
      progress(guideStage);
      await clickElement(opener);
      guideStage = isPullAndBear ? "Ekle tıklandı, ölçü bağlantısı bekleniyor" : "Beden paneli açılıyor";
      progress(guideStage);
      measurement = await waitFor(() => findMeasurementTrigger(), 6000, 180);
      if (measurement && await clickElement(measurement)) {
        guideStage = "Ölçüleri görüntüle tıklandı";
        progress(guideStage);
        const panel = await waitFor(() => tableChart() || geometryChart() || (() => {
          const found = findMeasurePanel();
          return found && extractMeasurements(found).length > 0;
        })(), 9000, 180);
        if (panel) return true;
      }
      guideStage = measurement
        ? "Ölçü bağlantısı tıklandı ancak tablo oluşmadı"
        : "Ekle açıldı ancak Ölçüleri görüntüle bulunamadı";
    } else {
      guideStage = isPullAndBear
        ? "Sayfadaki Ekle düğmesi bulunamadı"
        : "Beden seçici bulunamadı";
    }
    return Boolean(tableChart() || geometryChart() || (() => {
      const panel = findMeasurePanel();
      return panel && extractMeasurements(panel).length > 0;
    })());
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
  const normalizeMeasurementLabel = (value) => {
    const text = fold(value);
    if (/gogus|chest|bust/.test(text)) return "Göğüs eni";
    if (/on uzunluk|front length/.test(text)) return "Ön uzunluk";
    if (/kol|sleeve/.test(text)) return "Kol uzunluğu";
    if (/bel|waist/.test(text)) return "Bel eni";
    if (/kalca|basen|hip/.test(text)) return "Kalça eni";
    if (/omuz|shoulder/.test(text)) return "Omuz";
    if (/ic bacak|inseam/.test(text)) return "İç bacak";
    if (/uyluk|thigh/.test(text)) return "Uyluk eni";
    if (/paca|leg opening/.test(text)) return "Paça eni";
    if (/yukseklik|rise/.test(text)) return "Ağ yüksekliği";
    if (/uzunluk|length/.test(text)) return "Uzunluk";
    return clean(value).slice(0, 80);
  };
  const geometryChart = () => {
    const nodes = all("th, td, [role='cell'], [role='columnheader'], [role='rowheader'], button, span, p, div")
      .filter(visible).map((element) => {
        const text = clean(ownText(element) || (element.childElementCount <= 1 ? element.textContent : ""));
        return { text, folded: fold(text), rect: element.getBoundingClientRect() };
      }).filter((item) => item.text && item.text.length <= 60 && item.rect.width < innerWidth * .85);
    const metrics = nodes.filter((item) => measurementNamePattern.test(item.folded) && !/nasil|how/.test(item.folded));
    const numbers = nodes.filter((item) => /^\d{1,3}(?:[.,]\d+)?$/.test(item.text));
    if (!metrics.length || numbers.length < 2) return null;
    const metricRows = metrics.map((metric) => {
      const y = metric.rect.top + metric.rect.height / 2;
      const values = numbers.filter((candidate) => {
        const cy = candidate.rect.top + candidate.rect.height / 2;
        return Math.abs(cy - y) <= Math.max(26, metric.rect.height) && candidate.rect.left > metric.rect.left + 30;
      }).sort((a, b) => a.rect.left - b.rect.left);
      return { metric, values };
    }).filter((row) => row.values.length);
    if (!metricRows.length) return null;
    const columns = Math.max(...metricRows.map((row) => row.values.length));
    const anchor = metricRows.find((row) => row.values.length === columns)?.values || metricRows[0].values;
    const sizes = anchor.map((value, index) => {
      const x = value.rect.left + value.rect.width / 2;
      const candidates = nodes.filter((candidate) => {
        const label = sizeLabelFromText(candidate.text);
        const cx = candidate.rect.left + candidate.rect.width / 2;
        return label && candidate.rect.bottom < metricRows[0].metric.rect.top + 20 && Math.abs(cx - x) < 75;
      }).sort((a, b) => b.rect.bottom - a.rect.bottom);
      return sizeLabelFromText(candidates[0]?.text) || "Beden " + (index + 1);
    });
    const headers = ["Beden", ...metricRows.map((row) => normalizeMeasurementLabel(row.metric.text))];
    const rows = sizes.map((size, index) => ({ cells: [size, ...metricRows.map((row) => row.values[index]?.text.replace(",", ".") || "")] }))
      .filter((row) => row.cells.slice(1).some(Boolean));
    if (!rows.length) return null;
    const rawText = [headers.join(" | "), ...rows.map((row) => row.cells.join(" | "))].join("\n");
    return { found: true, title: "Ürün ölçüleri", unit: "Centimeters", headers, rows, rawText };
  };
  const extractMeasurements = (panel) => {
    const measurements = [];
    const seen = new Set();
    const add = (label, value) => {
      const normalized = normalizeMeasurementLabel(label);
      const numeric = clean(value).replace(",", ".").match(/\d{1,3}(?:\.\d+)?/)?.[0] || "";
      if (!normalized || !numeric || seen.has(normalized)) return;
      seen.add(normalized);
      measurements.push({ label: normalized, value: numeric });
    };
    for (const row of panel.querySelectorAll("tr, [role='row']")) {
      const cells = [...row.querySelectorAll("th, td, [role='cell'], [role='rowheader']")]
        .map((cell) => clean(cell.innerText || cell.textContent)).filter(Boolean);
      if (cells.length < 2 || !measurementNamePattern.test(fold(cells[0]))) continue;
      const cmValue = cells.find((cell, index) => index > 0 && /\d/.test(cell));
      if (cmValue) add(cells[0], cmValue);
    }
    const text = fold(panelText(panel));
    const pattern = /(gogus|chest|bust|on\s*uzunluk|front\s*length|kol\s*uzunlugu|sleeve(?:\s*length)?|bel|waist|kalca|basen|hip|omuz|shoulder|ic\s*bacak|inseam|uyluk|thigh|paca|leg\s*opening|ag\s*yuksekligi|rise|uzunluk|length)\s*[:\-.]?\s*(?:cm\s*)?(\d{1,3}(?:[.,]\d+)?)/gi;
    for (const match of text.matchAll(pattern)) add(match[1], match[2]);
    if (measurements.length < 2) {
      const labels = [...panel.querySelectorAll("th, td, dt, dd, p, span, div")]
        .filter(visible).filter((element) => {
          const value = fold(element.innerText || element.textContent);
          return value.length > 0 && value.length <= 45 && measurementNamePattern.test(value);
        });
      for (const labelElement of labels) {
        let row = labelElement.parentElement;
        for (let depth = 0; row && depth < 4; depth += 1) {
          const label = clean(labelElement.innerText || labelElement.textContent);
          const values = (clean(row.innerText || row.textContent).match(/\d{1,3}(?:[.,]\d+)?/g) || []);
          if (values.length) { add(label, values[0]); break; }
          row = row.parentElement;
        }
      }
    }
    return measurements;
  };
  const measureSignature = () => {
    const panel = findMeasurePanel();
    if (!panel) return "";
    return extractMeasurements(panel).map((item) => item.label + ":" + item.value).join("|") || panelText(panel).slice(0, 1000);
  };
  const panelChart = async () => {
    let panel = findMeasurePanel();
    if (!panel) return null;
    const initial = findSizeButtons(panel).find(selectedSizeButton);
    const initialLabel = clean(initial?.innerText || initial?.textContent).toUpperCase();
    const labels = findSizeButtons(panel)
      .map((button) => clean(button.innerText || button.textContent).toUpperCase())
      .filter(size => sizePattern.test(size))
      .filter((size, index, values) => values.indexOf(size) === index);
    const records = [];
    let headers = null;
    const targets = labels.length ? labels : [initialLabel || "Bilinmiyor"];
    for (const size of targets.slice(0, 10)) {
      panel = findMeasurePanel() || panel;
      const button = findSizeButtons(panel).find((candidate) =>
        clean(candidate.innerText || candidate.textContent).toUpperCase() === size);
      if (button && !selectedSizeButton(button)) {
        const before = measureSignature();
        await clickElement(button);
        await waitFor(() => selectedSizeButton(button) || measureSignature() !== before, 700, 70);
        await sleep(80);
      }
      panel = findMeasurePanel() || panel;
      const measurements = extractMeasurements(panel);
      if (!measurements.length) continue;
      headers ||= ["Beden", ...measurements.map((item) => item.label)];
      const byLabel = new Map(measurements.map((item) => [item.label, item.value]));
      records.push({
        cells: [size, ...headers.slice(1).map((label) => byLabel.get(label) || "")]
      });
    }
    if (initialLabel) {
      panel = findMeasurePanel() || panel;
      const restore = findSizeButtons(panel).find((button) =>
        clean(button.innerText || button.textContent).toUpperCase() === initialLabel);
      if (restore && !selectedSizeButton(restore)) await clickElement(restore);
    }
    const finalText = panelText(findMeasurePanel() || panel);
    if (!records.length || !headers) return null;
    return {
      found: true,
      title: "Ürün ölçüleri",
      unit: /\bcm\b/i.test(finalText) ? "Centimeters" :
        /\b(inch|inç)\b/i.test(finalText) ? "Inches" : "Centimeters",
      headers,
      rows: records.slice(0, 30),
      rawText: [headers.join(" | "), ...records.map((row) => row.cells.join(" | "))].join("\n").slice(0, 8000)
    };
  };
  const scrapeProduct = async () => {
    const material = await materialDetails();
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
    let chart = null;
    for (let attempt = 0; attempt < 2 && !chart?.found; attempt += 1) {
      chart = tableChart() || geometryChart() || await panelChart();
      if (chart?.found) break;
      await openSizeGuide();
      await sleep(250);
    }
    if (!chart?.found) {
      return {
        fallback: true,
        reason: "Beden tablosu DOM üzerinden okunamadı: " + guideStage + ".",
        pageText: pageText.slice(0, 20000),
        product: {
          url: location.href.slice(0, 1000), brand, name: title,
          category: clean(structured?.category || "Diğer").slice(0, 120),
          price: clean([offers?.price || meta("product:price:amount"), offers?.priceCurrency || meta("product:price:currency")].filter(Boolean).join(" ")).slice(0, 80),
          imageUrl: chooseProductImage(structured, title).slice(0, 1000),
          productReference: reference, fitLabel: fit.label, fitEvidence: fit.evidence,
          description: clean(structured?.description || "").slice(0, 1200),
          materialSummary: material.summary, materialEvidence: material.evidence,
          modelHeightCm: model.heightCm, modelWornSize: model.size, modelEvidence: model.evidence
        }
      };
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
        materialSummary: material.summary,
        materialEvidence: material.evidence,
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
  const scrapeOrders = async () => {
    const orderImageUrl = (image) => {
      const candidates = [
        image.currentSrc,
        image.src,
        image.getAttribute("data-src"),
        image.getAttribute("data-original"),
        image.getAttribute("data-lazy-src"),
        image.getAttribute("data-image-url"),
        clean(image.getAttribute("srcset")).split(",").map((part) => part.trim().split(/\s+/)[0]).pop()
      ].map(absoluteUrl).filter(Boolean);
      return candidates.find((value) => /^https?:\/\//i.test(value)) || candidates[0] || "";
    };
    const controls = all("button, [role='button']")
      .filter(visible)
      .filter((button) =>
        /(ayrıntıları|detayları)\s+göster|show\s+details/i
          .test(clean(button.innerText || button.textContent))
      ).slice(0, 12);
    for (const control of controls) {
      await clickElement(control);
      await sleep(350);
    }
    const candidates = [];
    for (const image of all("main img, img").filter(visible)) {
      const rect = image.getBoundingClientRect();
      if (rect.width < 55 || rect.height < 65) continue;
      const container = closestProductContainer(image);
      if (container && !candidates.includes(container)) candidates.push(container);
    }
    for (const element of all("span, p, div, li").filter(visible)) {
      const own = clean(element.innerText || element.textContent);
      if (!/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|2[4-9]|3\d|4\d|5[0-9])$/i.test(own)) continue;
      const container = closestProductContainer(element);
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
            url: orderImageUrl(image),
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
      ) || text.match(/\b(?:beden|size)\s*[:.]?\s*(XXS|XS|S|M|L|XL|XXL|\d{2})\b/i)?.[1] ||
        text.match(/\b1\s*(?:adet|item)\s*[·|\-]?\s*(XXS|XS|S|M|L|XL|XXL|\d{2})\b/i)?.[1] || "";
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
        ? await scrapeOrders()
        : await scrapeProduct();
      if (mode === "orders") {
        await new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(resolve)));
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: mode === "orders" ? "fitmemory-orders" :
          snapshot?.fallback ? "fitmemory-product-fallback" : "fitmemory-product",
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
