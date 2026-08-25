import assert from "node:assert/strict";

const base = (process.env.API_BASE_URL || "http://127.0.0.1:43123").replace(/\/+$/, "");
const stamp = Date.now();

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

const health = await request("/health");
assert.equal(health.status, 200, `/health ${health.status}`);
assert.equal(health.json.status, "healthy");
assert.equal(health.json.service, "FitMemory.Api");

const registered = await request("/api/auth/register", {
  method: "POST",
  body: {
    displayName: "Furkan",
    email: `smoke-${stamp}@fitmemory.test`,
    password: "FitMemory!42",
  },
});
assert.equal(registered.status, 200, `register ${registered.status} ${JSON.stringify(registered.json)}`);
const { account, accessToken } = registered.json;
assert.ok(account?.userId?.length >= 8);
assert.ok(accessToken?.length >= 32);

const profile = await request(`/api/profiles/${account.userId}`, {
  method: "PUT",
  token: accessToken,
  body: {
    age: 28,
    heightCm: 178,
    weightKg: 78,
    shoulderWidthCm: 110,
    chestCircumferenceCm: 105,
    waistCircumferenceCm: 85,
    footLengthCm: 28,
    usualShoeSizeEu: 44,
    fitPreference: "TrueToSize",
  },
});
assert.equal(profile.status, 200, `profile ${profile.status} ${JSON.stringify(profile.json)}`);
assert.equal(Number(profile.json.waistCircumferenceCm), 85);

const analyze = await request("/api/recommendations/analyze", {
  method: "POST",
  token: accessToken,
  body: {
    userId: account.userId,
    product: {
      url: `http://127.0.0.1:8199/jean-${stamp}.html`,
      brand: "Pull&Bear",
      name: "Straight jean",
      category: "Jeans",
      fitLabel: "Straight Fit",
      description: "Straight fit denim",
    },
    sizeChart: {
      found: true,
      title: "Ürün ölçüleri",
      unit: "Centimeters",
      headers: ["Beden", "Bel"],
      rows: [
        { cells: ["34", "36"] },
        { cells: ["36", "38"] },
        { cells: ["38", "40"] },
        { cells: ["40", "42"] },
        { cells: ["42", "43"] },
        { cells: ["44", "45"] },
        { cells: ["46", "47"] },
      ],
      rawText: "Beden 34 36 38 40 42 44 46",
    },
  },
});
assert.equal(analyze.status, 200, `analyze ${analyze.status} ${JSON.stringify(analyze.json)}`);
assert.equal(analyze.json.recommendedSize, "42", `beklenen 42, gelen ${analyze.json.recommendedSize}`);
assert.equal(/Hedef\s+\d/.test(analyze.json.explanation || ""), false);
assert.equal(/Kategori koruması aktif/.test(analyze.json.explanation || ""), false);

const narrow = await request("/api/recommendations/analyze", {
  method: "POST",
  token: accessToken,
  body: {
    userId: account.userId,
    product: {
      url: `http://127.0.0.1:8199/jean-narrow-${stamp}.html`,
      brand: "Pull&Bear",
      name: "Straight jean",
      category: "Jeans",
      fitLabel: "Straight Fit",
      description: "Straight fit denim",
    },
    sizeChart: {
      found: true,
      title: "Ürün ölçüleri",
      unit: "Centimeters",
      headers: ["Beden", "Bel"],
      rows: [{ cells: ["34", "36"] }],
      rawText: "Beden 34 36 38 40 42 44 46 Bel 36",
    },
  },
});
assert.equal(narrow.status, 200, `narrow ${narrow.status} ${JSON.stringify(narrow.json)}`);
assert.equal(narrow.json.recommendedSize, "42", `dar satırda beklenen 42, gelen ${narrow.json.recommendedSize}`);
assert.notEqual(narrow.json.recommendedSize, "34");

const saved = await request("/api/orders", {
  method: "POST",
  token: accessToken,
  body: {
    userId: account.userId,
    brand: "Pull&Bear",
    productName: "Straight jean",
    category: "Jeans",
    purchasedSize: "34",
    outcome: "KeptGoodFit",
    fitLabel: "Straight Fit",
    productUrl: `http://127.0.0.1:8199/jean-old-${stamp}.html`,
  },
});
assert.equal(saved.status, 201, `order ${saved.status} ${JSON.stringify(saved.json)}`);

const afterHistory = await request("/api/recommendations/analyze", {
  method: "POST",
  token: accessToken,
  body: {
    userId: account.userId,
    product: {
      url: `http://127.0.0.1:8199/jean-new-${stamp}.html`,
      brand: "Pull&Bear",
      name: "Straight jean",
      category: "Jeans",
      fitLabel: "Straight Fit",
      description: "Straight fit denim",
    },
    sizeChart: {
      found: true,
      title: "Ürün ölçüleri",
      unit: "Centimeters",
      headers: ["Beden", "Bel"],
      rows: [{ cells: ["34", "36"] }],
      rawText: "Beden 34 36 38 40 42 44 46 Bel 36",
    },
  },
});
assert.equal(afterHistory.status, 200, `history ${afterHistory.status} ${JSON.stringify(afterHistory.json)}`);
assert.equal(
  afterHistory.json.recommendedSize,
  "42",
  `eski 34 dolap kilidi olmamalı, gelen ${afterHistory.json.recommendedSize}`,
);
assert.notEqual(afterHistory.json.dataSource, "local-category-history");

console.log(
  "smoke-api ok",
  analyze.json.recommendedSize,
  narrow.json.recommendedSize,
  afterHistory.json.recommendedSize,
  afterHistory.json.dataSource,
);
