/**
 * MEMs — Report generation (client-side)
 * แทนที่ gas/report_functions.gs และ gas/workload_report.gs เดิม ซึ่งเขียนรายงานลง Google Sheets
 * แล้ว export PDF ผ่าน Drive — ตอนนี้คำนวณสดจากข้อมูลใน Supabase แล้วสร้าง PDF ด้วย jsPDF ในเบราว์เซอร์แทน
 * ต้องโหลดหลัง supabase-client.js และ (สำหรับฟังก์ชัน export*PDF) หลัง jsPDF + jspdf-autotable
 */
const HOSPITAL_NAME = 'โรงพยาบาลพหลพลพยุหเสนา จ.กาญจนบุรี';

function rptThaiMonthYear(date) {
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return months[date.getMonth()] + ' ' + (date.getFullYear() + 543);
}

function rptFmtDuration(ms) {
  if (!ms || ms <= 0) return '0 ชม.';
  const totalHours = ms / 3600000;
  let days = Math.floor(totalHours / 24);
  let hours = Math.round(totalHours - days * 24);
  if (hours >= 24) { days += Math.floor(hours / 24); hours = hours % 24; }
  if (days > 0 && hours > 0) return days + ' วัน ' + hours + ' ชม.';
  if (days > 0) return days + ' วัน';
  return hours + ' ชม.';
}

/* ============================================================ PDF (jsPDF + ฟอนต์ไทย) ============================================================ */
// ฟอนต์มาตรฐานของ jsPDF (Helvetica) ไม่มีอักษรไทย — ต้องฝัง THSarabun.ttf (อยู่ใน repo) ก่อนวาดข้อความไทยทุกครั้ง
let _thaiFontB64 = null;
async function loadThaiFontB64() {
  if (_thaiFontB64) return _thaiFontB64;
  const res = await fetch('THSarabun.ttf');
  if (!res.ok) throw new Error('โหลดฟอนต์ THSarabun.ttf ไม่ได้ (HTTP ' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  _thaiFontB64 = btoa(bin);
  return _thaiFontB64;
}
const PDF_FONT = 'THSarabun';
async function newThaiPdf(opts) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF(Object.assign({ unit: 'pt', format: 'a4' }, opts || {}));
  doc.addFileToVFS('THSarabun.ttf', await loadThaiFontB64());
  doc.addFont('THSarabun.ttf', PDF_FONT, 'normal');
  doc.setFont(PDF_FONT);
  return doc;
}
// ตัวเลือกร่วมของ autoTable: ใช้ฟอนต์ไทยทุกส่วน (Sarabun ตัวเล็กกว่าฟอนต์ละติน จึงขยายขนาดขึ้นเล็กน้อย)
function thaiTable(doc, opts) {
  const base = { styles: { font: PDF_FONT, fontSize: 12, cellPadding: 3 }, headStyles: { font: PDF_FONT, fontStyle: 'normal', fillColor: [10, 100, 120] }, bodyStyles: { font: PDF_FONT }, columnStyles: {} };
  const merged = Object.assign({}, base, opts);
  merged.styles = Object.assign({}, base.styles, opts.styles || {});
  merged.headStyles = Object.assign({}, base.headStyles, opts.headStyles || {});
  Object.keys(merged.columnStyles).forEach(k => { merged.columnStyles[k] = Object.assign({ font: PDF_FONT }, merged.columnStyles[k], { fontStyle: 'normal' }); });
  doc.autoTable(merged);
}

/* ============================================================ THAI HOLIDAYS ============================================================ */
let _thaiHolidaySetCache = null;
async function fetchThaiHolidayDates() {
  if (_thaiHolidaySetCache) return _thaiHolidaySetCache;
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/thai-holidays', {
      headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'apikey': SUPABASE_ANON_KEY }
    });
    const data = await res.json();
    _thaiHolidaySetCache = new Set(data.dates || []);
  } catch (e) {
    _thaiHolidaySetCache = new Set();
  }
  return _thaiHolidaySetCache;
}

