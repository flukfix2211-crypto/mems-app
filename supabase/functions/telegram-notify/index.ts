// Supabase Edge Function: telegram-notify
// Replaces notifyBorrowReturn_ / sendDailyAlertDigest_ / sendAlertDigestManual from the
// old Google Apps Script backend (gas/Code.gs). Request shapes:
//   POST { type: "borrow_return", record: {...} }  -> instant borrow/return notify
//   POST { type: "digest", manual?: boolean }       -> compute + send daily alert digest (cron 08:00)
//   POST { type: "shift_summary" }                  -> ยืม-คืน + แก้ไขหน้างาน ของเวร ช/บ/ด ล่าสุด (cron 08:30, วันละครั้ง)
//
// Secrets required (set via Supabase Dashboard > Edge Functions > telegram-notify > Secrets,
// or `supabase secrets set TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=...`):
//   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
//
// ไฟล์นี้คือซอร์สของฟังก์ชันที่ deploy อยู่บน Supabase — แก้แล้วต้อง deploy ใหม่

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const THAI_TZ = "Asia/Bangkok";
const DIGEST_OVERDUE_C2_DAYS = 14;
const DIGEST_SHORTAGE_MAX = 2;
const TELEGRAM_MAX_CHARS = 3900; // Telegram จำกัด 4,096 ตัวอักษรต่อข้อความ — เผื่อไว้

function escHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: THAI_TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: THAI_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
}
function fmtDayMonthTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: THAI_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(",", "");
}

async function sendTelegramMessage(text: string) {
  const token = Deno.env.get("TELEGRAM_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    return { ok: false, statusCode: null as number | null, body: "ยังไม่ได้ตั้งค่า Telegram" };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const body = res.ok ? "" : await res.text();
  return { ok: res.ok, statusCode: res.status, body };
}

// ข้อความยาวเกิน limit → แบ่งเป็นหลายข้อความตามบรรทัด (ไม่ตัดกลางแท็ก HTML)
function splitMessage(text: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && (cur.length + line.length + 1) > TELEGRAM_MAX_CHARS) {
      parts.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) parts.push(cur);
  return parts;
}

function buildBorrowReturnMessage(record: Record<string, unknown>, now: Date): string | null {
  const action = String(record.action || "");
  const isBorrow = action.includes("ยืม");
  const isReturn = action.includes("คืน");
  if (!isBorrow && !isReturn) return null; // แจ้งเฉพาะยืม/คืน ไม่แจ้ง Round/ย้าย

  const statusLabel = isBorrow ? "ยืม" : "คืน";
  let msg = `📢 มีการ <b>${escHtml(statusLabel)}</b> เครื่องมือ: <b>${escHtml(record.equipment_name)}</b>\n`;
  msg += `📅 วันที่: ${escHtml(fmtDate(now) + "  เวลา " + fmtTime(now))}\n\n`;
  msg += `🔹 <b>หมายเลขเครื่อง</b>: ${escHtml(record.equipment_number)}\n`;
  msg += `🔹 <b>ตึก/Ward</b>: ${escHtml(record.ward)}\n`;
  msg += `🔹 <b>ผู้บันทึก</b>: ${escHtml(record.staff_name)}\n`;
  msg += `🔹 <b>เวร</b>: ${escHtml(record.shift)}\n`;
  if (record.note) msg += `🔹 <b>หมายเหตุ</b>: ${escHtml(record.note)}\n`;

  if (String(record.equipment_name || "").toUpperCase().trim() === "C2" && isBorrow) {
    const changeDate = new Date(now.getTime() + 14 * 86400000);
    msg += `\n⚡️ <b>วันที่เปลี่ยน Circuit:</b> ${escHtml(fmtDate(changeDate))}`;
  }
  return msg;
}

type StatusRow = {
  equipment_name: string;
  equipment_number: string;
  ward: string | null;
  action: string;
  recorded_at: string;
  is_borrowed: boolean;
};

// อ่านสถานะล่าสุดของแต่ละเครื่องจาก view equipment_status (DISTINCT ON ฝั่ง Postgres)
// แบ่งหน้ากันโดน PostgREST ตัดที่ 1,000 แถว
async function fetchEquipmentStatus(supabase: ReturnType<typeof createClient>): Promise<StatusRow[]> {
  const all: StatusRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("equipment_status")
      .select("equipment_name, equipment_number, ward, action, recorded_at, is_borrowed")
      .order("equipment_name").order("equipment_number")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...((data ?? []) as StatusRow[]));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

