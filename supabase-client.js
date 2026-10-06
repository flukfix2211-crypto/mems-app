/**
 * MEMs — Supabase client + shared helpers
 * แทนที่ Google Apps Script backend (gas/Code.gs) เดิม
 * ต้องโหลดหลัง <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 */
const SUPABASE_URL = 'https://pxmhmgdbuhmubviuxcxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bWhtZ2RidWhtdWJ2aXV4Y3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzM1MDQsImV4cCI6MjEwMjUwOTUwNH0.MqQ660fj2ZnFRXXqeSVav0DVehRy3OAaXux69O6BJOY';
// ต้องใช้ `var` ไม่ใช่ `const`: ไลบรารี supabase-js (UMD) ประกาศ global ด้วย `var supabase = ...` ไว้แล้ว
// การประกาศซ้ำด้วย const จะเกิด SyntaxError "Identifier 'supabase' has already been declared"
// ทำให้ทั้งไฟล์นี้ไม่ทำงานเลย (ทุกหน้าโหลด/บันทึกข้อมูลไม่ได้) — var ประกาศซ้ำได้และแทนที่ namespace ด้วย client ที่สร้างแล้ว
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MEMS_QR_SCANNER_SETTING_ID = 'qr_scanner_enabled';

/** อ่านสวิตช์ QR ส่วนกลาง — ถ้ายังไม่มีแถวให้เปิดไว้เพื่อคงพฤติกรรมเดิม */
async function fetchQrScannerEnabled() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('bool_value')
    .eq('id', MEMS_QR_SCANNER_SETTING_ID)
    .limit(1);
  if (error) throw error;
  return !data || !data.length ? true : data[0].bool_value !== false;
}

/** บันทึกสวิตช์ QR ส่วนกลาง — RLS อนุญาตเฉพาะแอดมินหลัก */
async function saveQrScannerEnabled(enabled) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const { data, error } = await supabase
    .from('app_settings')
    .upsert({
      id: MEMS_QR_SCANNER_SETTING_ID,
      bool_value: !!enabled,
      updated_at: new Date().toISOString(),
      updated_by: session.user.id
    }, { onConflict: 'id' })
    .select('bool_value')
    .single();
  if (error) throw error;
  return data.bool_value !== false;
}

/** วันที่/เวลาปัจจุบันตามเขตเวลาไทย (Asia/Bangkok) โดยไม่ขึ้นกับ timezone ของอุปกรณ์ผู้ใช้ */
function bkkDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function bkkTimeStr(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
}

/**
 * ดึงข้อมูลทั้งหมดแบบแบ่งหน้า — PostgREST จำกัดผลลัพธ์สูงสุด 1,000 แถวต่อครั้ง
 * ถ้าไม่แบ่งหน้า ข้อมูลจะถูกตัดเงียบๆ เมื่อประวัติเกิน 1,000 แถว
 * buildQuery: () => supabase.from(...).select(...).order(...)  (ต้อง order ให้คงที่)
 */
async function fetchAllPages(buildQuery, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

/**
 * สถานะล่าสุดของทุกเครื่อง (equipment_name + equipment_number) จาก view equipment_status
 * (คำนวณด้วย DISTINCT ON ฝั่ง Postgres — ไม่ต้องดึงประวัติทั้งตาราง)
 * เทียบเท่า getEquipmentStatus() ใน gas/Code.gs เดิม
 * lastUpdate เป็น ISO timestamp string (ไม่ใช่ dd/MM/yyyy แบบเดิม)
 */
async function fetchEquipmentStatus() {
  const rows = await fetchAllPages(() =>
    supabase.from('equipment_status')
      .select('equipment_name, equipment_number, ward, staff_name, action, recorded_at, is_borrowed')
      .order('equipment_name').order('equipment_number'));
  return rows.map(mapEquipmentStatusRow);
}

function mapEquipmentStatusRow(r) {
  return {
    equipment: r.equipment_name,
    number: r.equipment_number,
    lastAction: r.action,
    ward: r.ward,
    borrowedBy: r.staff_name,
    lastUpdate: r.recorded_at,
    isBorrowed: !!r.is_borrowed
  };
}

/** สถานะล่าสุดของเครื่องหนึ่งตัว ใช้สแกน QR คืนแล้วเลือกหน่วยงานเดิมอัตโนมัติ */
async function fetchEquipmentStatusForMachine(equipment, number) {
  const machineNo = normalizeMachineNo(number);
  if (!equipment || !machineNo) return null;
  const { data, error } = await supabase.from('equipment_status')
    .select('equipment_name, equipment_number, ward, staff_name, action, recorded_at, is_borrowed')
    .eq('equipment_name', equipment)
    .eq('equipment_number', machineNo)
    .limit(1);
  if (error) throw error;
  return data && data.length ? mapEquipmentStatusRow(data[0]) : null;
}

/**
 * หมายเลขเครื่อง C2 ตามทะเบียนครุภัณฑ์ (ตาราง assets, type = 'C2') เรียงจากน้อยไปมาก
 * ใช้กำหนดว่าหน้าสถานะมีเครื่อง No. อะไรบ้าง/กี่เครื่อง — ถ้าโหลดไม่ได้หรือทะเบียนยังว่าง คืน [] (ผู้เรียกใช้ค่าเดิม 1-58 แทน)
 */
const C2_FALLBACK_COUNT = 58;
async function fetchC2AssetNumbers() {
  try {
    const { data, error } = await supabase.from('assets').select('no').eq('type', 'C2');
    if (error) throw error;
    return sortMachineNumbers((data || []).map(a => a.no));
  } catch (e) {
    return [];
  }
}

// ทำเลขเครื่องให้อยู่รูปเดียวกัน (" 01", "1.0" → "1") — คืน '' ถ้าว่าง
function normalizeMachineNo(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  const n = Number(s);
  return Number.isInteger(n) ? String(n) : s;
}

// ตัดค่าว่าง/ซ้ำ แล้วเรียงเลขเครื่องแบบตัวเลข (เลขที่ไม่ใช่ตัวเลขไปต่อท้าย)
function sortMachineNumbers(list) {
  const set = new Set();
  list.forEach(v => {
    const k = normalizeMachineNo(v);
    if (k) set.add(k);
  });
  return [...set].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    const ia = Number.isInteger(na), ib = Number.isInteger(nb);
    if (ia && ib) return na - nb;
    if (ia !== ib) return ia ? -1 : 1;
    return a.localeCompare(b);
  });
}

