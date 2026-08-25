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

const result = analyzeRecommendation(profile, [], {
  product: {
    name: "Kutulu kesim tişört",
    brand: "Bershka",
    category: "Tees",
    fitLabel: "",
    fitEvidence: "",
  },
  sizeChart: {
    found: true,
    title: "Ürün ölçüleri",
    unit: "Centimeters",
    headers: ["Beden", "Göğüs çevresi", "Kalça çevresi"],
    rows: [
      { cells: ["XS", "87", "87"] },
      { cells: ["S", "93", "93"] },
      { cells: ["M", "99", "99"] },
      { cells: ["L", "105", "105"] },
      { cells: ["XL", "111", "111"] },
    ],
    rawText: "",
  },
});

assert.equal(result.recommendedSize, "L", `beklenen L, gelen ${result.recommendedSize}`);
assert.ok(result.confidence > 30, "güven skoru üretildi");
assert.notEqual(result.recommendedSize, "Bilinmiyor");
console.log("local fit ok", result.recommendedSize, result.confidence);
