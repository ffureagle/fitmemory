import assert from "node:assert/strict";
import test from "node:test";

import {
  SCAN_TIMEOUT_MS,
  canTransitionScanStage,
  isCurrentScanResponse,
} from "../src/scanLifecycle.ts";
import {
  agentResultToSnapshot,
  hasVerifiedNumericChart,
} from "../src/scanValidation.ts";

const product = {
  url: "https://www.zara.com/tr/tr/example.html?v1=1",
  brand: "Zara",
  name: "Boxy fit t-shirt",
  category: "Tişört",
  price: "",
  imageUrl: "",
  productReference: "",
  fitLabel: "Boxy fit",
  fitEvidence: "",
  description: "",
  materialSummary: "",
  materialEvidence: "",
  modelHeightCm: null,
  modelWornSize: "",
  modelEvidence: "",
};

function snapshot(headers, rows) {
  return {
    product,
    sizeChart: {
      found: true,
      title: "Ölçüler",
      unit: "Centimeters",
      headers,
      rows: rows.map((cells) => ({ cells })),
      rawText: "",
    },
    capturedAt: new Date(0).toISOString(),
  };
}

function agent(overrides = {}) {
  return {
    requestId: "scan-1",
    url: product.url,
    brand: "Zara",
    productName: product.name,
    availableSizes: ["S"],
    unavailableSizes: [],
    sizeChartUrl: "",
    sizeTable: [{ size: "S", measurements: { Göğüs: "54.5" } }],
    fitDescription: "Boxy fit",
    confidence: 0.9,
    source: "DOM",
    notes: [],
    extractionTimeMs: 100,
    extractionStatusCode: 100,
    ...overrides,
  };
}

test("verified chart requires a size label and product measurement", () => {
  assert.equal(hasVerifiedNumericChart(snapshot(["Beden", "Göğüs"], [["S", "54.5"]])), true);
  assert.equal(hasVerifiedNumericChart(snapshot(["Beden", "Fiyat"], [["S", "1590"]])), false);
  assert.equal(hasVerifiedNumericChart(snapshot(["Beden", "Model boyu"], [["S", "189"]])), false);
});

test("agent normalization rejects metadata-only rows", () => {
  assert.equal(agentResultToSnapshot(agent(), product)?.sizeChart.rows[0]?.cells[0], "S");
  assert.equal(agentResultToSnapshot(agent({ sizeTable: [{ size: "S", measurements: { Fiyat: "1590" } }] }), product), null);
});

test("agent metadata is merged without replacing verified fallback with blanks", () => {
  const result = agentResultToSnapshot(agent({
    productMetadata: {
      reference: "06224/308",
      price: "1590",
      currency: "TRY",
      color: "Beyaz",
      material: "%100 pamuk",
      imageUrl: "https://static.zara.net/image.jpg",
    },
  }), product);
  assert.equal(result?.product.productReference, "06224/308");
  assert.equal(result?.product.price, "1590 TRY");
  assert.equal(result?.product.materialSummary, "%100 pamuk");
});

test("stale scan id, request id, and URL are rejected", () => {
  const active = { scanId: "scan-1", url: `${product.url}#drawer` };
  assert.equal(isCurrentScanResponse(active, "scan-1", product.url, "scan-1"), true);
  assert.equal(isCurrentScanResponse(active, "scan-2", product.url, "scan-2"), false);
  assert.equal(isCurrentScanResponse(active, "scan-1", product.url, "old-request"), false);
  assert.equal(isCurrentScanResponse(active, "scan-1", "https://www.zara.com/tr/tr/other.html", "scan-1"), false);
});

test("scan timeout and stage transitions cover the server fallback chain", () => {
  assert.equal(SCAN_TIMEOUT_MS, 200_000);
  assert.equal(canTransitionScanStage("webview", "server-agent"), true);
  assert.equal(canTransitionScanStage("server-agent", "native-ocr"), true);
  assert.equal(canTransitionScanStage("server-agent", "recommending"), true);
  assert.equal(canTransitionScanStage("completed", "vision"), false);
});
