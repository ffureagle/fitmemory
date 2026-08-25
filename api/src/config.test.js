import test from "node:test";
import assert from "node:assert/strict";
import { supabaseProjectRef, supabaseUrl, isSupabaseConfigured } from "./config.js";

test("defaults to the hosted FitMemory Supabase project", () => {
  assert.equal(supabaseUrl(), "https://wouetdktjqvusvsxgsyk.supabase.co");
  assert.equal(supabaseProjectRef(), "wouetdktjqvusvsxgsyk");
});

test("does not claim Supabase is configured without a key", () => {
  assert.equal(isSupabaseConfigured(), false);
});
