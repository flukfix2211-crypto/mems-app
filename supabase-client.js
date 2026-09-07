/**
 * MEMs — Supabase client + shared helpers
 * แทนที่ Google Apps Script backend (gas/Code.gs) เดิม
 * ต้องโหลดหลัง <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 */
const SUPABASE_URL = 'https://pxmhmgdbuhmubviuxcxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bWhtZ2RidWhtdWJ2aXV4Y3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzM1MDQsImV4cCI6MjEwMjUwOTUwNH0.MqQ660fj2ZnFRXXqeSVav0DVehRy3OAaXux69O6BJOY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** วันที่/เวลาปัจจุบันตามเขตเวลาไทย (Asia/Bangkok) โดยไม่ขึ้นกับ timezone ของอุปกรณ์ผู้ใช้ */
function bkkDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function bkkTimeStr(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

/**
 * สถานะล่าสุดของทุกเครื่อง (equipment_name + equipment_number) จากประวัติยืม-คืน-Round-ย้าย
 * เทียบเท่า getEquipmentStatus() ใน gas/Code.gs เดิม
 * lastUpdate เป็น ISO timestamp string (ไม่ใช่ dd/MM/yyyy แบบเดิม)
 */
async function fetchEquipmentStatus() {
  const { data, error } = await supabase
    .from('borrow_records')
    .select('equipment_name, equipment_number, ward, staff_name, action, recorded_at')
    .not('equipment_name', 'is', null)
    .not('equipment_number', 'is', null)
    .order('recorded_at', { ascending: true });
  if (error) throw error;

  const map = {};
  (data || []).forEach(r => {
    const key = r.equipment_name + '__' + r.equipment_number;
    map[key] = {
      equipment: r.equipment_name,
      number: r.equipment_number,
      lastAction: r.action,
      ward: r.ward,
      borrowedBy: r.staff_name,
      lastUpdate: r.recorded_at,
      isBorrowed: r.action.includes('ยืม') || r.action.includes('ย้าย')
    };
  });
  return Object.values(map);
}

/** สถานะเครื่อง C2 ทั้ง 58 เครื่อง (No.1-58) — เทียบเท่า getC2Status()/buildC2Units() เดิม */
async function fetchC2Status() {
  const all = await fetchEquipmentStatus();
  const map = {};
  all.forEach(e => {
    if (!String(e.equipment).includes('C2')) return;
    const n = parseInt(e.number, 10);
    if (isNaN(n) || n < 1 || n > 58) return;
    map[String(n)] = {
      number: String(n),
      isBorrowed: e.isBorrowed,
      ward: e.isBorrowed ? e.ward : '',
      borrowedBy: e.isBorrowed ? e.borrowedBy : '',
      lastUpdate: e.lastUpdate
    };
  });
  const units = [];
  for (let i = 1; i <= 58; i++) {
    const k = String(i);
    units.push(map[k] || { number: k, isBorrowed: false, ward: '', borrowedBy: '', lastUpdate: '' });
  }
  return units;
}

/** รายการเครื่องที่เตรียมไว้และยังไม่ถูกยืม — เทียบเท่า getPrepareList() เดิม */
async function fetchPreparedList() {
  const { data, error } = await supabase
    .from('prepare_records')
    .select('id, record_date, record_time, equipment_type, equipment_number, ward, prepared_by, recorded_at')
    .eq('status', 'เตรียม')
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => ({
    _rowIndex: r.id,
    date: r.record_date,
    time: r.record_time,
    equipment: r.equipment_type,
    number: r.equipment_number,
    ward: r.ward,
    preparedBy: r.prepared_by
  }));
}

/** บันทึกรายการยืม/คืน/Round/ย้ายวอร์ด ลง borrow_records — เทียบเท่า saveRecord() เดิม */
async function saveBorrowRecord(payload) {
  const now = payload.timestamp ? new Date(payload.timestamp) : new Date();
  const row = {
    record_date: bkkDateStr(now),
    record_time: bkkTimeStr(now),
    shift: payload.shift || null,
    action: payload.action || '',
    equipment_name: payload.equipment || null,
    equipment_number: payload.equipmentNumber != null ? String(payload.equipmentNumber) : null,
    ward: payload.ward || null,
    staff_name: payload.name || null,
    recorded_at: now.toISOString(),
    round_status: payload.roundStatus || null,
    note: payload.note || null
  };
  const { data, error } = await supabase.from('borrow_records').insert(row).select().single();
  if (error) throw error;

  // เครื่องที่ถูกยืม -> หายจากรายการเตรียม (เทียบเท่า markPreparedUsed() เดิม)
  if ((payload.action || '').includes('ยืม') && payload.equipment && payload.equipmentNumber != null) {
    try {
      await supabase.from('prepare_records')
        .update({ status: 'ยืมแล้ว' })
        .eq('status', 'เตรียม')
        .eq('equipment_type', payload.equipment)
        .eq('equipment_number', String(payload.equipmentNumber));
    } catch (e) { /* ไม่ให้กระทบการบันทึกหลัก */ }
  }

  notifyTelegram({ type: 'borrow_return', record: row }); // ไม่ await — ไม่บล็อคการบันทึกหลัก
  return { row: data.id, timestamp: row.recorded_at };
}

/** แปลง Date -> "d เดือน พ.ศ." (เทียบเท่า _fmtThaiDateTime() เดิม) */
function fmtThaiDate(d) {
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}
function fmtThaiTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

/** ประวัติการเตรียมเครื่องทั้งหมด (รวมยืมแล้ว/ยกเลิก) ใหม่→เก่า — เทียบเท่า getPrepareHistory() เดิม */
async function fetchPrepareHistory() {
  const { data, error } = await supabase
    .from('prepare_records')
    .select('*')
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => {
    const d = new Date(r.recorded_at);
    return {
      _rowIndex: r.id,
      date: fmtThaiDate(d),
      time: fmtThaiTime(d),
      equipment: r.equipment_type,
      number: r.equipment_number,
      ward: r.ward,
      preparedBy: r.prepared_by,
      timestamp: r.recorded_at,
      status: r.status
    };
  });
}

/** ประวัติการแก้ไขหน้างานทั้งหมด ใหม่→เก่า — เทียบเท่า getFixJobList() เดิม */
async function fetchFixJobList() {
  const { data, error } = await supabase
    .from('fixjob_records')
    .select('*')
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => {
    const d = new Date(r.recorded_at);
    return {
      _rowIndex: r.id,
      date: fmtThaiDate(d),
      time: fmtThaiTime(d),
      ward: r.ward,
      topic: r.topic,
      detail: r.detail,
      solution: r.solution,
      staff: r.staff,
      photos: r.photo_urls || []
    };
  });
}

/** เรียก Edge Function แจ้งเตือน Telegram — เทียบเท่า notifyBorrowReturn_()/sendAlertDigestManual() เดิม */
async function notifyTelegram(payload) {
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/telegram-notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
