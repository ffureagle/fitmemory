import type { ScanStage } from "./types";

export const SCAN_TIMEOUT_MS = 200_000;

export type ActiveScanIdentity = {
  scanId: string;
  url: string;
};

export function normalizeScanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    console.warn("Scan URL could not be normalized", error);
    return url.split("#")[0] ?? url;
  }
}

export function isCurrentScanResponse(
  active: ActiveScanIdentity | null,
  scanId: string,
  productUrl: string,
  responseRequestId?: string,
): boolean {
  if (!active || active.scanId !== scanId) return false;
  if (responseRequestId && responseRequestId !== scanId) return false;
  return normalizeScanUrl(active.url) === normalizeScanUrl(productUrl);
}

const transitions: Record<ScanStage, readonly ScanStage[]> = {
  idle: ["warming-api", "webview"],
  "warming-api": ["webview", "server-agent", "failed"],
  webview: ["warming-api", "server-agent", "native-ocr", "vision", "recommending", "failed"],
  "server-agent": ["native-ocr", "vision", "recommending", "failed"],
  "native-ocr": ["vision", "recommending", "failed"],
  vision: ["recommending", "failed"],
  recommending: ["completed", "failed"],
  completed: ["idle", "webview", "warming-api"],
  failed: ["idle", "webview", "warming-api"],
};

export function canTransitionScanStage(from: ScanStage, to: ScanStage): boolean {
  return from === to || transitions[from].includes(to);
}