/* ============================================================ WORKLOAD CALENDAR (เทียบเท่า workload_report.gs) ============================================================ */
const VENTILATOR_EQUIPS = ['C2', 'Brid เขียว', 'High Flow', 'T1', 'Monnal t60'];
const WORKLOAD_SERVICE_ROWS = [
  { key: 'c2', label: 'ให้บริการเครื่องช่วยหายใจ (C2)', equips: ['C2'] },
  { key: 'bird', label: 'ให้บริการเครื่องช่วยหายใจ (Bird)', equips: ['Brid เขียว'] },
  { key: 'highflow', label: 'ให้บริการ High Flow', equips: ['High Flow'] },
  { key: 'infusion', label: 'ให้บริการ Infusion Pump', equips: ['Infusion Pump'] },
  { key: 'syringe', label: 'ให้บริการ Syringe Pump', equips: ['Syringe pump'] },
  { key: 'monitor', label: 'ให้บริการ Monitor', equips: ['Patient Monitor', 'NIBP'] },
  { key: 'defib', label: 'ให้บริการ Defibrillator', equips: ['Defibrillator'] },
  { key: 'other', label: 'ให้บริการเครื่องมือแพทย์อื่นๆ', equips: null }
];
const WORKLOAD_SHIFTS = ['เวรเช้า', 'เวรบ่าย', 'เวรดึก'];
const WORKLOAD_SHIFT_ABBR = { 'เวรเช้า': 'ช', 'เวรบ่าย': 'บ', 'เวรดึก': 'ด' };

function rptStripStaffTitle(name) {
  return String(name || '').replace(/\s*เจ้าหน้าที่ศูนย์เครื่องมือแพทย์\s*$/, '').trim();
}
function rptEmptyShiftCount() { return { 'เวรเช้า': 0, 'เวรบ่าย': 0, 'เวรดึก': 0 }; }
function rptShiftFromDate(d) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const hh = +parts.find(p => p.type === 'hour').value % 24, mm = +parts.find(p => p.type === 'minute').value;
  const t = hh * 60 + mm;
  if (t >= 510 && t < 990) return 'เวรเช้า';
  if (t >= 990 || t < 30) return 'เวรบ่าย';
  return 'เวรดึก';
}
function rptDayOfMonthBkk(d) {
  return +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric' }).format(d);
}
function rptWorkloadEquipRowKey(equip) {
  for (const r of WORKLOAD_SERVICE_ROWS) {
    if (r.equips && r.equips.includes(equip)) return r.key;
  }
  return 'other';
}
function rptWorkloadRowDefs() {
  return WORKLOAD_SERVICE_ROWS.concat([
    { key: 'fixjob', label: 'แก้ไขปัญหาหน้างาน' },
    { key: 'supplies', label: 'จ่ายวัสดุสำรอง', untracked: true },
    { key: 'ventprep', label: 'เตรียมความพร้อมใช้งานเครื่องช่วยหายใจ' }
  ]);
}

