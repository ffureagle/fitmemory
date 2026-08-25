import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadScannerBootstrap() {
  const source = readFileSync(join(root, "mobile-expo-go/src/injectedScanner.ts"), "utf8");
  const match = source.match(/const scannerBootstrap = String\.raw`\n([\s\S]*?)`;\n\nexport function createScanScript/);
  assert.ok(match, "scanner bootstrap bulunamadı");
  return match[1];
}

function profileForServerSync(profile) {
  const inRange = (value, min, max) =>
    value != null && Number.isFinite(value) && value >= min && value <= max ? value : null;
  return {
    ...profile,
    chestCircumferenceCm: inRange(profile.chestCircumferenceCm, 60, 180),
    footLengthCm: inRange(profile.footLengthCm, 15, 40),
    usualShoeSizeEu: inRange(profile.usualShoeSizeEu, 20, 55),
  };
}

const synced = profileForServerSync({
  age: 28,
  heightCm: 178,
  weightKg: 78,
  shoulderWidthCm: 110,
  chestCircumferenceCm: 105,
  waistCircumferenceCm: 85,
  footLengthCm: 28,
  usualShoeSizeEu: 449,
  fitPreference: "TrueToSize",
});
assert.equal(synced.usualShoeSizeEu, null, "geçersiz EU sunucuya gitmemeli");
assert.equal(synced.chestCircumferenceCm, 105);
assert.equal(synced.footLengthCm, 28);

async function loadPuppeteer() {
  const vendor = "/tmp/fitmemory-puppeteer";
  mkdirSync(vendor, { recursive: true });
  try {
    return (await import(pathToFileURL(join(vendor, "node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js")).href)).default;
  } catch {
    execSync("npm init -y && npm install puppeteer-core@24.34.0", {
      cwd: vendor,
      stdio: "inherit",
    });
    return (await import(pathToFileURL(join(vendor, "node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js")).href)).default;
  }
}

const chromePath = [
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
].find((path) => {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
});
assert.ok(chromePath, "Chrome bulunamadı");

const fixture = readFileSync(join(root, "demo/bershka-olculer.html"));
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const pageUrl = `http://127.0.0.1:${port}/`;

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });

  const before = await page.evaluate(() => ({
    sizes: [...document.querySelectorAll(".sizes button")].map((button) => button.textContent.trim()),
    chest: document.querySelector('[data-metric="chest"]')?.textContent,
    selected: document.querySelector('.sizes button[aria-checked="true"]')?.textContent || "",
  }));
  assert.deepEqual(before.sizes, ["XS", "S", "M", "L", "XL"]);
  assert.equal(before.chest, "-");
  assert.equal(before.selected, "");

  const posted = await page.evaluate(async (bootstrap) => {
    eval(bootstrap);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("scan timeout")), 40000);
      window.ReactNativeWebView = {
        postMessage(raw) {
          try {
            const payload = JSON.parse(raw);
            if (payload.type === "fitmemory-progress") return;
            clearTimeout(timer);
            resolve(payload);
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        },
      };
      window.__fitmemoryScan("product", true).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }, loadScannerBootstrap());

  assert.equal(
    posted.type,
    "fitmemory-product",
    `scan type ${posted.type}: ${posted.message || posted.snapshot?.reason || ""}`,
  );
  const rows = posted.snapshot?.sizeChart?.rows || [];
  assert.ok(
    rows.length >= 5,
    `beden satırları yetersiz: ${rows.length}\n${JSON.stringify(posted.snapshot?.sizeChart, null, 2).slice(0, 4000)}`,
  );
  assert.deepEqual(rows.map((row) => row.cells?.[0]), ["XS", "S", "M", "L", "XL"]);
  assert.ok(
    rows.every((row) => row.cells.slice(1).some((cell) => /^\d{2,3}$/.test(String(cell)))),
    "her bedende sayısal ölçü olmalı",
  );
  console.log("bershka scan ok", rows.length, "beden");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
