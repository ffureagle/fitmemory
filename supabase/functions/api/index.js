import { createApp } from "./app.js";
import { createSupabaseStore } from "./store-supabase.js";
import {
  supabaseUrl,
  getSupabaseKey,
  isServiceRoleConfigured
} from "./config.js";

const url = supabaseUrl();
const key = getSupabaseKey();
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is missing in the Edge Function environment.");
}

const store = createSupabaseStore(url, key, {
  canAdmin: isServiceRoleConfigured() || Boolean(key)
});
const app = await createApp({
  store,
  usingSupabase: true,
  supabaseUrl: url
});

function rewrite(request) {
  const next = new URL(request.url);
  const prefixes = ["/functions/v1/api"];
  for (const prefix of prefixes) {
    if (next.pathname === prefix) {
      next.pathname = "/";
    } else if (next.pathname.startsWith(`${prefix}/`)) {
      next.pathname = next.pathname.slice(prefix.length) || "/";
    }
  }
  return new Request(next.toString(), request);
}

Deno.serve((request) => app.fetch(rewrite(request)));
