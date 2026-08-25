const DEFAULT_SUPABASE_URL = "https://wouetdktjqvusvsxgsyk.supabase.co";

function readEnv(name) {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
      const value = Deno.env.get(name);
      if (value) {
        return value;
      }
    }
  } catch {
    // Deno.env can throw when the permission is not granted.
  }
  try {
    if (typeof process !== "undefined" && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch {
    // ignore
  }
  return "";
}

export function supabaseUrl() {
  return (readEnv("SUPABASE_URL") || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
}

export function supabaseAnonKey() {
  return readEnv("SUPABASE_ANON_KEY") || readEnv("SUPABASE_PUBLISHABLE_KEY");
}

export function supabaseServiceRoleKey() {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("SUPABASE_SECRET_KEY");
}

export function supabaseProjectRef() {
  try {
    return new URL(supabaseUrl()).hostname.split(".")[0];
  } catch {
    return "";
  }
}

export function getSupabaseKey() {
  return supabaseServiceRoleKey() || supabaseAnonKey();
}

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl() && getSupabaseKey());
}

export function isServiceRoleConfigured() {
  const key = supabaseServiceRoleKey();
  if (!key) {
    return false;
  }
  if (key.startsWith("sb_secret_")) {
    return true;
  }
  try {
    const part = key.split(".")[1];
    if (!part) {
      return true;
    }
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (part.length % 4)) % 4);
    const json = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(part, "base64url").toString();
    return JSON.parse(json).role === "service_role";
  } catch {
    return true;
  }
}

export const SUPABASE_URL = DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = "";
export const SUPABASE_SERVICE_ROLE_KEY = "";
