import { serve } from "@hono/node-server";
import { loadEnv } from "./load-env.js";

loadEnv();

const { createApp } = await import("./app.js");
const { createSqliteStore } = await import("./store-sqlite.js");
const { createSupabaseStore } = await import("./store-supabase.js");
const {
  supabaseUrl,
  getSupabaseKey,
  isServiceRoleConfigured,
  isSupabaseConfigured,
  supabaseProjectRef
} = await import("./config.js");

const usingSupabase = isSupabaseConfigured();
const store = usingSupabase
  ? createSupabaseStore(supabaseUrl(), getSupabaseKey(), {
      canAdmin: isServiceRoleConfigured()
    })
  : createSqliteStore();

const port = Number(process.env.PORT || 8788);
const app = await createApp({
  store,
  usingSupabase,
  supabaseUrl: supabaseUrl()
});

serve({
  fetch: app.fetch,
  hostname: "::",
  port
}, (info) => {
  const project = supabaseProjectRef();
  const mode = usingSupabase ? `Supabase ${project}` : "SQLite (Supabase anahtarı bekleniyor)";
  const host = info.address || "::";
  console.log(`FitMemory API listening on http://[::]:${info.port} and http://127.0.0.1:${info.port} · ${mode}`);
  console.log(`Proje: ${supabaseUrl()}`);
});
