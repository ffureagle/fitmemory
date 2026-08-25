const CLOTHING_NAME =
  /(jean|denim|pantolon|trouser|pants|tişört|tisort|t-?shirt|shirt|gömlek|sweat|hoodie|kazak|hırka|ceket|jacket|mont|kaban|coat|parka|şort|short|etek|skirt|elbise|dress|tulum|jumpsuit|top|polo|bluz|blouse|yelek|vest|oversize|baggy|muscle|cargo|atlet|tayt|legging|triko|blazer|body|hoodie)/i;

const PRICE_OR_NAV =
  /(?:₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})|(sipariş|alışveriş tarihi|son iade|e-?fatura|merhaba|profilim|iadeler|oturumu kapat|teslim edildi|kargoda|hazırlanıyor)/i;

const ORDER_PAGE_HEADING =
  /^(alışveriş|alisveriş|alisveris|sipariş|siparis|order|shopping)\s+(özeti|ozeti|summary|details?|ayrıntısı|ayrintisi)$/i;

const ORDER_PAGE_NOISE =
  /^(toplam|ara toplam|kargo|ücretsiz kargo|teslim edildi|delivered|adet|beden|renk|size|qty|quantity)$/i;

export function isPlausiblePurchasedSize(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
  if (/^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL)$/.test(normalized)) {
    return true;
  }
  if (!/^\d{1,2}$/.test(normalized)) {
    return false;
  }
  const numeric = Number(normalized);
  return numeric >= 24 && numeric <= 60;
}

export function findSizeInText(text) {
  const upper = String(text || "").toUpperCase();
  const labeled = upper.match(
    /(?:^|[\s·|/:(])(?:BEDEN|SIZE|TALLA|TAILLE|TAGLIA)\s*[:.]?\s*([A-Z]{1,5}|\d{1,2})/
  );
  if (labeled && isPlausiblePurchasedSize(labeled[1])) {
    return labeled[1];
  }
  const region = upper.match(
    /(?:^|[\s·|/:(])(?:EU|UK)\s*[:.]?\s*(\d{1,2})/
  );
  if (region && isPlausiblePurchasedSize(region[1])) {
    return region[1];
  }
  const tokens = upper.split(/[^A-Z0-9ÇĞİÖŞÜ]+/);
  return tokens.find(isPlausiblePurchasedSize) || "";
}

export function isPlausibleProductName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (
    text.length < 4 ||
    text.length > 160 ||
    isPlausiblePurchasedSize(text) ||
    PRICE_OR_NAV.test(text) ||
    ORDER_PAGE_HEADING.test(text) ||
    ORDER_PAGE_NOISE.test(text)
  ) {
    return false;
  }
  if (!/[a-zçğıöşü]/i.test(text)) {
    return false;
  }
  if (CLOTHING_NAME.test(text)) {
    return true;
  }
  return text.split(/\s+/).filter(Boolean).length >= 2;
}

export function findProductNameInText(text) {
  const chunks = String(text || "")
    .split(/[·\n|/]+/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const named = chunks.filter(isPlausibleProductName);
  named.sort((left, right) => {
    const leftCloth = CLOTHING_NAME.test(left) ? 1 : 0;
    const rightCloth = CLOTHING_NAME.test(right) ? 1 : 0;
    return rightCloth - leftCloth || left.length - right.length;
  });
  return (named[0] || "").slice(0, 240);
}

export function completeOrderFields(card, retailer = "") {
  const brand =
    String(card?.brand || "").trim() ||
    String(retailer || "").trim();
  let productName = String(card?.productName || "").trim();
  let purchasedSize = String(card?.purchasedSize || "").trim().toUpperCase();
  const blob = [
    card?.text,
    card?.imageAlt,
    ...(Array.isArray(card?.images) ? card.images.map((image) => image?.alt) : [])
  ]
    .filter(Boolean)
    .join(" · ");

  if (!purchasedSize) {
    purchasedSize = findSizeInText(blob);
  }
  if (!productName) {
    productName = findProductNameInText(blob);
  }

  return {
    brand: brand.slice(0, 120),
    productName: productName.slice(0, 240),
    purchasedSize: purchasedSize.slice(0, 30)
  };
}

export function isOrderHistorySurface({
  hostname = "",
  pathname = "",
  title = "",
  headings = "",
  bodyText = ""
} = {}) {
  const host = String(hostname || "").toLowerCase();
  const path = String(pathname || "").toLowerCase();
  const blob = [path, title, headings, String(bodyText || "").slice(0, 2_500)]
    .join(" ")
    .toLowerCase();
  const orderWords =
    /(orders?|purchases?|order.?history|sipari[sş]|satın.?al|geçmiş|online-order|my.?purchases|user\/order|alışveriş.?özet|alisveris.?ozet|order.?summary|sipariş.?özet|teslim.?edildi|checkout)/i;
  const brandHost =
    /(bershka|pullandbear|zara|stradivarius|massimodutti|oysho|lefties)/i.test(host);
  const brandPath =
    /order|siparis|checkout|summary|ozet|özet|online-order|purchase|my-account/.test(path);
  return orderWords.test(blob) || (brandHost && brandPath);
}

export function harvestOrderBlocksFromText(rawText, retailer = "") {
  const lines = String(rawText || "")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const cards = [];
  const used = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (used.has(index)) {
      continue;
    }
    const name = lines[index];
    if (
      ORDER_PAGE_HEADING.test(name) ||
      ORDER_PAGE_NOISE.test(name) ||
      isPlausiblePurchasedSize(name)
    ) {
      continue;
    }
    if (!isPlausibleProductName(name) && !CLOTHING_NAME.test(name)) {
      continue;
    }

    const look = [];
    let end = index;
    for (let cursor = index + 1; cursor < lines.length && cursor <= index + 12; cursor += 1) {
      const line = lines[cursor];
      const nextProduct =
        !ORDER_PAGE_HEADING.test(line) &&
        !ORDER_PAGE_NOISE.test(line) &&
        !isPlausiblePurchasedSize(line) &&
        (isPlausibleProductName(line) || CLOTHING_NAME.test(line)) &&
        !/(?:₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})/i.test(line);
      if (nextProduct) {
        break;
      }
      look.push(line);
      end = cursor;
    }

    const blob = [name, ...look].join(" · ");
    const hasPrice = /(?:₺|\btl\b|\beur\b|\busd\b|€|\$|\d+[.,]\d{2})/i.test(blob);
    const size = findSizeInText(blob);
    if (!hasPrice || !size) {
      continue;
    }

    cards.push({
      text: blob.slice(0, 4_000),
      brand: String(retailer || "").slice(0, 120),
      productName: name.slice(0, 240),
      purchasedSize: size,
      productLinks: [],
      imageAlt: "",
      imageUrl: "",
      images: []
    });
    for (let mark = index; mark <= end; mark += 1) {
      used.add(mark);
    }
  }

  return cards;
}
