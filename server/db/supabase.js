import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

export function nowIso() {
  return new Date().toISOString();
}

export function requireSupabase() {
  if (!supabase) {
    const missing = [
      !supabaseUrl && "SUPABASE_URL",
      !supabaseServiceKey && "SUPABASE_SERVICE_KEY"
    ].filter(Boolean);
    throw new Error(`Supabase no esta configurado. Faltan: ${missing.join(", ")}.`);
  }
  return supabase;
}

export function assertNoError(error, context = "Operacion Supabase") {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export async function insertLog(source, status, message, payload = null) {
  if (!supabase) return;
  const { error } = await supabase.from("sync_logs").insert({
    source,
    status,
    message,
    payload,
    created_at: nowIso()
  });
  if (error) console.error(`[sync_logs] ${error.message}`);
}

export async function getSetting(key) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  assertNoError(error, `Leer setting ${key}`);
  return data?.value ?? null;
}

export async function setSetting(key, value) {
  const client = requireSupabase();
  const { error } = await client
    .from("app_settings")
    .upsert({ key, value, updated_at: nowIso() }, { onConflict: "key" });
  assertNoError(error, `Guardar setting ${key}`);
}

export async function getAdminPassword() {
  const stored = await getSetting("admin_password").catch(() => null);
  return stored || process.env.ADMIN_PASSWORD || null;
}