async function computeDailyAlerts(supabase: ReturnType<typeof createClient>) {
  const status = await fetchEquipmentStatus(supabase);
  const now = Date.now();
  const overdue: { number: string; ward: string; days: number }[] = [];
  const availByType = new Map<string, number>();

  for (const row of status) {
    if (row.equipment_name.includes("C2") && row.is_borrowed) {
      const days = Math.floor((now - new Date(row.recorded_at).getTime()) / 86400000);
      if (days >= DIGEST_OVERDUE_C2_DAYS) {
        overdue.push({ number: row.equipment_number, ward: row.ward || "", days });
      }
    }
    if (!availByType.has(row.equipment_name)) availByType.set(row.equipment_name, 0);
    if (!row.is_borrowed) availByType.set(row.equipment_name, availByType.get(row.equipment_name)! + 1);
  }

  overdue.sort((a, b) => b.days - a.days);
  const shortage = Array.from(availByType.entries())
    .filter(([, avail]) => avail <= DIGEST_SHORTAGE_MAX)
    .map(([equipment, available]) => ({ equipment, available }))
    .sort((a, b) => a.available - b.available);

  return { overdue, shortage };
}

function buildDigestMessage(
  overdue: { number: string; ward: string; days: number }[],
  shortage: { equipment: string; available: number }[],
): string {
  let msg = `📋 <b>สรุปแจ้งเตือนประจำวัน ${escHtml(fmtDate(new Date()))}</b>\n`;

  if (overdue.length) {
    msg += `\n⏰ <b>ยืมเกินกำหนด (C2 ≥${DIGEST_OVERDUE_C2_DAYS} วัน)</b>\n`;
    for (const o of overdue) {
      msg += `• C2 No.${escHtml(o.number)} ตึก ${escHtml(o.ward || "—")} — ยืมมาแล้ว ${o.days} วัน\n`;
    }
  }

  if (shortage.length) {
    msg += `\n⚠️ <b>ใกล้หมด (เหลือ ≤${DIGEST_SHORTAGE_MAX} เครื่อง)</b>\n`;
    for (const s of shortage) {
      msg += `• ${escHtml(s.equipment)} — เหลือว่าง ${s.available} เครื่อง\n`;
    }
  }

  if (!overdue.length && !shortage.length) msg += "\n✅ ไม่มีรายการยืมเกินกำหนดหรือใกล้หมด";
  return msg;
}

// ── สรุปยืม-คืนรายเวร (ช / บ / ด) ─────────────────────────────────
// เวรตามเวลาที่ใช้ในหน้าเว็บ (detectShift): เช้า 08:30–16:30, บ่าย 16:30–00:30, ดึก 00:30–08:30
// ส่ง 08:30 → สรุป 3 เวรล่าสุด = เมื่อวาน 08:30 ถึง วันนี้ 08:30 (นับตามเวลาที่ยืม/คืนจริง recorded_at)
const SHIFT_HOURS = 8;
const SHIFTS = [
  { key: "morning", label: "เวรเช้า (ช)", icon: "🌅" },
  { key: "afternoon", label: "เวรบ่าย (บ)", icon: "🌇" },
  { key: "night", label: "เวรดึก (ด)", icon: "🌙" },
];

type BorrowRow = {
  action: string | null;
  equipment_name: string | null;
  equipment_number: string | null;
  ward: string | null;
  recorded_at: string;
};

// 08:30 น. (เวลาไทย) ล่าสุดที่ผ่านมาแล้ว — ใช้เป็นเวลาสิ้นสุดของเวรดึก
function latestShiftCycleEnd(now: Date): Date {
  const bkk = new Date(now.getTime() + 7 * 3600000); // เวลาไทย (UTC+7 ไม่มี DST)
  let end = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), 1, 30); // 08:30 ไทย = 01:30 UTC
  if (end > now.getTime()) end -= 86400000;
  return new Date(end);
}

function actionKind(action: string | null): "borrow" | "return" | "move" | null {
  const a = String(action || "");
  if (a.includes("ย้าย")) return "move";
  if (a.includes("คืน")) return "return";
  if (a.includes("ยืม")) return "borrow";
  return null; // Round / เปลี่ยน Circuit ไม่นับ
}

