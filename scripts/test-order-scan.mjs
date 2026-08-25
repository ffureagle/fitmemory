import { readFileSync } from "node:fs";
import {
  completeOrderFields,
  findProductNameInText,
  findSizeInText,
  harvestOrderBlocksFromText,
  isOrderHistorySurface
} from "../extension/order-parse.js";
import { localApiFetch } from "../extension/local-backend.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const jean = completeOrderFields({
  text: "Baggy jean · 1.790,00 TL · Beden 38 · Lacivert"
}, "Bershka");
assert(jean.brand === "Bershka", "jean brand");
assert(jean.productName.toLowerCase().includes("baggy jean"), `jean name: ${jean.productName}`);
assert(jean.purchasedSize === "38", `jean size: ${jean.purchasedSize}`);

const tee = completeOrderFields({
  text: "Muscle fit tişört · 490,00 TL · Beden S · Beyaz"
}, "Bershka");
assert(
  tee.productName.toLowerCase().includes("tişört") ||
    tee.productName.toLowerCase().includes("muscle"),
  `tee name: ${tee.productName}`
);
assert(tee.purchasedSize === "S", `tee size: ${tee.purchasedSize}`);

assert(findSizeInText("EU 40 / Beyaz") === "40", "labeled numeric size");
assert(
  findProductNameInText("1.790,00 TL · Baggy jean · Lacivert").toLowerCase().includes("baggy"),
  "name from blob"
);

const skipped = completeOrderFields({ text: "Kargo takip" }, "");
assert(!skipped.productName || !skipped.purchasedSize, "incomplete cards stay skipped");

const demoHtml = readFileSync(new URL("../demo/orders.html", import.meta.url), "utf8");
const articles = [...demoHtml.matchAll(/<article[\s\S]*?<\/article>/gi)].map((match) =>
  match[0].replace(/<[^>]+>/g, " ")
);
assert(articles.length === 2, `demo articles ${articles.length}`);
const demoJean = completeOrderFields({ text: articles[0] }, "Bershka");
const demoTee = completeOrderFields({ text: articles[1] }, "Bershka");
assert(demoJean.purchasedSize === "38", `demo jean size: ${demoJean.purchasedSize}`);
assert(/baggy jean/i.test(demoJean.productName), `demo jean name: ${demoJean.productName}`);
assert(demoTee.purchasedSize === "S", `demo tee size: ${demoTee.purchasedSize}`);
assert(/tişört|muscle/i.test(demoTee.productName), `demo tee name: ${demoTee.productName}`);

const summarySurface = isOrderHistorySurface({
  hostname: "www.pullandbear.com",
  pathname: "/tr/checkout/summary",
  title: "Alışveriş özeti",
  headings: "Alışveriş özeti",
  bodyText: "STWD grafitili t-shirt\nTeslim edildi\n18.05.2026"
});
assert(summarySurface, "alışveriş özeti counts as an order surface");

const summaryText = `Alışveriş özeti
STWD grafitili t-shirt
920.00 TL
1
M
Siyah
İşlemeli STWD şişme mont
1.190,00 TL
1
M
Siyah
Teslim edildi
18.05.2026
2.110,00 TL
89,00 TL
2.199,00 TL`;
const harvested = harvestOrderBlocksFromText(summaryText, "Pull&Bear");
assert(harvested.length === 2, `summary harvest count ${harvested.length} ${JSON.stringify(harvested)}`);
assert(/t-shirt/i.test(harvested[0].productName), `tee harvest name: ${harvested[0].productName}`);
assert(harvested[0].purchasedSize === "M", `tee harvest size: ${harvested[0].purchasedSize}`);
assert(/mont/i.test(harvested[1].productName), `coat harvest name: ${harvested[1].productName}`);
assert(harvested[1].purchasedSize === "M", `coat harvest size: ${harvested[1].purchasedSize}`);

const summaryHtml = readFileSync(new URL("../demo/order-summary.html", import.meta.url), "utf8");
const summaryPlain = summaryHtml
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, "\n")
  .replace(/&amp;/g, "&");
const htmlHarvest = harvestOrderBlocksFromText(summaryPlain, "Pull&Bear");
assert(htmlHarvest.length === 2, `html harvest count ${htmlHarvest.length}`);
assert(htmlHarvest.every((card) => card.purchasedSize === "M"), "html harvest sizes");

const contentSource = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
assert(contentSource.includes("alışveriş.?özet"), "content script trained on alışveriş özeti");
assert(contentSource.includes("harvestOrderBlocksFromPageText"), "content script has text harvest");
const backgroundSource = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
assert(backgroundSource.includes("listTabFrameIds"), "order scan walks frames");
assert(backgroundSource.includes("mergeOrderHistories"), "order scan merges iframe cards");

const session = await localApiFetch("/api/auth/register", {
  method: "POST",
  body: {
    displayName: "Furkan",
    email: `tara-scan-${Date.now()}@test.local`,
    password: "Fitmemory1"
  }
});
await localApiFetch(`/api/profiles/${session.account.userId}`, {
  method: "PUT",
  accessToken: session.accessToken,
  body: {
    userId: session.account.userId,
    age: 28,
    heightCm: 178,
    weightKg: 74,
    shoulderWidthCm: 44,
    waistCircumferenceCm: 82,
    fitPreference: "TrueToSize"
  }
});

const imported = await localApiFetch("/api/order-imports/analyze", {
  method: "POST",
  accessToken: session.accessToken,
  body: {
    userId: session.account.userId,
    pageUrl: "https://www.bershka.com/tr/user/orders",
    retailer: "Bershka",
    orderCards: [
      { text: "Baggy jean · 1.790,00 TL · Beden 38 · Lacivert" },
      { text: "Muscle fit tişört · 490,00 TL · Beden S · Beyaz" }
    ]
  }
});

assert(imported.importedCount === 2, `importedCount ${imported.importedCount}`);
assert(imported.orders.some((order) => order.purchasedSize === "38"), "jean landed in closet");
assert(imported.orders.some((order) => order.purchasedSize === "S"), "tee landed in closet");

const summaryImported = await localApiFetch("/api/order-imports/analyze", {
  method: "POST",
  accessToken: session.accessToken,
  body: {
    userId: session.account.userId,
    pageUrl: "https://www.pullandbear.com/tr/checkout/summary",
    retailer: "Pull&Bear",
    orderCards: harvested
  }
});
assert(summaryImported.importedCount === 2, `summary importedCount ${summaryImported.importedCount}`);
assert(
  summaryImported.orders.some((order) => /t-shirt/i.test(order.productName || "")),
  "summary tee landed in closet"
);
assert(
  summaryImported.orders.some((order) => /mont/i.test(order.productName || "")),
  "summary coat landed in closet"
);

console.log("order-scan tests passed");
