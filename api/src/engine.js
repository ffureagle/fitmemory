const LETTER_ORDER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const WIDTH = "width";
const CIRCUMFERENCE = "circumference";
const LINEAR = "linear";
const MASS = "mass";

const TOLERANCES = {
  Chest: 4,
  Waist: 4,
  Shoulder: 2.5,
  Length: 4,
  Sleeve: 3,
  Inseam: 3,
  Hip: 4,
  FootLength: 0.45,
  Height: 8,
  Weight: 8
};

const EMPTY_STYLE = {
  compatibleItemCount: 0,
  outfitCount: 0,
  confidence: 0,
  headline: "Dolap eşleşmesi bekleniyor",
  summary: "Dolabındaki parçalar tarandığında kombin seçenekleri burada görünür.",
  ageContext: "",
  outfits: []
};

export function emptyStyle() {
  return { ...EMPTY_STYLE, outfits: [] };
}

export function analyzeRecommendation(profile, orders, request) {
  const candidates = parseCandidates(request.sizeChart);
  const chartSizes = [...new Set(candidates.map((item) => item.label))];
  const selling = [...new Set((request.sizeChart?.sellingSizes || []).map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
  const letterSelling = selling.filter((item) => ["XXXS","XXS","XS","S","M","L","XL","XXL","XXXL"].includes(item));
  const textSizes = extractTextSizes(request.sizeChart?.rawText, request.product);
  let availableSizes = letterSelling.length >= 2 ? letterSelling : [...new Set(chartSizes.length ? chartSizes : textSizes)];
  if (availableSizes.length === 0) {
    return result("Bilinmiyor", 20,
      "Tabloda okunabilir beden etiketleri bulunamadı.",
      "FitMemory bir beden tablosu alanı buldu ancak beden etiketlerini veya ölçüleri güvenilir biçimde ayrıştıramadı.",
      ["Yeniden taramadan önce beden tablosunun tamamını açın."],
      [], "local");
  }

  const targets = buildTargets(profile, orders, request.product);
  const evaluated = candidates.map((candidate, index) =>
    scoreCandidate(candidate, targets, profile, request.product, index));
  const scored = evaluated
    .filter((item) => item.matchedMetrics > 0 && item.structurallyPlausible)
    .sort((left, right) => left.score - right.score || left.index - right.index);

  if (scored.length > 0) {
    const best = scored[0];
    const comparisons = buildComparisons(best.candidate, targets, profile);
    return result(
      applyMerchantSizeShift(best.candidate.label, request.product, availableSizes),
      calculateConfidence(best, orders, targets),
      `${best.candidate.label}, ölçülerinize en güçlü eşleşme.`,
      buildExplanation(best.candidate, comparisons, profile, request.product),
      buildFitNotes(profile),
      comparisons,
      "local"
    );
  }

  return result("Bilinmiyor", 0,
    "Ürün ölçüleri okunmadan beden önerilmedi.",
    "Sayfadaki ölçü tablosu henüz sayısal giysi milimine dönüşmedi. FitMemory bu yüzden göğüs çevrenden beden uydurmadı. Ölçüler sekmesini açık bırakıp yeniden dene.",
    ["Beden önerisi yalnız okunan ürün ölçülerinden üretilir."],
    [], "local-insufficient");
}

function result(recommendedSize, confidence, verdict, explanation, fitNotes, comparisons, dataSource) {
  return {
    recommendedSize,
    confidence,
    verdict,
    explanation,
    fitNotes,
    comparisons,
    evidenceSummary: "Yerel ölçü motoru",
    dataSource,
    style: emptyStyle()
  };
}

function parseCandidates(chart) {
  const headers = chart?.headers || [];
  const rows = chart?.rows || [];
  if (headers.length === 0 || rows.length === 0) {
    return [];
  }
  const sizeIndex = findSizeIndex(headers);
  if (sizeIndex < 0) {
    return [];
  }
  const candidates = [];
  for (const row of rows) {
    const cells = row.cells || [];
    if (cells.length === 0 || sizeIndex >= cells.length) {
      continue;
    }
    const label = normalizeSizeLabel(cells[sizeIndex]);
    if (!label) {
      continue;
    }
    const measurements = {};
    for (let index = 0; index < Math.min(headers.length, cells.length); index += 1) {
      if (index === sizeIndex) {
        continue;
      }
      const metric = canonicalMetric(headers[index]);
      const parsed = tryParseMeasurement(cells[index], headers[index], chart.unit, metric);
      if (metric && parsed && !measurements[metric]) {
        measurements[metric] = parsed;
      }
    }
    candidates.push({ label, measurements });
  }
  return candidates;
}

function findSizeIndex(headers) {
  return headers.findIndex((header) => {
    const normalized = String(header || "").toLocaleLowerCase("tr-TR");
    return normalized.includes("size") ||
      normalized.includes("beden") ||
      normalized === "eu" ||
      normalized === "uk" ||
      normalized === "us";
  });
}

function canonicalMetric(header) {
  const normalized = String(header || "").toLocaleLowerCase("tr-TR");
  if (/foot length|ayak uzun|ayak boy|taban uzun/.test(normalized)) return "FootLength";
  if (/chest|bust|göğüs|gogus/.test(normalized)) return "Chest";
  if (/waist|bel/.test(normalized)) return "Waist";
  if (/shoulder|omuz/.test(normalized)) return "Shoulder";
  if (/sleeve|arm length|\bkol\b/.test(normalized)) return "Sleeve";
  if (/inseam|inside leg|iç bacak|ic bacak/.test(normalized)) return "Inseam";
  if (/hip|seat|kalça|kalca/.test(normalized)) return "Hip";
  if (/height|\bboy\b/.test(normalized)) return "Height";
  if (/weight|kilo|ağırlık/.test(normalized)) return "Weight";
  if (/length|uzunluk/.test(normalized)) return "Length";
  return null;
}

function tryParseMeasurement(cell, header, chartUnit, metric) {
  if (!metric) {
    return null;
  }
  const matches = String(cell || "").match(/\d+(?:[.,]\d+)?/g) || [];
  const values = matches
    .map((token) => Number.parseFloat(token.replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  let value = values.length > 1 ? values.reduce((sum, item) => sum + item, 0) / values.length : values[0];
  const normalizedHeader = String(header || "").toLowerCase();
  const isInches = String(chartUnit || "").toLowerCase() === "inches" ||
    normalizedHeader.includes("inch") ||
    normalizedHeader.includes("(in)");
  if (isInches && metric !== "Weight") {
    value *= 2.54;
  }
  return { value: Math.round(value * 10) / 10, kind: metricKind(metric, normalizedHeader, value) };
}

const SHOULDER_CIRCUMFERENCE_FLOOR = 70;

function storedShoulderCircumference(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value >= SHOULDER_CIRCUMFERENCE_FLOOR ? value : value * 2;
}

function storedShoulderWidth(raw) {
  return storedShoulderCircumference(raw) / 2;
}

function metricKind(metric, header, value) {
  if (metric === "Weight") {
    return MASS;
  }
  if (!["Chest", "Waist", "Hip", "Shoulder"].includes(metric)) {
    return LINEAR;
  }
  const explicitCircumference = /circum|body\s*meas|çevre|cevre/.test(header);
  const explicitWidth = /width|flat|half|1\/2|(?:^|[\s(])eni(?:$|[\s)])|genişlik|genislik/.test(header);
  const circumferenceFloor = metric === "Chest" ? 78 : metric === "Shoulder" ? SHOULDER_CIRCUMFERENCE_FLOOR : 60;
  if (explicitCircumference && !explicitWidth) {
    return CIRCUMFERENCE;
  }
  if (value >= circumferenceFloor) {
    return CIRCUMFERENCE;
  }
  if (explicitWidth) {
    return WIDTH;
  }
  return WIDTH;
}

function normalizeSizeLabel(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const labelled = normalized.match(/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:[/-]\d{1,3})?)/);
  return labelled ? labelled[1] : normalized.slice(0, 30);
}

function extractTextSizes(rawText, product) {
  const text = String(rawText || "").toUpperCase();
  const letters = [...new Set(text.match(/\b(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL)\b/g) || [])];
  if (letters.length >= 2) {
    return letters;
  }
  if (isBottomProduct(product)) {
    const jeans = [...new Set(text.match(/\b(?:3[02468]|4[02468]|5[02])\b/g) || [])];
    if (jeans.length >= 2) {
      return jeans;
    }
  }
  return letters;
}

function isBottomProduct(product) {
  const value = `${product?.category || ""} ${product?.name || ""} ${product?.fitLabel || ""}`.toLowerCase();
  return /pantolon|pantalon|jean|denim|\bşort\b|\bsort\b|shorts|etek|skirt|chino|cargo/.test(value);
}

function buildTargets(profile, orders, product) {
  const targets = {};
  const kept = orders.filter((order) => order.outcome === "KeptGoodFit");
  addHistoryTarget(targets, "Chest", kept, (order) => order.chestWidthCm, WIDTH);
  addHistoryTarget(targets, "Shoulder", kept, (order) => storedShoulderWidth(order.shoulderWidthCm), WIDTH);
  addHistoryTarget(targets, "Length", kept, (order) => order.lengthCm, LINEAR);
  targets.Shoulder ||= {
    value: storedShoulderCircumference(profile.shoulderWidthCm),
    kind: CIRCUMFERENCE,
    strength: 0.65
  };
  if (profile.chestCircumferenceCm) {
    targets.Chest ||= {
      value: Number(profile.chestCircumferenceCm),
      kind: CIRCUMFERENCE,
      strength: 0.9
    };
  }
  targets.Waist ||= {
    value: Number(profile.waistCircumferenceCm),
    kind: CIRCUMFERENCE,
    strength: 0.55
  };
  targets.Height = {
    value: Number(profile.heightCm),
    kind: LINEAR,
    strength: 0.35
  };
  return targets;
}

function addHistoryTarget(targets, metric, kept, selector, kind) {
  const values = kept.map(selector).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (values.length === 0) {
    return;
  }
  targets[metric] = {
    value: Math.round((values.reduce((sum, item) => sum + item, 0) / values.length) * 10) / 10,
    kind,
    strength: 1
  };
}

function chestEaseWidth(product, preference) {
  const preferred = preference === "Slim" ? 1.5 : preference === "Relaxed" ? 4 : preference === "Oversized" ? 6 : 2.5;
  return Math.max(0.75, preferred);
}

function chestTargetValue(profile, product, measurementKind) {
  const body = Number(profile.chestCircumferenceCm);
  if (!body) {
    return 0;
  }
  if (measurementKind === WIDTH) {
    return body / 2 + chestEaseWidth(product, profile.fitPreference);
  }
  return body;
}

function scoreCandidate(candidate, targets, profile, product, index) {
  let score = 0;
  let matched = 0;
  for (const [metric, measurement] of Object.entries(candidate.measurements)) {
    const target = targets[metric];
    if (!target) {
      continue;
    }
    let targetValue = convertKind(target.value, target.kind, measurement.kind);
    if (metric === "Chest" && profile.chestCircumferenceCm) {
      targetValue = chestTargetValue(profile, product, measurement.kind);
    }
    const tolerance = TOLERANCES[metric] || 4;
    score += Math.abs(measurement.value - targetValue) / tolerance * target.strength;
    matched += 1;
  }
  if (isBottomProduct(product) && profile.waistCircumferenceCm) {
    const eu = evenEuFromWaist(profile.waistCircumferenceCm);
    const sizeNum = Number(candidate.label);
    if (eu && Number.isFinite(sizeNum)) {
      score += Math.abs(sizeNum - eu) / 8;
    }
  }
  const structural = evaluateStructuralFit(candidate, profile, product);
  return {
    candidate,
    score: score / Math.max(matched, 1) + structural.penalty,
    matchedMetrics: matched,
    structurallyPlausible: structural.plausible,
    index
  };
}

function evaluateStructuralFit(candidate, profile, product) {
  const fit = productFit(product);
  const shoulder = candidate.measurements.Shoulder;
  if (shoulder) {
    const difference = convertKind(shoulder.value, shoulder.kind, WIDTH) -
      storedShoulderWidth(profile.shoulderWidthCm);
    const bounds = {
      Slim: [-1.5, 3.5],
      Regular: [-1.5, 7],
      Relaxed: [-1, 9],
      Boxy: [-1, 12],
      Oversized: [-1, 16],
      Unknown: [-1.5, 7]
    }[fit] || [-1.5, 7];
    if (difference < bounds[0] || difference > bounds[1]) {
      return { plausible: false, penalty: 100 };
    }
  }
  const chest = candidate.measurements.Chest;
  if (profile.chestCircumferenceCm && chest) {
    const body = Number(profile.chestCircumferenceCm);
    if (chest.kind === CIRCUMFERENCE) {
      if (Math.abs(chest.value - body) > 10) {
        return { plausible: false, penalty: 100 };
      }
    } else if (chest.kind === WIDTH) {
      const ease = chest.value - body / 2;
      const bounds = preferredChestEaseBounds(profile.fitPreference, fit);
      if (ease < bounds[0] || ease > bounds[1]) {
        return { plausible: false, penalty: 100 };
      }
    }
  }
  const waist = candidate.measurements.Waist;
  if (profile.waistCircumferenceCm && waist) {
    const body = Number(profile.waistCircumferenceCm);
    const garment = convertKind(waist.value, waist.kind, CIRCUMFERENCE);
    const ease = garment - body;
    const bounds = preferredWaistEaseBounds(profile.fitPreference, fit);
    if (ease < bounds[0] || ease > bounds[1]) {
      return { plausible: false, penalty: 100 };
    }
  }
  const hip = candidate.measurements.Hip;
  if (profile.waistCircumferenceCm && hip && !waist) {
    const body = Number(profile.waistCircumferenceCm);
    const garment = convertKind(hip.value, hip.kind, CIRCUMFERENCE);
    const ease = garment - body;
    if (ease < -6 || ease > 22) {
      return { plausible: false, penalty: 100 };
    }
  }
  return { plausible: true, penalty: 0 };
}

function preferredWaistEaseBounds(preference, fit) {
  if (fit === "Oversized" || fit === "Relaxed" || fit === "Boxy") {
    return [-2, 16];
  }
  if (fit === "Slim" || preference === "Slim") {
    return [-3, 5];
  }
  if (preference === "Relaxed" || preference === "Oversized") {
    return [-2, 14];
  }
  return [-3, 8];
}

function preferredChestEaseBounds(preference, fit) {
  const bounds = preference === "Slim"
    ? [0.5, 2.75]
    : preference === "Relaxed"
      ? [2, 6]
      : preference === "Oversized"
        ? [3.5, 8]
        : [1, 4];
  const extra = fit === "Oversized" ? 1.5 : (fit === "Relaxed" || fit === "Boxy") ? 0.75 : 0;
  return [bounds[0], bounds[1] + extra];
}

function productFit(product) {
  const value = `${product?.fitLabel || ""} ${product?.fitEvidence || ""} ${product?.name || ""}`.toLowerCase();
  if (/boxy|kutu kal[iı]p/.test(value)) return "Boxy";
  if (/oversize|loose|baggy|bol kal[iı]p/.test(value)) return "Oversized";
  if (/relax|comfort|rahat kal[iı]p/.test(value)) return "Relaxed";
  if (/slim|skinny|fitted|dar kal[iı]p/.test(value)) return "Slim";
  if (/regular|standard|standart/.test(value)) return "Regular";
  return "Unknown";
}

function convertKind(value, from, to) {
  if (from === to) return value;
  if (from === WIDTH && to === CIRCUMFERENCE) return value * 2;
  if (from === CIRCUMFERENCE && to === WIDTH) return value / 2;
  return value;
}

function calculateConfidence(best, orders, targets) {
  const keptCount = orders.filter((order) => order.outcome === "KeptGoodFit").length;
  const scorePenalty = Math.round(Math.min(best.score * 7, 28));
  const confidence = 48 +
    Math.min(keptCount * 6, 18) +
    Math.min(best.matchedMetrics * 2, 8) -
    scorePenalty;
  return Math.max(35, Math.min(92, confidence));
}

function buildComparisons(candidate, targets, profile) {
  return Object.entries(candidate.measurements)
    .filter(([metric]) => targets[metric])
    .slice(0, 4)
    .map(([metric, measurement]) => {
      if (metric === "Chest" && profile.chestCircumferenceCm) {
        const body = Number(profile.chestCircumferenceCm);
        const garment = convertKind(measurement.value, measurement.kind, CIRCUMFERENCE);
        const ease = garment - body;
        return {
          label: measurement.kind === CIRCUMFERENCE ? "Göğüs çevresi" : "Göğüs",
          detail: `Vücut ${body} cm · ${candidate.label} giysi ${garment} cm · bolluk ${ease.toFixed(1)} cm`
        };
      }
      if (metric === "Shoulder") {
        const body = storedShoulderCircumference(profile.shoulderWidthCm);
        const garment = convertKind(measurement.value, measurement.kind, CIRCUMFERENCE);
        const ease = garment - body;
        return {
          label: measurement.kind === CIRCUMFERENCE ? "Omuz çevresi" : "Omuz",
          detail: `Vücut ${body} cm · ${candidate.label} giysi ${garment} cm · bolluk ${ease.toFixed(1)} cm`
        };
      }
      const target = targets[metric];
      const targetValue = convertKind(target.value, target.kind, measurement.kind);
      return {
        label: metric,
        detail: `Hedef ${targetValue.toFixed(1)} cm · ${candidate.label}: ${measurement.value} cm`
      };
    });
}

function buildExplanation(candidate, comparisons, profile, product) {
  const size = candidate.label;
  const fitLabel = String(product?.fitLabel || "").trim();
  const fitBit = fitLabel ? `${fitLabel} kesiminde ` : "";
  if (isBottomProduct(product) && profile.waistCircumferenceCm) {
    return `${size} beden ${fitBit}bel ölçüne oturur. Daha dar beden bele sıkışır; daha bol beden belde boşluk bırakır.`;
  }
  if (profile.chestCircumferenceCm) {
    return `${size} beden ${fitBit}göğüs ve kalıp etiketine göre senin ölçülerinle uyumlu durur.`;
  }
  return `${size} beden kayıtlı ölçülerinle bu ürünün kalıbına en yakın duran seçenek.`;
}

function buildFitNotes() {
  return [
    "Öneri yerel ölçü motoruyla üretildi.",
    "Göğüs eni ile omuz genişliği birbirinin yerine kullanılmadı."
  ];
}


function applyMerchantSizeShift(size, product, availableSizes) {
  const text = fold(`${product?.fitEvidence || ""} ${product?.description || ""} ${product?.name || ""} ${product?.merchantFitAdvice || ""}`);
  let delta = 0;
  if (/bir beden kucuk|runs large|size down|size smaller/.test(text)) delta = -1;
  else if (/bir beden buyuk|runs small|size up|size bigger/.test(text)) delta = 1;
  if (!delta) return size;
  const ordered = (availableSizes || []).map((item) => String(item).toUpperCase());
  const index = ordered.findIndex((item) => item === String(size).toUpperCase());
  if (index >= 0 && ordered[index + delta]) return ordered[index + delta];
  const letters = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
  const letterIndex = letters.indexOf(String(size).toUpperCase());
  if (letterIndex < 0) return size;
  const neighbor = letters[letterIndex + delta];
  return ordered.find((item) => item === neighbor) || size;
}

function estimateUpperBodyLabelSize(profile, product, availableSizes) {
  if (!profile.chestCircumferenceCm || !isUpperBody(product)) {
    return null;
  }
  const available = availableSizes
    .map((size) => String(size).trim().toUpperCase())
    .filter((size) => LETTER_ORDER.includes(size));
  if (available.length === 0) {
    return null;
  }
  const chest = Number(profile.chestCircumferenceCm);
  const ranges = [
    ["XXS", 70, 78],
    ["XS", 78, 86],
    ["S", 86, 94],
    ["M", 94, 102],
    ["L", 102, 110],
    ["XL", 110, 118],
    ["XXL", 118, 126],
    ["XXXL", 126, 134]
  ];
  let bodyRange = ranges.find(([, low, high]) => chest >= low && chest <= high) ||
    (chest < 70 ? ranges[0] : ranges.at(-1));
  const bodyIndex = LETTER_ORDER.indexOf(bodyRange[0]);
  const selected = available
    .slice()
    .sort((left, right) =>
      Math.abs(LETTER_ORDER.indexOf(left) - bodyIndex) -
      Math.abs(LETTER_ORDER.indexOf(right) - bodyIndex));
  return {
    selectedSize: selected[0],
    bodySize: bodyRange[0],
    chestCm: chest,
    rangeLow: bodyRange[1],
    rangeHigh: bodyRange[2],
    confidence: 38
  };
}

function isUpperBody(product) {
  const value = ` ${product?.category || ""} ${product?.name || ""} `.toLowerCase();
  if (/pantolon|jean|denim|şort|shorts|etek|ayakkabı|shoe|aksesuar/.test(value)) {
    return false;
  }
  return /tişört|tisort|t-shirt|tee|sweat|hoodie|kazak|gömlek|shirt|üst|top|mont|ceket|jacket/.test(value);
}

export function isVerifiedChart(product, chart) {
  if (!product?.name || !product?.brand || !chart?.found || !chart.rows?.length) {
    return false;
  }
  const headers = chart.headers || [];
  return chart.rows.some((row) => {
    const cells = row.cells || [];
    if (cells.length < 2 || !/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{2}(?:[/-]\d{2})?)$/i.test(String(cells[0]).trim())) {
      return false;
    }
    return cells.slice(1).some((cell, index) =>
      isValidMeasurement(headers[index + 1] || "", cell));
  });
}

function isValidMeasurement(label, value) {
  const folded = fold(label);
  if (!folded || /fiyat|price|sku|stok|stock|indirim/.test(folded)) {
    return false;
  }
  if (!/gogus|chest|bust|omuz|shoulder|bel|waist|kalca|hip|uzunluk|length|kol|sleeve|inseam/.test(folded)) {
    return false;
  }
  const match = String(value || "").match(/(?<!\d)(\d{1,3}(?:[.,]\d+)?)(?!\d)/);
  if (!match) {
    return false;
  }
  const number = Number.parseFloat(match[1].replace(",", "."));
  return number >= 1 && number <= 250;
}

function fold(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ç", "c")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u");
}

export function clothingSlot(product) {
  const value = ` ${product?.category || ""} ${product?.name || ""} `.toLowerCase();
  if (/ayakkabı|shoe|sneaker|bot|boot/.test(value)) return "footwear";
  if (/pantolon|jean|şort|shorts|etek/.test(value)) return "bottom";
  if (/mont|ceket|jacket|kaban|coat/.test(value)) return "outerwear";
  if (/tişört|t-shirt|tee|gömlek|shirt|sweat|kazak/.test(value)) return "upper";
  return "other";
}
