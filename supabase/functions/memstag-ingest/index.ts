import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const DEVICE_ID = "mems-center-01";
const TAG_ID = "memstag-test01";
const TAG_NAME = "memstag test01";
const BLE_NAME = "Holy-IOT";
const BLE_MAC = "CE:76:04:3F:CE:88";
const CENTER_NAME = "ศูนย์เครื่องมือแพทย์";
const DEVICE_TOKEN_SHA256 = "bc7316ac28662a21bf720812b3ba8665a3ef1ebf1abd90938815c4ca28f79a01";

const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

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
  const tagId = String(payload.tag_id ?? "");
  const bleMac = String(payload.ble_mac ?? "").toUpperCase();
  const status = String(payload.status ?? "");
  const rawRssi = payload.rssi;
  const rssi = rawRssi === null || rawRssi === undefined ? null : Number(rawRssi);
  const serviceDataHex = String(payload.service_data_hex ?? "").toUpperCase();

  if (deviceId !== DEVICE_ID || tagId !== TAG_ID || bleMac !== BLE_MAC) {
    return jsonResponse({ error: "Unknown device or tag" }, 400);
  }
  if (status !== "present" && status !== "missing") {
    return jsonResponse({ error: "Invalid status" }, 400);
  }
  if (status === "present" && (!Number.isInteger(rssi) || Number(rssi) < -127 || Number(rssi) > 20)) {
    return jsonResponse({ error: "Invalid RSSI" }, 400);
  }
  if (serviceDataHex && (!/^[0-9A-F]+$/.test(serviceDataHex) || serviceDataHex.length > 94)) {
    return jsonResponse({ error: "Invalid service data" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Service unavailable" }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  let previousLastSeen: string | null = null;
  if (status === "missing") {
    const { data } = await supabase.from("memstag_status").select("last_seen_at").eq("id", TAG_ID).maybeSingle();
    previousLastSeen = data?.last_seen_at ?? null;
  }

  const { error } = await supabase.from("memstag_status").upsert({
    id: TAG_ID,
    display_name: TAG_NAME,
    ble_name: BLE_NAME,
    ble_mac: BLE_MAC,
    center_id: DEVICE_ID,
    center_name: CENTER_NAME,
    status,
    rssi: status === "present" ? rssi : null,
    last_seen_at: status === "present" ? now : previousLastSeen,
    center_reported_at: now,
    service_data_hex: serviceDataHex || null,
    updated_at: now,
  }, { onConflict: "id" });

  if (error) {
    console.error("memstag_status upsert failed", error.code);
    return jsonResponse({ error: "Write failed" }, 500);
  }
  return jsonResponse({ ok: true, status, received_at: now });
});
