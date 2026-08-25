import type { ProductAgentResult, ProductSnapshot } from "./types";

const sizePattern = /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|(?:2[0-9]|[3-5][0-9]|60)(?:[/-](?:2[0-9]|[3-5][0-9]|60))?)$/i;
const metricPattern = /göğüs|gogus|chest|bust|çevre|cevre|circum|omuz|shoulder|bel|waist|kalça|kalca|basen|hip|uzunluk|length|kol|sleeve|sırt|sirt|back width|inseam|uyluk|thigh|paça|paca|rise/i;
const rejectedPattern = /fiyat|price|sku|ref|stok|stock|model|boyu|height|indirim|discount|adet|quantity|puan|rating/i;

export function hasVerifiedNumericChart(snapshot: ProductSnapshot): boolean {
  const { product, sizeChart } = snapshot;
  if (!product.name.trim() || !product.brand.trim() || !sizeChart.found || sizeChart.rows.length === 0) return false;
  return sizeChart.rows.some((row) => sizePattern.test(String(row.cells[0] ?? "").trim()) &&
    row.cells.slice(1).some((cell, index) => {
      const header = String(sizeChart.headers[index + 1] ?? "");
      return metricPattern.test(header) && !rejectedPattern.test(header) && /\d{1,3}(?:[.,]\d+)?/.test(String(cell ?? ""));
    }));
}

export function listedSizeLabels(snapshot: ProductSnapshot): string[] {
  const fromChart = (snapshot.sizeChart.availableSizes || [])
    .map((label) => String(label).trim().toUpperCase())
    .filter((label) => sizePattern.test(label));
  if (fromChart.length >= 2) return [...new Set(fromChart)];
  const fromText = String(snapshot.sizeChart.rawText || "").match(
    /\b(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL)\b/gi,
  ) || [];
  return [...new Set(fromText.map((label) => label.toUpperCase()))];
}

export function isIncompleteWalkedChart(snapshot: ProductSnapshot): boolean {
  const measured = [...new Set(
    snapshot.sizeChart.rows
      .map((row) => String(row.cells[0] ?? "").trim().toUpperCase())
      .filter((label) => sizePattern.test(label)),
  )];
  const listed = listedSizeLabels(snapshot);
  return listed.length >= 2 && measured.length < 2;
}

export function agentResultToSnapshot(agent: ProductAgentResult, fallback: ProductSnapshot["product"]): ProductSnapshot | null {
  const metadata = agent.productMetadata;
  const price = [metadata?.price, metadata?.currency].filter(Boolean).join(" ");
  const headers = ["Beden", ...Array.from(new Set(agent.sizeTable.flatMap((row) =>
    Object.keys(row.measurements).filter((key) => metricPattern.test(key) && !rejectedPattern.test(key)))))].slice(0, 12);
  const snapshot: ProductSnapshot = {
    product: { ...fallback, brand: agent.brand || fallback.brand, name: agent.productName || fallback.name,
      fitLabel: agent.fitDescription || fallback.fitLabel, price: price || fallback.price,
      imageUrl: metadata?.imageUrl || fallback.imageUrl,
      productReference: metadata?.reference || fallback.productReference,
      materialSummary: metadata?.material || fallback.materialSummary },
    sizeChart: { found: headers.length > 1, title: "Doğrulanmış sunucu ajanı ürün ölçüleri", unit: "Centimeters", headers,
      rows: agent.sizeTable.map((row) => ({ cells: [row.size, ...headers.slice(1).map((header) => row.measurements[header] ?? "")] })), rawText: "" },
    capturedAt: new Date().toISOString(),
  };
  return agent.requestId && hasVerifiedNumericChart(snapshot) ? snapshot : null;
}
