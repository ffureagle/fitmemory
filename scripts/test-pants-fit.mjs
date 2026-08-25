import assert from "node:assert/strict";
import { analyzeRecommendation } from "../extension/engine.js";

const profile = {
  age: 28,
  heightCm: 178,
  weightKg: 78,
  shoulderWidthCm: 110,
  chestCircumferenceCm: 105,
  waistCircumferenceCm: 85,
  footLengthCm: 28,
  usualShoeSizeEu: 44,
  fitPreference: "TrueToSize",
};

const product = {
  name: "Straight jean",
  brand: "Pull&Bear",
  category: "Jeans",
  fitLabel: "Straight Fit",
  fitEvidence: "Straight Fit",
};

const onlyNarrowRow = analyzeRecommendation(profile, [], {
  product,
  sizeChart: {
    found: true,
    title: "Ürün ölçüleri",
    unit: "Centimeters",
    headers: ["Beden", "Bel"],
    rows: [{ cells: ["34", "36"] }],
    rawText: "Beden 34 36 38 40 42 44 46 Bel 36",
  },
});

assert.notEqual(onlyNarrowRow.recommendedSize, "34", `34 bele oturmaz, gelen ${onlyNarrowRow.recommendedSize}`);
assert.equal(onlyNarrowRow.recommendedSize, "42", `beklenen 42, gelen ${onlyNarrowRow.recommendedSize}`);
assert.equal(/Hedef\s+\d/.test(onlyNarrowRow.explanation), false, "teknik Hedef metni olmamalı");

const fullChart = analyzeRecommendation(profile, [], {
  product,
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
    rawText: "",
  },
});

assert.equal(fullChart.recommendedSize, "42", `tam tabloda beklenen 42, gelen ${fullChart.recommendedSize}`);
assert.equal(/Hedef\s+\d/.test(fullChart.explanation), false);

console.log("pants fit ok", onlyNarrowRow.recommendedSize, fullChart.recommendedSize);
