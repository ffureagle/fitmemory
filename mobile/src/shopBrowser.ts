import { Platform } from "react-native";

const shopHosts = [
  "pullandbear.com",
  "bershka.com",
  "zara.com",
  "inditex.com",
  "inditex.net",
  "itxassets.com",
];

const authHosts = [
  "accounts.google.com",
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googleusercontent.com",
  "recaptcha.net",
  "g.co",
  "appleid.apple.com",
  "apple.com",
  "icloud.com",
  "facebook.com",
  "fb.com",
  "fbcdn.net",
  "instagram.com",
  "accountkit.com",
  "login.microsoftonline.com",
  "live.com",
  "microsoftonline.com",
  "microsoft.com",
  "okta.com",
  "auth0.com",
];

export const shopUserAgent = Platform.select({
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  default:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.186 Mobile Safari/537.36",
}) as string;

function hostMatches(hostname: string, domain: string) {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function isAllowedShopUrl(value: string) {
  if (!value) return false;
  if (
    value === "about:blank" ||
    value === "about:srcdoc" ||
    /^(about|intent|fitmemorygo|itms-apps|market):/i.test(value)
  ) {
    return true;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.replace(/^www\./, "");
    return (
      shopHosts.some((domain) => hostMatches(host, domain)) ||
      authHosts.some((domain) => hostMatches(host, domain))
    );
  } catch {
    return false;
  }
}

export function isShopStoreUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return shopHosts.some((domain) => hostMatches(host, domain));
  } catch {
    return false;
  }
}

export function isAuthPopupUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return authHosts.some((domain) => hostMatches(host, domain));
  } catch {
    return false;
  }
}

export function shouldCloseAuthWindow(value: string) {
  if (!value || value === "about:blank") return true;
  if (!isShopStoreUrl(value)) return false;
  return !/\/(login|signin|oauth|auth|account|identity)/i.test(value);
}