/**
 * ตรวจเลขเครื่องกับทะเบียนครุภัณฑ์ก่อนบันทึกยืม
 * คืน { missing: [...เลขที่ไม่มีในทะเบียน], unusable: [{ no, status }...เครื่องที่สถานะไม่ใช่ "ใช้งานได้"] }
 * คืน null ถ้าประเภทนี้ยังไม่มีในทะเบียน หรือโหลดทะเบียนไม่ได้ (ไม่บล็อคการบันทึก)
 */
async function checkNumbersAgainstRegistry(type, nums) {
  try {
    const { data, error } = await supabase.from('assets').select('no, status').eq('type', type);
    if (error) throw error;
    if (!data || !data.length) return null;
    const statusByNo = {};
    data.forEach(a => {
      const k = normalizeMachineNo(a.no);
      if (!k) return;
      // เลขซ้ำในทะเบียน: ถ้ามีแถวไหน "ใช้งานได้" ถือว่าใช้ได้
      if (statusByNo[k] !== 'ใช้งานได้') statusByNo[k] = a.status || 'ใช้งานได้';
    });
    const missing = [], unusable = [];
    nums.forEach(n => {
      const k = normalizeMachineNo(n);
      if (!(k in statusByNo)) missing.push(k || String(n));
      else if (statusByNo[k] !== 'ใช้งานได้') unusable.push({ no: k, status: statusByNo[k] });
    });
    return { missing, unusable };
  } catch (e) {
    return null;
  }
}

/** สถานะเครื่อง C2 ทุกเครื่องตาม No. ในทะเบียนครุภัณฑ์ — เทียบเท่า getC2Status()/buildC2Units() เดิม */
async function fetchC2Status() {
  const [all, assetNos] = await Promise.all([fetchEquipmentStatus(), fetchC2AssetNumbers()]);
  const map = {};
  all.forEach(e => {
    if (!String(e.equipment).includes('C2')) return;
    const k = normalizeMachineNo(e.number);
    if (!k) return;
    map[k] = {
      number: k,
      isBorrowed: e.isBorrowed,
      ward: e.isBorrowed ? e.ward : '',
      borrowedBy: e.isBorrowed ? e.borrowedBy : '',
      lastUpdate: e.lastUpdate
    };
  });
  let numbers = assetNos;
  if (!numbers.length) {
    numbers = [];
    for (let i = 1; i <= C2_FALLBACK_COUNT; i++) numbers.push(String(i));
  }
  // เครื่องที่ยังถูกยืมอยู่แต่ไม่มีในทะเบียน ยังต้องแสดง เพื่อให้คืนเครื่องได้
  const extra = Object.values(map).filter(u => u.isBorrowed && !numbers.includes(u.number)).map(u => u.number);
  if (extra.length) numbers = sortMachineNumbers(numbers.concat(extra));
  return numbers.map(k => map[k] || { number: k, isBorrowed: false, ward: '', borrowedBy: '', lastUpdate: '' });
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
    // เก็บเลขเครื่องรูปเดียวกันเสมอ ("054" → "54") ไม่งั้นระบบนับเป็นคนละเครื่อง
    equipment_number: payload.equipmentNumber != null ? (normalizeMachineNo(payload.equipmentNumber) || String(payload.equipmentNumber)) : null,
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
  const data = await fetchAllPages(() =>
    supabase.from('prepare_records').select('*').order('recorded_at', { ascending: false }).order('id', { ascending: false }));
  return data.map(r => {
    const d = new Date(r.recorded_at);
    return {
      _rowIndex: r.id,
      recordDate: r.record_date,
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
  const data = await fetchAllPages(() =>
    supabase.from('fixjob_records').select('*').order('recorded_at', { ascending: false }).order('id', { ascending: false }));
  return data.map(r => {
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

/**
 * สมัครรับการเปลี่ยนแปลงข้อมูลแบบเรียลไทม์ (insert/update/delete) จากตารางที่ระบุ ผ่าน Supabase Realtime
 * เมื่อมีการเปลี่ยนแปลงจะเรียก callback (debounce ไว้กันเรียกถี่เกินไปเวลามีหลายแถวเปลี่ยนพร้อมกัน เช่น ยืม/คืนรัวๆ)
 * ต้องเปิด Realtime ให้ตารางนั้นในฝั่ง Supabase ก่อน (alter publication supabase_realtime add table ...)
 * คืนค่า RealtimeChannel — เรียก .unsubscribe() ตอนออกจากหน้าถ้าต้องการเลิกฟัง
 */
function subscribeRealtime(tables, callback, debounceMs = 500) {
  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(callback, debounceMs);
  };
  const channel = supabase.channel('mems-realtime-' + tables.join('-'));
  tables.forEach(table => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, trigger);
  });
  channel.subscribe();
  return channel;
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