/** monthLabel: 'YYYY-MM' (ไม่ระบุ = เดือนปัจจุบันตามเวลาไทย) */
async function computeWorkloadCalendar(monthLabel) {
  const now = new Date();
  if (!monthLabel) {
    monthLabel = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
  }
  const [yearStr, monStr] = monthLabel.split('-');
  const year = parseInt(yearStr, 10), monthIdx = parseInt(monStr, 10) - 1;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const monthTH = rptThaiMonthYear(new Date(year, monthIdx, 1));
  const monthStart = `${monthLabel}-01`;
  const monthEndExclusive = monthIdx === 11 ? `${year + 1}-01-01` : `${yearStr}-${String(monthIdx + 2).padStart(2, '0')}-01`;

  const rowDefs = rptWorkloadRowDefs();
  const rowMap = {};
  rowDefs.forEach(def => {
    const byDay = {};
    for (let d = 1; d <= daysInMonth; d++) byDay[d] = rptEmptyShiftCount();
    rowMap[def.key] = { key: def.key, label: def.label, untracked: !!def.untracked, byDay, total: 0 };
  });

  const staffByDay = {};
  for (let d = 1; d <= daysInMonth; d++) staffByDay[d] = { 'เวรเช้า': {}, 'เวรบ่าย': {}, 'เวรดึก': {} };

  const holidays = await fetchThaiHolidayDates();
  const offHoursMorning = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, monthIdx, d).getDay();
    const key = `${yearStr}-${monStr}-${String(d).padStart(2, '0')}`;
    offHoursMorning[d] = (dow === 0 || dow === 6) || holidays.has(key);
  }

  function addCount(key, day, shift) {
    if (!rowMap[key] || day < 1 || day > daysInMonth) return;
    if (shift === 'เวรเช้า' && !offHoursMorning[day]) return;
    rowMap[key].byDay[day][shift] += 1;
    rowMap[key].total += 1;
  }
  function addStaff(day, shift, rawName) {
    const name = rptStripStaffTitle(rawName);
    if (!name || day < 1 || day > daysInMonth) return;
    if (shift === 'เวรเช้า' && !offHoursMorning[day]) return;
    staffByDay[day][shift][name] = (staffByDay[day][shift][name] || 0) + 1;
  }

  const [{ data: borrowRows }, { data: prepRows }, { data: fixRows }] = await Promise.all([
    supabase.from('borrow_records').select('action, equipment_name, staff_name, note, recorded_at, shift')
      .gte('record_date', monthStart).lt('record_date', monthEndExclusive),
    supabase.from('prepare_records').select('equipment_type, prepared_by, status, recorded_at')
      .gte('record_date', monthStart).lt('record_date', monthEndExclusive),
    supabase.from('fixjob_records').select('recorded_at')
      .gte('record_date', monthStart).lt('record_date', monthEndExclusive)
  ]);

  (borrowRows || []).forEach(r => {
    const ts = new Date(r.recorded_at);
    if (isNaN(ts)) return;
    const day = rptDayOfMonthBkk(ts);
    const shift = WORKLOAD_SHIFTS.includes(r.shift) ? r.shift : rptShiftFromDate(ts);
    const action = r.action || '', equip = r.equipment_name || '', note = r.note || '';
    if (action.includes('ยืม') && note.indexOf('เตรียมพร้อมส่ง') === 0) {
      addCount(rptWorkloadEquipRowKey(equip), day, shift);
      addStaff(day, shift, r.staff_name);
    } else if (action.includes('คืน') && VENTILATOR_EQUIPS.includes(equip)) {
      addCount('ventprep', day, shift);
    }
  });

  (prepRows || []).forEach(r => {
    if (String(r.status || '').indexOf('ยกเลิก') === 0) return;
    const ts = new Date(r.recorded_at);
    if (isNaN(ts)) return;
    const day = rptDayOfMonthBkk(ts);
    const shift = rptShiftFromDate(ts);
    addCount(rptWorkloadEquipRowKey(r.equipment_type || ''), day, shift);
    addStaff(day, shift, r.prepared_by);
  });

  (fixRows || []).forEach(r => {
    const ts = new Date(r.recorded_at);
    if (isNaN(ts)) return;
    addCount('fixjob', rptDayOfMonthBkk(ts), rptShiftFromDate(ts));
  });

  const staffOut = {};
  for (let d = 1; d <= daysInMonth; d++) {
    staffOut[d] = {};
    WORKLOAD_SHIFTS.forEach(s => {
      const counts = staffByDay[d][s];
      let topName = '', topCount = 0;
      Object.keys(counts).forEach(name => { if (counts[name] > topCount) { topName = name; topCount = counts[name]; } });
      staffOut[d][s] = topName;
    });
  }

  const rowsOut = rowDefs.map(def => rowMap[def.key]);
  const grandByDay = {};
  let grandTotal = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    grandByDay[d] = rptEmptyShiftCount();
    rowsOut.forEach(row => WORKLOAD_SHIFTS.forEach(s => { grandByDay[d][s] += row.byDay[d][s]; }));
    grandTotal += WORKLOAD_SHIFTS.reduce((sum, s) => sum + grandByDay[d][s], 0);
  }

  return {
    ok: true, month: monthLabel, monthTH, daysInMonth,
    shifts: WORKLOAD_SHIFTS, rows: rowsOut,
    staffByDay: staffOut, grandByDay, grandTotal,
    offHoursMorning,
    isCurrentMonth: monthLabel === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7),
    generatedAt: new Intl.DateTimeFormat('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  };
}

