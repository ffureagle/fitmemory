import { NativeModules, Platform } from "react-native";
import type { ProductSnapshot, SizeChart } from "./types";

type OcrLine = { text: string; left?: number; top?: number; right?: number; bottom?: number };
type NativeScannerModule = {
  recognizeBase64(value: string): Promise<{ text: string; lines: OcrLine[] }>;
  accessibilitySnapshot(): Promise<{ enabled: boolean; text: string }>;
  openMeasurementPanel(): Promise<boolean>;
  sizeOptions(): Promise<string[]>;
  selectSize(value: string): Promise<boolean>;
  openAccessibilitySettings(): void;
};

const nativeScanner = NativeModules.FitMemoryScanner as NativeScannerModule | undefined;

export const scannerCapabilities = {
  accessibility: Platform.OS === "android" && Boolean(nativeScanner),
  onDeviceOcr: (Platform.OS === "android" || Platform.OS === "ios") && Boolean(nativeScanner),
};

export async function nativeAccessibilityEnabled() {
  if (!nativeScanner || Platform.OS !== "android") return null;
  const result = await nativeScanner.accessibilitySnapshot().catch(() => null);
  return result?.enabled ?? false;
}

export function openNativeAccessibilitySettings() {
  if (!nativeScanner || Platform.OS !== "android") return false;
  nativeScanner.openAccessibilitySettings();
  return true;
}

export async function prepareNativeMeasurementPanel() {
  if (!nativeScanner || Platform.OS !== "android") return false;
  return nativeScanner.openMeasurementPanel().catch(() => false);
}

export async function nativeSizeOptions() {
  if (!nativeScanner || Platform.OS !== "android") return [];
  return nativeScanner.sizeOptions().catch(() => []);
}

export async function selectNativeSize(value: string) {
  if (!nativeScanner || Platform.OS !== "android") return false;
  return nativeScanner.selectSize(value).catch(() => false);
}

export async function collectNativeScanEvidence(imageDataUrl: string) {
  if (!nativeScanner || (Platform.OS !== "android" && Platform.OS !== "ios")) {
    return { accessibilityEnabled: false, accessibilityText: "", ocrText: "", ocrLines: [] as OcrLine[] };
  }
  const [accessibility, ocr] = await Promise.all([
    nativeScanner.accessibilitySnapshot().catch(() => ({ enabled: false, text: "" })),
    nativeScanner.recognizeBase64(imageDataUrl).catch(() => ({ text: "", lines: [] as OcrLine[] })),
  ]);
  return {
    accessibilityEnabled: accessibility.enabled,
    accessibilityText: accessibility.text,
    ocrText: ocr.text,
    ocrLines: ocr.lines,
  };
}

const fold = (value: string) => value
  .toLocaleLowerCase("tr-TR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ı/g, "i")
  .replace(/ş/g, "s")
  .replace(/ğ/g, "g")
  .replace(/ç/g, "c")
  .replace(/ö/g, "o")
  .replace(/ü/g, "u");

const metricNames: Array<[RegExp, string]> = [
  [/gogus|chest|bust/, "Göğüs"],
  [/omuz|shoulder/, "Omuz"],
  [/bel|waist/, "Bel"],
  [/kalca|basen|hip/, "Kalça"],
  [/on uzunluk|front length/, "Ön uzunluk"],
  [/kol|sleeve/, "Kol uzunluğu"],
  [/ic bacak|inseam/, "İç bacak"],
  [/uzunluk|length/, "Uzunluk"],
];

export function chartFromRecognizedText(
  ocrText: string,
  accessibilityText: string,
  lines: OcrLine[],
): SizeChart | null {
  const combined = `${accessibilityText}\n${ocrText}`;
  const folded = fold(combined);
  if (!/(olculer|beden kilavuzu|size guide|measurements?|gogus|chest|bel|waist)/.test(folded)) return null;
  const selected = combined.match(/\[selected\]\s*(XXXL|XXL|XL|L|M|S|XS|XXS|\d{2,3})\b/i)?.[1]?.toUpperCase();
  const sizeCandidates = [...combined.matchAll(/(?:^|\s)(XXXL|XXL|XL|L|M|S|XS|XXS|\d{2,3})(?=\s|$)/gim)]
    .map((match) => match[1]?.toUpperCase())
    .filter((value): value is string => Boolean(value));
  const size = selected || sizeCandidates.find((value) => /^(?:XXXL|XXL|XL|L|M|S|XS|XXS|3[0-9]|4[0-9]|5[0-4])$/.test(value));
  if (!size) return null;

  const values: Array<[string, string]> = [];
  for (const rawLine of [...lines.map((line) => line.text), ...combined.split(/\r?\n/)]) {
    const normalized = fold(rawLine);
    const metric = metricNames.find(([pattern]) => pattern.test(normalized));
    const number = rawLine.match(/\b(\d{1,3}(?:[.,]\d+)?)\b/)?.[1]?.replace(",", ".");
    if (metric && number && !values.some(([name]) => name === metric[1])) values.push([metric[1], number]);
  }
  for (const metricLine of lines) {
    const metric = metricNames.find(([pattern]) => pattern.test(fold(metricLine.text)));
    if (!metric || values.some(([name]) => name === metric[1])) continue;
    const centerY = ((metricLine.top ?? 0) + (metricLine.bottom ?? metricLine.top ?? 0)) / 2;
    const numeric = lines
      .filter((line) => /^\s*\d{1,3}(?:[.,]\d+)?\s*$/.test(line.text))
      .map((line) => ({
        line,
        distance: Math.abs((((line.top ?? 0) + (line.bottom ?? line.top ?? 0)) / 2) - centerY),
      }))
      .filter(({ line, distance }) => distance <= 36 && (line.left ?? 0) >= (metricLine.left ?? 0))
      .sort((left, right) => left.distance - right.distance || (left.line.left ?? 0) - (right.line.left ?? 0))[0]?.line;
    const number = numeric?.text.match(/\d{1,3}(?:[.,]\d+)?/)?.[0].replace(",", ".");
    if (number) values.push([metric[1], number]);
  }
  if (!values.length) return null;
  return {
    found: true,
    title: "Cihazda okunan ürün ölçüleri",
    unit: /\bcm\b/i.test(combined) ? "Centimeters" : "Unknown",
    headers: ["Beden", ...values.map(([name]) => name)],
    rows: [{ cells: [size, ...values.map(([, value]) => value)] }],
    rawText: combined.slice(0, 12000),
  };
}

export function snapshotWithChart(
  product: ProductSnapshot["product"],
  chart: SizeChart,
): ProductSnapshot {
  return { product, sizeChart: chart, capturedAt: new Date().toISOString() };
}
