import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRecommendation, isVerifiedChart } from "./engine.js";

const chart = {
  found: true,
  title: "Beden tablosu",
  unit: "Centimeters",
  headers: ["Beden", "Göğüs eni (cm)", "Omuz (cm)", "Uzunluk (cm)"],
  rows: [
    { cells: ["XS", "48", "40", "68"] },
    { cells: ["S", "50", "42", "70"] },
    { cells: ["M", "53", "44", "72"] },
    { cells: ["L", "56", "46", "74"] },
    { cells: ["XL", "59", "48", "76"] }
  ],
  rawText: "Beden | Göğüs eni | Omuz | Uzunluk"
};

const product = {
  url: "http://127.0.0.1:8199/tee.html",
  brand: "Zara",
  name: "Heavyweight cotton tee",
  fitLabel: "Regular fit"
};

const profile = {
  age: 28,
  heightCm: 178,
  weightKg: 75,
  shoulderWidthCm: 45,
  chestCircumferenceCm: 106,
  waistCircumferenceCm: 86,
  fitPreference: "TrueToSize"
};

test("accepts a Turkish half-chest table", () => {
  assert.equal(isVerifiedChart(product, chart), true);
});

test("recommends a letter size instead of unknown", () => {
  const result = analyzeRecommendation(profile, [], { product, sizeChart: chart });
  assert.notEqual(String(result.recommendedSize).toLowerCase(), "bilinmiyor");
  assert.equal(result.recommendedSize, "L");
});

test("recommends from a brand chest-circumference table", () => {
  const circChart = {
    found: true,
    title: "Beden rehberi",
    unit: "Centimeters",
    headers: ["Beden", "Göğüs çevresi (cm)", "Bel çevresi (cm)"],
    rows: [
      { cells: ["S", "90", "74"] },
      { cells: ["M", "98", "82"] },
      { cells: ["L", "106", "90"] },
      { cells: ["XL", "114", "98"] }
    ],
    rawText: "Beden | Göğüs çevresi | Bel çevresi"
  };
  const result = analyzeRecommendation(profile, [], { product, sizeChart: circChart });
  assert.equal(result.recommendedSize, "L");
  assert.notEqual(result.dataSource, "local-insufficient");
});

test("treats a göğüs eni column of 90+ cm as circumference", () => {
  const mislabelled = {
    found: true,
    title: "Beden tablosu",
    unit: "Centimeters",
    headers: ["Beden", "Göğüs eni"],
    rows: [
      { cells: ["S", "92"] },
      { cells: ["M", "100"] },
      { cells: ["L", "108"] },
      { cells: ["XL", "116"] }
    ],
    rawText: "Beden | Göğüs eni"
  };
  const result = analyzeRecommendation(profile, [], { product, sizeChart: mislabelled });
  assert.notEqual(String(result.recommendedSize).toLowerCase(), "bilinmiyor");
  assert.equal(result.recommendedSize, "L");
});

test("converts a legacy shoulder width profile against a garment shoulder-width chart", () => {
  const result = analyzeRecommendation(profile, [], { product, sizeChart: chart });
  assert.equal(result.recommendedSize, "L");
});

test("uses a shoulder circumference profile against garment shoulder width", () => {
  const circProfile = { ...profile, shoulderWidthCm: 90 };
  const result = analyzeRecommendation(circProfile, [], { product, sizeChart: chart });
  assert.equal(result.recommendedSize, "L");
});

test("picks EU 42 for an 85 cm waist jean when only a narrow row is measured", () => {
  const jean = {
    name: "Straight jean",
    brand: "Pull&Bear",
    category: "Jeans",
    fitLabel: "Straight Fit"
  };
  const result = analyzeRecommendation(profile, [], {
    product: jean,
    sizeChart: {
      found: true,
      title: "Ürün ölçüleri",
      unit: "Centimeters",
      headers: ["Beden", "Bel"],
      rows: [{ cells: ["34", "36"] }],
      rawText: "Beden 34 36 38 40 42 44 46 Bel 36"
    }
  });
  assert.equal(result.recommendedSize, "42");
  assert.equal(/Hedef\s+\d/.test(result.explanation), false);
});

test("reads an omuz çevresi column as circumference", () => {
  const circShoulder = {
    found: true,
    title: "Beden tablosu",
    unit: "Centimeters",
    headers: ["Beden", "Göğüs eni (cm)", "Omuz çevresi (cm)", "Uzunluk (cm)"],
    rows: [
      { cells: ["XS", "48", "80", "68"] },
      { cells: ["S", "50", "84", "70"] },
      { cells: ["M", "53", "88", "72"] },
      { cells: ["L", "56", "90", "74"] },
      { cells: ["XL", "59", "96", "76"] }
    ],
    rawText: "Beden | Göğüs eni | Omuz çevresi | Uzunluk"
  };
  const circProfile = { ...profile, shoulderWidthCm: 90 };
  const result = analyzeRecommendation(circProfile, [], { product, sizeChart: circShoulder });
  assert.equal(result.recommendedSize, "L");
});
