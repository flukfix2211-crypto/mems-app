import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const DEVICE_ID = "env-monitor-1";
const DEVICE_TOKEN_SHA256 = "b7c2e741d18f7f833189817516cca16e5751556cf784110931aa96709da6ca27";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const token = request.headers.get("x-device-token") ?? "";
  if (!token || (await sha256Hex(token)) !== DEVICE_TOKEN_SHA256) {
    return jsonResponse({ error: "Unauthorized device" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const deviceId = String(payload.device_id ?? "");
  const temperatureC = Number(payload.temperature_c);
  const humidityPct = Number(payload.humidity_pct);

  if (deviceId !== DEVICE_ID) {
    return jsonResponse({ error: "Unknown device" }, 400);
  }
  if (!Number.isFinite(temperatureC) || temperatureC < -40 || temperatureC > 80) {
    return jsonResponse({ error: "Invalid temperature" }, 400);
  }
  if (!Number.isFinite(humidityPct) || humidityPct < 0 || humidityPct > 100) {
    return jsonResponse({ error: "Invalid humidity" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("environment_status").upsert({
    device_id: DEVICE_ID,
    temperature_c: Math.round(temperatureC * 10) / 10,
    humidity_pct: Math.round(humidityPct * 10) / 10,
    observed_at: new Date().toISOString(),
  }, { onConflict: "device_id" });

  if (error) {
    console.error("environment_status upsert failed", error.code);
    return jsonResponse({ error: "Write failed" }, 500);
  }

  return jsonResponse({ ok: true });
});