async function exportWorkloadCalendarPDF(d) {
  const doc = await newThaiPdf({ orientation: 'landscape' });
  doc.setFontSize(18);
  doc.text(HOSPITAL_NAME + ' — ภาระงานนอกเวลาราชการ (ศูนย์เครื่องมือแพทย์) ' + d.monthTH, 20, 26);
  doc.setFontSize(12);
  doc.text('รวมทั้งเดือน ' + d.grandTotal + ' ครั้ง · สร้างเมื่อ ' + d.generatedAt, 20, 42);

  const head = [['ภาระงาน', 'เวร', ...Array.from({ length: d.daysInMonth }, (_, i) => String(i + 1)), 'รวม']];
  const body = [];
  d.rows.forEach(row => {
    d.shifts.forEach((shift, si) => {
      const line = [si === 0 ? row.label + (row.untracked ? ' (ยังไม่มีในระบบ)' : '') : '', WORKLOAD_SHIFT_ABBR[shift]];
      for (let day = 1; day <= d.daysInMonth; day++) {
        if (shift === 'เวรเช้า' && !d.offHoursMorning[day]) { line.push('-'); continue; }
        line.push(String(row.byDay[day][shift] || ''));
      }
      line.push(si === 0 ? (row.untracked ? '' : String(row.total)) : '');
      body.push(line);
    });
  });
  d.shifts.forEach((shift, si) => {
    const line = [si === 0 ? 'ยอดรวม' : '', WORKLOAD_SHIFT_ABBR[shift]];
    let rowTotal = 0;
    for (let day = 1; day <= d.daysInMonth; day++) {
      if (shift === 'เวรเช้า' && !d.offHoursMorning[day]) { line.push('-'); continue; }
      const v = d.grandByDay[day][shift] || 0; rowTotal += v;
      line.push(String(v || ''));
    }
    line.push(si === 0 ? String(rowTotal) : '');
    body.push(line);
  });
  d.shifts.forEach((shift, si) => {
    const line = [si === 0 ? 'ชื่อผู้ปฏิบัติงาน' : '', WORKLOAD_SHIFT_ABBR[shift]];
    for (let day = 1; day <= d.daysInMonth; day++) {
      if (shift === 'เวรเช้า' && !d.offHoursMorning[day]) { line.push('-'); continue; }
      line.push((d.staffByDay[day] && d.staffByDay[day][shift]) || '');
    }
    line.push('');
    body.push(line);
  });

  thaiTable(doc, { head, body, startY: 50, styles: { fontSize: 8, cellPadding: 1.5, halign: 'center' }, columnStyles: { 0: { halign: 'left', cellWidth: 150 } } });
  doc.save('Workload_' + d.month.replace('-', '_') + '.pdf');
}

/* ============================================================ MONTHLY REPORT (เทียบเท่า generateMonthlyReport()) ============================================================ */
function rptCalcAvgBorrowDays(borrowRows, returnRows) {
  const equipSet = {};
  borrowRows.forEach(r => {
    const key = r.equipment_name + '__' + r.equipment_number + '__' + r.ward;
    (equipSet[key] = equipSet[key] || []).push({ borrow: new Date(r.recorded_at), equip: r.equipment_name });
  });
  const returnMap = {};
  returnRows.forEach(r => {
    const key = r.equipment_name + '__' + r.equipment_number + '__' + r.ward;
    (returnMap[key] = returnMap[key] || []).push(new Date(r.recorded_at));
  });
  const durations = {};
  Object.keys(equipSet).forEach(key => {
    const rList = (returnMap[key] || []).slice().sort((a, b) => a - b);
    equipSet[key].forEach(({ borrow, equip }) => {
      const ret = rList.find(t => t >= borrow);
      if (ret) {
        const days = (ret - borrow) / 86400000;
        (durations[equip] = durations[equip] || []).push(days);
      }
    });
  });
  return Object.entries(durations).map(([equip, arr]) => [equip, (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1), arr.length]);
}

async function rptGatherPrepareStats(start, end) {
  const res = { total: 0, used: 0, waiting: 0, cancelled: 0, byEquip: [], byPreparer: [] };
  const { data } = await supabase.from('prepare_records').select('equipment_type, prepared_by, status, recorded_at')
    .gte('recorded_at', start.toISOString()).lt('recorded_at', end.toISOString());
  const equipCount = {}, prepCount = {};
  (data || []).forEach(r => {
    res.total++;
    const st = r.status || '';
    if (st === 'ยืมแล้ว') res.used++;
    else if (st.indexOf('ยกเลิก') === 0) res.cancelled++;
    else res.waiting++;
    const eq = r.equipment_type || 'ไม่ระบุ'; equipCount[eq] = (equipCount[eq] || 0) + 1;
    const by = r.prepared_by || 'ไม่ระบุ'; prepCount[by] = (prepCount[by] || 0) + 1;
  });
  res.byEquip = Object.entries(equipCount).sort((a, b) => b[1] - a[1]);
  res.byPreparer = Object.entries(prepCount).sort((a, b) => b[1] - a[1]);
  return res;
}