// จัดกลุ่ม: ประเภทเครื่อง + ตึก → เลขเครื่อง  เช่น "C2 No.10, 21 · TM"
function groupLines(rows: BorrowRow[]): string[] {
  const groups = new Map<string, { equipment: string; ward: string; nums: string[] }>();
  for (const r of rows) {
    const equipment = String(r.equipment_name || "—");
    const ward = String(r.ward || "—");
    const key = equipment + "\u0000" + ward;
    const g = groups.get(key) || { equipment, ward, nums: [] };
    if (r.equipment_number) g.nums.push(String(r.equipment_number));
    groups.set(key, g);
  }
  return Array.from(groups.values())
    .sort((a, b) => a.equipment.localeCompare(b.equipment, "th") || a.ward.localeCompare(b.ward, "th"))
    .map(g => {
      const nums = g.nums.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
      return `   • ${escHtml(g.equipment)}${nums.length ? " No." + escHtml(nums.join(", ")) : ""} · ${escHtml(g.ward)}`;
    });
}

type FixJobRow = {
  ward: string | null;
  topic: string | null;
  detail: string | null;
  solution: string | null;
  staff: string | null;
  recorded_at: string;
};

// ตัดข้อความยาวให้สั้นพอสำหรับบรรทัดสรุป
function clip(s: unknown, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// แก้ไขหน้างาน 1 รายการ = 1 บรรทัด: หัวข้อ · ตึก — ปัญหา → วิธีแก้ (ผู้แก้)
function fixJobLine(f: FixJobRow): string {
  const staff = String(f.staff || "").replace(/\s*เจ้าหน้าที่ศูนย์เครื่องมือแพทย์\s*$/, "").trim();
  let line = `   • ${escHtml(clip(f.topic || "—", 40))} · ${escHtml(f.ward || "—")}`;
  if (f.detail) line += ` — ${escHtml(clip(f.detail, 80))}`;
  if (f.solution) line += ` → ${escHtml(clip(f.solution, 80))}`;
  if (staff) line += ` (${escHtml(staff)})`;
  return line;
}

async function buildShiftSummaryMessage(supabase: ReturnType<typeof createClient>, now: Date): Promise<string> {
  const end = latestShiftCycleEnd(now);
  const start = new Date(end.getTime() - 3 * SHIFT_HOURS * 3600000);

  const [borrowRes, fixRes] = await Promise.all([
    supabase
      .from("borrow_records")
      .select("action, equipment_name, equipment_number, ward, recorded_at")
      .gte("recorded_at", start.toISOString())
      .lt("recorded_at", end.toISOString())
      .order("recorded_at", { ascending: true })
      .limit(5000),
    supabase
      .from("fixjob_records")
      .select("ward, topic, detail, solution, staff, recorded_at")
      .gte("recorded_at", start.toISOString())
      .lt("recorded_at", end.toISOString())
      .order("recorded_at", { ascending: true })
      .limit(1000),
  ]);
  if (borrowRes.error) throw borrowRes.error;
  if (fixRes.error) throw fixRes.error;
  const rows = (borrowRes.data ?? []) as BorrowRow[];
  const fixRows = (fixRes.data ?? []) as FixJobRow[];

  let msg = `📋 <b>สรุปยืม-คืน และแก้ไขหน้างาน รายเวร</b>\n${escHtml(fmtDayMonthTime(start))} – ${escHtml(fmtDayMonthTime(end))}\n`;
  const totals = { borrow: 0, return: 0, move: 0, fix: 0 };
  const inRange = (iso: string, from: number, to: number) => {
    const t = new Date(iso).getTime();
    return t >= from && t < to;
  };

  SHIFTS.forEach((s, i) => {
    const from = start.getTime() + i * SHIFT_HOURS * 3600000;
    const to = from + SHIFT_HOURS * 3600000;
    const inShift = rows.filter(r => inRange(r.recorded_at, from, to));
    const fixes = fixRows.filter(f => inRange(f.recorded_at, from, to));
    const byKind = { borrow: [] as BorrowRow[], return: [] as BorrowRow[], move: [] as BorrowRow[] };
    for (const r of inShift) {
      const k = actionKind(r.action);
      if (k) byKind[k].push(r);
    }
    totals.borrow += byKind.borrow.length;
    totals.return += byKind.return.length;
    totals.move += byKind.move.length;
    totals.fix += fixes.length;

    const counts = `ยืม ${byKind.borrow.length} · คืน ${byKind.return.length}`
      + (byKind.move.length ? " · ย้ายวอร์ด " + byKind.move.length : "")
      + (fixes.length ? " · แก้ไขหน้างาน " + fixes.length : "");
    msg += `\n${s.icon} <b>${s.label}</b> ${escHtml(fmtDayMonthTime(new Date(from)).slice(0, 5))} — ${counts}\n`;
    if (!byKind.borrow.length && !byKind.return.length && !byKind.move.length && !fixes.length) {
      msg += "   ไม่มีรายการ\n";
      return;
    }
    if (byKind.borrow.length) msg += `  🟩 ยืม\n${groupLines(byKind.borrow).join("\n")}\n`;
    if (byKind.return.length) msg += `  🟥 คืน\n${groupLines(byKind.return).join("\n")}\n`;
    if (byKind.move.length) msg += `  🔁 ย้ายวอร์ด (ไปที่)\n${groupLines(byKind.move).join("\n")}\n`;
    if (fixes.length) msg += `  🛠 แก้ไขหน้างาน\n${fixes.map(fixJobLine).join("\n")}\n`;
  });

  msg += `\n<b>รวม 3 เวร</b>: ยืม ${totals.borrow} · คืน ${totals.return}`
    + (totals.move ? " · ย้ายวอร์ด " + totals.move : "")
    + ` · แก้ไขหน้างาน ${totals.fix}\n`;

  // เครื่องที่ยังยืมอยู่ ณ ตอนส่ง แยกตามประเภท
  const status = await fetchEquipmentStatus(supabase);
  const borrowedByType = new Map<string, number>();
  for (const row of status) {
    if (row.is_borrowed) borrowedByType.set(row.equipment_name, (borrowedByType.get(row.equipment_name) || 0) + 1);
  }
  const borrowedLine = Array.from(borrowedByType.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${escHtml(name)} ${n}`)
    .join(" · ");
  msg += `📌 ยืมอยู่ตอนนี้: ${borrowedLine || "ไม่มี"}`;
  return msg;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const type = payload.type || "borrow_return";

    if (type === "borrow_return") {
      const record = payload.record || {};
      const msg = buildBorrowReturnMessage(record, new Date());
      if (!msg) return json({ ok: true, sent: false, reason: "not borrow/return" });
      const result = await sendTelegramMessage(msg);
      return json({ ok: true, sent: result.ok, statusCode: result.statusCode, errorDetail: result.body });
    }

    if (type === "digest") {
      const manual = !!payload.manual;
      const { overdue, shortage } = await computeDailyAlerts(supabase);
      const token = Deno.env.get("TELEGRAM_TOKEN");
      const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
      const configured = !!(token && chatId);

      if (!overdue.length && !shortage.length) {
        if (!manual) return json({ ok: true, sent: false, skipped: true });
        return json({
          ok: true, configured, sent: false, skipped: true,
          statusCode: null, errorDetail: "",
          overdueCount: 0, shortageCount: 0, message: "",
        });
      }

      const message = buildDigestMessage(overdue, shortage);
      const result = configured
        ? await sendTelegramMessage(message)
        : { ok: false, statusCode: null, body: "ยังไม่ได้ตั้งค่า Telegram" };

      return json({
        ok: true,
        configured,
        sent: result.ok,
        skipped: false,
        statusCode: result.statusCode,
        errorDetail: result.ok ? "" : result.body,
        overdueCount: overdue.length,
        shortageCount: shortage.length,
        message,
      });
    }

    if (type === "shift_summary") {
      // dryRun: คืนข้อความโดยไม่ส่ง Telegram (ใช้ทดสอบ) — ใส่ asOf (ISO) เพื่อดูสรุปของช่วงเวลาอื่นได้เฉพาะตอน dryRun
      const asOf = payload.dryRun && payload.asOf ? new Date(payload.asOf) : new Date();
      if (isNaN(asOf.getTime())) return json({ ok: false, error: "invalid asOf" }, 400);
      const message = await buildShiftSummaryMessage(supabase, asOf);
      if (payload.dryRun) return json({ ok: true, sent: false, dryRun: true, message });
      const results = [];
      for (const part of splitMessage(message)) results.push(await sendTelegramMessage(part));
      const failed = results.find(r => !r.ok);
      return json({
        ok: true,
        sent: !failed,
        parts: results.length,
        statusCode: failed ? failed.statusCode : 200,
        errorDetail: failed ? failed.body : "",
      });
    }

    return json({ ok: false, error: "unknown type" }, 400);
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