/** สรุปรายงานของ "เดือนที่แล้ว" (นับตามวันที่ปัจจุบันของเครื่องผู้ใช้) */
async function computeMonthlyReport() {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMonth = new Date(firstOfThisMonth - 1);
  const monthTH = rptThaiMonthYear(firstOfLastMonth);

  const { data: raw, error } = await supabase.from('borrow_records').select('*')
    .gte('recorded_at', firstOfLastMonth.toISOString()).lte('recorded_at', lastOfLastMonth.toISOString());
  if (error) throw error;
  if (!raw || !raw.length) return { ok: false, error: 'ไม่มีข้อมูลในเดือนที่แล้ว' };

  const rows = raw.filter(r => (r.action || '').includes('ยืม') || (r.action || '').includes('คืน'));
  const borrowRows = rows.filter(r => (r.action || '').includes('ยืม'));
  const returnRows = rows.filter(r => (r.action || '').includes('คืน'));

  const equipCount = {};
  borrowRows.forEach(r => { const e = r.equipment_name || 'ไม่ระบุ'; equipCount[e] = (equipCount[e] || 0) + 1; });
  const equipRanked = Object.entries(equipCount).sort((a, b) => b[1] - a[1]);

  const wardCount = {};
  borrowRows.forEach(r => { const w = r.ward || 'ไม่ระบุ'; wardCount[w] = (wardCount[w] || 0) + 1; });
  const wardTop5 = Object.entries(wardCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const daysInMonth = lastOfLastMonth.getDate();
  const utilization = equipRanked.map(([equip, cnt]) => [equip, cnt, daysInMonth, (cnt / daysInMonth).toFixed(2)]);

  const avgDays = rptCalcAvgBorrowDays(borrowRows, returnRows);
  const prep = await rptGatherPrepareStats(firstOfLastMonth, firstOfThisMonth);

  return {
    ok: true, monthTH,
    total: borrowRows.length, totalReturn: returnRows.length,
    equipRanked, wardTop5, utilization, avgDays, daysInMonth, prep,
    generatedAt: new Intl.DateTimeFormat('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    message: 'สร้างรายงานประจำเดือน ' + monthTH + ' เรียบร้อยแล้ว'
  };
}

async function exportMonthlyReportPDF(d) {
  const doc = await newThaiPdf();
  let y = 44;
  doc.setFontSize(20); doc.text(HOSPITAL_NAME, 40, y); y += 22;
  doc.setFontSize(18); doc.text('รายงานประจำเดือน ' + d.monthTH, 40, y); y += 18;
  doc.setFontSize(12); doc.text('วันที่พิมพ์: ' + d.generatedAt, 40, y); y += 24;

  doc.setFontSize(14); doc.text(`รายการยืมทั้งหมด: ${d.total} ครั้ง   รายการคืนทั้งหมด: ${d.totalReturn} ครั้ง   จำนวนวันในเดือน: ${d.daysInMonth} วัน`, 40, y);
  y += 22;

  const section = (title, opts) => {
    if (y > 700) { doc.addPage(); doc.setFont(PDF_FONT); y = 44; }
    doc.setFontSize(15); doc.text(title, 40, y);
    thaiTable(doc, Object.assign({ startY: y + 8 }, opts));
    y = doc.lastAutoTable.finalY + 24;
  };

  section('ก) อุปกรณ์ที่ถูกยืม (จัดอันดับ)', {
    head: [['อันดับ', 'ประเภทเครื่อง', 'จำนวนครั้ง', 'สัดส่วน (%)']],
    body: d.equipRanked.map(([equip, cnt], i) => [i + 1, equip, cnt, d.total > 0 ? ((cnt / d.total) * 100).toFixed(1) + '%' : '0.0%'])
  });
  section('ข) หน่วยงานที่ยืมมากที่สุด 5 อันดับแรก', {
    head: [['อันดับ', 'หน่วยงาน', 'จำนวนครั้ง']],
    body: d.wardTop5.map(([ward, cnt], i) => [i + 1, ward, cnt])
  });
  section('ค) อัตราการใช้งานเฉลี่ยต่อวัน (Utilization Rate)', {
    head: [['ประเภทเครื่อง', 'ยืมทั้งเดือน (ครั้ง)', 'จำนวนวัน', 'เฉลี่ย (ครั้ง/วัน)']],
    body: d.utilization
  });
  section('ง) ระยะเวลายืมเฉลี่ย', {
    head: [['ประเภทเครื่อง', 'ระยะเวลาเฉลี่ย (วัน)', 'จำนวนคู่ที่คำนวณได้']],
    body: d.avgDays.length ? d.avgDays.map(([equip, avg, count]) => [equip, avg, count + ' คู่']) : [['ไม่สามารถคำนวณได้ (ต้องการข้อมูลคืนที่ตรงกัน)', '', '']]
  });
  const p = d.prep || { total: 0, used: 0, waiting: 0, cancelled: 0, byEquip: [], byPreparer: [] };
  section('จ) การเตรียมเครื่อง (โดยศูนย์เครื่องมือแพทย์)', {
    body: [
      ['เตรียมทั้งหมด', p.total + ' ครั้ง'],
      ['ส่งมอบ/ถูกยืมแล้ว', p.used + ' ครั้ง'],
      ['ยังรอรับ', p.waiting + ' ครั้ง'],
      ['ยกเลิก', p.cancelled + ' ครั้ง']
    ]
  });
  if (p.byEquip && p.byEquip.length) {
    section('แยกตามประเภทเครื่อง', { head: [['ประเภทเครื่อง', 'จำนวนครั้ง']], body: p.byEquip });
  }
  if (p.byPreparer && p.byPreparer.length) {
    section('แยกตามผู้เตรียม', { head: [['ผู้เตรียม', 'จำนวนครั้ง']], body: p.byPreparer });
  }

  doc.save('Monthly_Report_' + d.monthTH.replace(' ', '_') + '.pdf');
}

/* ============================================================ EXECUTIVE SUMMARY (เทียบเท่า generateExecutiveSummary()) ============================================================ */
async function computeExecutiveSummary() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMo = new Date(firstOfMonth - 1);
  const monthTH = rptThaiMonthYear(firstOfLastMo);

  // ดึงเฉพาะช่วงเดือนที่แล้ว→ปัจจุบัน (ไม่ต้องโหลดประวัติทั้งตาราง) + สถานะปัจจุบันจาก view
  const [raw, status] = await Promise.all([
    fetchAllPages(() => supabase.from('borrow_records').select('action, equipment_name, ward, recorded_at')
      .gte('recorded_at', firstOfLastMo.toISOString()).lte('recorded_at', now.toISOString())
      .order('recorded_at').order('id')),
    fetchEquipmentStatus()
  ]);
  if (!raw.length && !status.length) return { ok: false, error: 'ไม่มีข้อมูลในระบบ' };

  const lastMoRows = raw.filter(r => { const ts = new Date(r.recorded_at); return ts >= firstOfLastMo && ts <= lastOfLastMo; });
  const borrowLast = lastMoRows.filter(r => (r.action || '').includes('ยืม'));
  const returnLast = lastMoRows.filter(r => (r.action || '').includes('คืน'));

  const thisMonthRows = raw.filter(r => { const ts = new Date(r.recorded_at); return ts >= firstOfMonth && ts <= now; });
  const borrowThis = thisMonthRows.filter(r => (r.action || '').includes('ยืม'));

  const ec = {}; borrowLast.forEach(r => { const e = r.equipment_name || ''; ec[e] = (ec[e] || 0) + 1; });
  const topEquip = Object.entries(ec).sort((a, b) => b[1] - a[1])[0] || ['ไม่มีข้อมูล', 0];

  const wc = {}; borrowLast.forEach(r => { const w = r.ward || ''; wc[w] = (wc[w] || 0) + 1; });
  const topWard = Object.entries(wc).sort((a, b) => b[1] - a[1])[0] || ['ไม่มีข้อมูล', 0];

  // เดิมนับเฉพาะ action ที่มี "ยืม" (ไม่รวมย้ายวอร์ด) — คงเงื่อนไขเดิมไว้
  const stillBorrowed = status.filter(e => String(e.lastAction || '').includes('ยืม')).length;

  return {
    ok: true, monthTH,
    generatedAt: new Intl.DateTimeFormat('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    totalBorrowLastMonth: borrowLast.length, totalReturnLastMonth: returnLast.length,
    stillBorrowed, topEquipName: topEquip[0], topEquipCount: topEquip[1],
    topWardName: topWard[0], topWardCount: topWard[1], borrowThisMonthMTD: borrowThis.length,
    message: 'สร้างสรุปผู้บริหาร ' + monthTH + ' เรียบร้อยแล้ว'
  };
}

async function exportExecSummaryPDF(d) {
  const doc = await newThaiPdf();
  doc.setFontSize(20); doc.text(HOSPITAL_NAME, 40, 44);
  doc.setFontSize(18); doc.text('สรุปผู้บริหาร - ' + d.monthTH, 40, 66);
  doc.setFontSize(12); doc.text('จัดทำ: ' + d.generatedAt, 40, 84);
  thaiTable(doc, {
    startY: 100,
    body: [
      ['จำนวนการยืมทั้งหมด', d.totalBorrowLastMonth + ' ครั้ง'],
      ['จำนวนการคืนทั้งหมด', d.totalReturnLastMonth + ' ครั้ง'],
      ['เครื่องที่ยังค้างอยู่ ณ ปัจจุบัน', d.stillBorrowed + ' เครื่อง'],
      ['อุปกรณ์ที่ถูกยืมมากที่สุด', d.topEquipName + '  (' + d.topEquipCount + ' ครั้ง)'],
      ['หน่วยงานที่ยืมมากที่สุด', d.topWardName + '  (' + d.topWardCount + ' ครั้ง)'],
      ['การยืมเดือนนี้ (ถึงปัจจุบัน)', d.borrowThisMonthMTD + ' ครั้ง']
    ],
    styles: { fontSize: 15, cellPadding: 8 },
    columnStyles: { 1: { textColor: [10, 100, 120] } }
  });
  doc.save('ExecSummary_' + d.monthTH.replace(' ', '_') + '.pdf');
}

/* ============================================================ C2 REPORT (เทียบเท่า generateC2Report()) ============================================================ */
function rptAddWard(stat, ward, ms, countOnly) {
  if (!stat.perWard[ward]) stat.perWard[ward] = { count: 0, ms: 0 };
  if (countOnly) stat.perWard[ward].count++;
  else stat.perWard[ward].ms += ms;
}

async function computeC2Report() {
  const now = new Date();
  // กรองฝั่งเซิร์ฟเวอร์: เฉพาะ C2 และไม่ใช่ Round, แบ่งหน้ากันโดนตัดที่ 1,000 แถว
  const raw = await fetchAllPages(() => supabase.from('borrow_records')
    .select('action, equipment_name, equipment_number, ward, recorded_at')
    .ilike('equipment_name', '%C2%').not('action', 'ilike', '%Round%')
    .order('recorded_at').order('id'));
  if (!raw.length) return { ok: false, error: 'ไม่พบข้อมูลการยืม-คืนของเครื่อง C2' };

  const events = {};
  raw.forEach(r => {
    const equip = r.equipment_name || '';
    const action = r.action || '';
    if (!equip.includes('C2') || action.includes('Round')) return;
    const isBorrow = action.includes('ยืม'), isReturn = action.includes('คืน');
    if (!isBorrow && !isReturn) return;
    const no = parseInt(r.equipment_number, 10);
    if (isNaN(no) || no < 1 || no > 58) return;
    const ts = new Date(r.recorded_at);
    if (isNaN(ts) || ts.getTime() <= 0) return;
    (events[no] = events[no] || []).push({ ts, isBorrow, ward: r.ward || 'ไม่ระบุ' });
  });

  const units = {};
  Object.keys(events).forEach(noKey => {
    const list = events[noKey].slice().sort((a, b) => a.ts - b.ts);
    const stat = { no: parseInt(noKey, 10), borrowCount: 0, borrowedMs: 0, availableMs: 0, availableCount: 0, perWard: {}, currentStatus: 'ว่าง', lastWard: '' };
    let openBorrow = null, lastReturnTs = null;
    list.forEach(ev => {
      if (ev.isBorrow) {
        if (lastReturnTs && ev.ts > lastReturnTs) { stat.availableMs += (ev.ts - lastReturnTs); stat.availableCount++; lastReturnTs = null; }
        if (openBorrow) {
          const dur = ev.ts - openBorrow.ts;
          if (dur > 0) { stat.borrowedMs += dur; rptAddWard(stat, openBorrow.ward, dur, false); }
        }
        openBorrow = { ts: ev.ts, ward: ev.ward };
        stat.borrowCount++;
        rptAddWard(stat, ev.ward, 0, true);
      } else {
        if (openBorrow) {
          const dur = ev.ts - openBorrow.ts;
          if (dur > 0) { stat.borrowedMs += dur; rptAddWard(stat, openBorrow.ward, dur, false); }
          openBorrow = null;
        }
        lastReturnTs = ev.ts;
      }
    });
    if (openBorrow) {
      const dur = now - openBorrow.ts;
      if (dur > 0) { stat.borrowedMs += dur; rptAddWard(stat, openBorrow.ward, dur, false); }
      stat.currentStatus = 'อยู่ ' + openBorrow.ward; stat.lastWard = openBorrow.ward;
    } else if (lastReturnTs) {
      const dur = now - lastReturnTs;
      if (dur > 0) { stat.availableMs += dur; stat.availableCount++; }
      stat.currentStatus = 'ว่าง (พร้อมใช้)';
    }
    units[noKey] = stat;
  });

  const statList = Object.values(units);
  if (!statList.length) return { ok: false, error: 'ไม่พบข้อมูลการยืม-คืนของเครื่อง C2' };

  const mostUsed = statList.slice().sort((a, b) => b.borrowCount - a.borrowCount)[0];
  const longest = statList.slice().sort((a, b) => b.borrowedMs - a.borrowedMs)[0];
  const activeNow = statList.filter(s => s.currentStatus.indexOf('อยู่') === 0).length;

  return {
    ok: true,
    generatedAt: new Intl.DateTimeFormat('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    statList: statList.slice().sort((a, b) => a.no - b.no),
    mostUsed, longest, activeNow, usedUnits: statList.length,
    message: 'สร้างรายงาน C2 รายเครื่อง เรียบร้อยแล้ว'
  };
}

async function exportC2ReportPDF(d) {
  const doc = await newThaiPdf();
  doc.setFontSize(20); doc.text(HOSPITAL_NAME, 40, 44);
  doc.setFontSize(18); doc.text('รายงานสถิติเครื่อง C2 รายเครื่อง (ตั้งแต่เริ่มใช้งาน)', 40, 66);
  doc.setFontSize(12); doc.text('วันที่พิมพ์: ' + d.generatedAt, 40, 84);

  thaiTable(doc, {
    startY: 100,
    body: [
      ['เครื่องที่ถูกยืมบ่อยที่สุด', 'No. ' + d.mostUsed.no + '  (' + d.mostUsed.borrowCount + ' ครั้ง)'],
      ['เครื่องที่ถูกใช้งานนานที่สุด', 'No. ' + d.longest.no + '  (' + rptFmtDuration(d.longest.borrowedMs) + ')'],
      ['จำนวนเครื่องที่เคยถูกใช้', d.usedUnits + ' เครื่อง'],
      ['เครื่องที่กำลังถูกยืมอยู่', d.activeNow + ' เครื่อง']
    ],
    styles: { fontSize: 13 }
  });
  let y = doc.lastAutoTable.finalY + 24;

  doc.setFontSize(15); doc.text('ก) สรุปรายเครื่อง', 40, y);
  thaiTable(doc, {
    startY: y + 8,
    head: [['No.', 'จำนวนครั้งที่ยืม', 'เวลาถูกยืมรวม', 'เวลาว่างรวม', 'ครั้งที่ว่าง', 'สถานะปัจจุบัน']],
    body: d.statList.map(s => [s.no, s.borrowCount + ' ครั้ง', rptFmtDuration(s.borrowedMs), rptFmtDuration(s.availableMs), s.availableCount + ' ครั้ง', s.currentStatus]),
    styles: { fontSize: 11 }
  });
  y = doc.lastAutoTable.finalY + 24;

  const wardRows = [];
  d.statList.forEach(s => {
    const wards = Object.keys(s.perWard).sort((a, b) => s.perWard[b].count - s.perWard[a].count);
    wards.forEach((w, i) => wardRows.push([i === 0 ? s.no : '', w, s.perWard[w].count + ' ครั้ง', rptFmtDuration(s.perWard[w].ms)]));
  });
  if (wardRows.length) {
    if (y > 680) { doc.addPage(); doc.setFont(PDF_FONT); y = 44; }
    doc.setFontSize(15); doc.text('ข) รายละเอียดการใช้งานต่อวอร์ด', 40, y);
    thaiTable(doc, {
      startY: y + 8,
      head: [['No.', 'วอร์ด', 'จำนวนครั้ง', 'เวลารวม']],
      body: wardRows,
      styles: { fontSize: 11 }
    });
  }

  doc.save('C2_Report.pdf');
}
