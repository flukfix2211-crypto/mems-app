/**
 * MEMs — ภาระงานนอกเวลาราชการ (ศูนย์เครื่องมือแพทย์)
 * สรุปภาระงานรายวัน/เวร ในรูปแบบเดียวกับแบบฟอร์มกระดาษที่ใช้อยู่ปัจจุบัน
 * (แถว = ประเภทภาระงาน, คอลัมน์ = วันที่ 1..สิ้นเดือน แยกเวร ช/บ/ด)
 *
 * ใช้ข้อมูลจาก Sheet ที่มีอยู่แล้ว (ยืม-คืน, เตรียมเครื่อง, แก้ไขหน้างาน)
 * ไม่ต้องกรอกซ้ำ — คำนวณสดทุกครั้งที่เรียกดู จึงดูของ "วันนี้" ได้ทันทีโดยไม่ต้องรอสิ้นเดือน
 */

// เครื่องช่วยหายใจ — เมื่อ "คืน" เครื่องกลุ่มนี้ ถือเป็นภาระงาน "เตรียมความพร้อมใช้งานเครื่องช่วยหายใจ"
const VENTILATOR_EQUIPS = ['C2', 'Brid เขียว', 'High Flow', 'T1', 'Monnal t60'];

// แถว "ให้บริการ" ตามชื่อเครื่องที่ใช้จริงในระบบ (borrow.html / prepare.html)
const WORKLOAD_SERVICE_ROWS = [
  { key: 'c2',       label: 'ให้บริการเครื่องช่วยหายใจ (C2)',   equips: ['C2'] },
  { key: 'bird',     label: 'ให้บริการเครื่องช่วยหายใจ (Bird)', equips: ['Brid เขียว'] },
  { key: 'highflow', label: 'ให้บริการ High Flow',               equips: ['High Flow'] },
  { key: 'infusion', label: 'ให้บริการ Infusion Pump',           equips: ['Infusion Pump'] },
  { key: 'syringe',  label: 'ให้บริการ Syringe Pump',            equips: ['Syringe pump'] },
  { key: 'monitor',  label: 'ให้บริการ Monitor',                 equips: ['Patient Monitor', 'NIBP'] },
  { key: 'defib',    label: 'ให้บริการ Defibrillator',           equips: ['Defibrillator'] },
  { key: 'other',    label: 'ให้บริการเครื่องมือแพทย์อื่นๆ',    equips: null } // catch-all (T1, ชื่อเครื่องกำหนดเอง)
];

const WORKLOAD_SHIFTS = ['เวรเช้า', 'เวรบ่าย', 'เวรดึก'];
const WORKLOAD_SHIFT_ABBR = { 'เวรเช้า': 'ช', 'เวรบ่าย': 'บ', 'เวรดึก': 'ด' };

// เวรเช้า (08:30-16:30) ตรงกับเวลาราชการปกติของวันธรรมดา จึงถือเป็น "ภาระงานนอกเวลาราชการ"
// เฉพาะ เสาร์-อาทิตย์ หรือวันหยุดราชการไทยเท่านั้น — ใช้ปฏิทินวันหยุดสาธารณะของ Google (อัปเดตอัตโนมัติทุกปี)
const TH_HOLIDAY_CALENDAR_ID = 'en.th#holiday@group.v.calendar.google.com';

function _isThaiHoliday_(date) {
  try {
    const cal = CalendarApp.getCalendarById(TH_HOLIDAY_CALENDAR_ID);
    if (!cal) return false;
    return cal.getEventsForDay(date).length > 0;
  } catch (e) {
    return false; // เข้าถึงปฏิทินไม่ได้ -> ไม่ถือว่าเป็นวันหยุด (ปลอดภัยกว่าตัดข้อมูลทิ้งผิดวัน)
  }
}

/** true = วันนี้เป็นวันที่เวรเช้านับเป็นภาระงานนอกเวลาราชการ (เสาร์/อาทิตย์/วันหยุดราชการ) */
function _isOffHoursMorningDay_(year, monthIdx, day) {
  const dow = new Date(year, monthIdx, day).getDay(); // 0=อาทิตย์ .. 6=เสาร์ (ไม่ขึ้นกับ timezone)
  if (dow === 0 || dow === 6) return true;
  return _isThaiHoliday_(new Date(year, monthIdx, day, 12, 0, 0));
}

function _emptyShiftCount_() { return { 'เวรเช้า': 0, 'เวรบ่าย': 0, 'เวรดึก': 0 }; }

/** เวรจากเวลาไทย (ตรงกับ logic ฝั่งหน้าเว็บทุกหน้า: 08:30-16:30 / 16:30-00:30 / 00:30-08:30) */
function _shiftFromDate_(d) {
  const hm = Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm').split(':');
  const t = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
  if (t >= 510 && t < 990) return 'เวรเช้า';
  if (t >= 990 || t < 30)  return 'เวรบ่าย';
  return 'เวรดึก';
}

function _dayOfMonth_(d) { return parseInt(Utilities.formatDate(d, 'Asia/Bangkok', 'd'), 10); }
function _inMonth_(d, monthLabel) { return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM') === monthLabel; }

/** แปลง cell timestamp/วันที่/เวลา -> Date (รองรับทั้ง Date object และ string) */
function _parseTsGeneric_(tsCell, dateCell, timeCell) {
  if (tsCell instanceof Date && !isNaN(tsCell)) return tsCell;
  if (typeof tsCell === 'string' && tsCell) {
    const d = new Date(tsCell);
    if (!isNaN(d)) return d;
  }
  const ds = String(dateCell || '');
  if (ds.indexOf('/') !== -1) {
    const p = ds.split('/');
    if (p.length === 3) {
      const iso = p[2] + '-' + p[1] + '-' + p[0] + 'T' + (timeCell || '00:00:00');
      const d2 = new Date(iso);
      if (!isNaN(d2)) return d2;
    }
  }
  return null;
}

function _workloadEquipRowKey_(equip) {
  for (let i = 0; i < WORKLOAD_SERVICE_ROWS.length; i++) {
    const r = WORKLOAD_SERVICE_ROWS[i];
    if (r.equips && r.equips.indexOf(equip) !== -1) return r.key;
  }
  return 'other';
}

/** โครงสร้างแถวทั้งหมดของรายงาน (เรียงตามแบบฟอร์มกระดาษ) */
function _workloadRowDefs_() {
  return WORKLOAD_SERVICE_ROWS.concat([
    { key: 'fixjob',   label: 'แก้ไขปัญหาหน้างาน' },
    { key: 'supplies', label: 'จ่ายวัสดุสำรอง', untracked: true },
    { key: 'ventprep', label: 'เตรียมความพร้อมใช้งานเครื่องช่วยหายใจ' }
  ]);
}

/**
 * คำนวณข้อมูลภาระงานของเดือนที่ระบุ (สด จากข้อมูลจริง)
 * monthLabel: 'YYYY-MM' เช่น '2026-08' (ไม่ระบุ = เดือนปัจจุบัน)
 */
function _computeWorkloadData_(monthLabel) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const now = new Date();
  if (!monthLabel) monthLabel = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');

  const parts = monthLabel.split('-');
  const year = parseInt(parts[0], 10), monthIdx = parseInt(parts[1], 10) - 1;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const monthTH = _thaiMonthYear(new Date(year, monthIdx, 1));

  const rowDefs = _workloadRowDefs_();
  const rowMap = {};
  rowDefs.forEach(def => {
    const byDay = {};
    for (let d = 1; d <= daysInMonth; d++) byDay[d] = _emptyShiftCount_();
    rowMap[def.key] = { key: def.key, label: def.label, untracked: !!def.untracked, byDay: byDay, total: 0 };
  });

  const staffByDay = {};
  for (let d = 1; d <= daysInMonth; d++) {
    staffByDay[d] = { 'เวรเช้า': {}, 'เวรบ่าย': {}, 'เวรดึก': {} };
  }

  // เวรเช้านับเป็นภาระงานนอกเวลาราชการเฉพาะเสาร์/อาทิตย์/วันหยุดราชการ (เวรบ่าย-ดึกนับทุกวัน)
  const offHoursMorning = {};
  for (let d = 1; d <= daysInMonth; d++) offHoursMorning[d] = _isOffHoursMorningDay_(year, monthIdx, d);

  function addCount(key, day, shift) {
    if (!rowMap[key] || day < 1 || day > daysInMonth) return;
    if (shift === 'เวรเช้า' && !offHoursMorning[day]) return; // วันธรรมดา -> เวรเช้าเป็นเวลาราชการปกติ ไม่นับ
    rowMap[key].byDay[day][shift] += 1;
    rowMap[key].total += 1;
  }
  // นับจำนวนครั้งที่แต่ละชื่อ "เตรียมเครื่อง" หรือ "ส่งเครื่อง" ต่อวัน/เวร
  // (ไม่นับชื่อจากแถวคืนเครื่อง/แก้ไขหน้างาน) แล้วเลือกชื่อที่ทำมากที่สุดเป็น "ผู้ปฏิบัติงาน" ของเวรนั้น
  function addStaff(day, shift, name) {
    if (!name || day < 1 || day > daysInMonth) return;
    if (shift === 'เวรเช้า' && !offHoursMorning[day]) return;
    staffByDay[day][shift][name] = (staffByDay[day][shift][name] || 0) + 1;
  }
  function resolveShift(storedShift, ts) {
    return WORKLOAD_SHIFTS.indexOf(storedShift) !== -1 ? storedShift : _shiftFromDate_(ts);
  }

  // 1) Sheet ยืม-คืน: "ยืม" ที่แอดมินนำส่ง (prepare.html deliver mode) -> ให้บริการ
  //                    "คืน" เครื่องช่วยหายใจ -> เตรียมความพร้อมใช้งานเครื่องช่วยหายใจ
  const bSheet = ss.getSheetByName(SHEET_BORROW);
  if (bSheet && bSheet.getLastRow() > 1) {
    const rows = bSheet.getRange(2, 1, bSheet.getLastRow() - 1, 12).getValues();
    rows.forEach(r => {
      const action = String(r[4] || '');
      const equip  = String(r[5] || '');
      const name   = String(r[8] || '');
      const note   = String(r[11] || '');
      const ts = _parseTsGeneric_(r[9], r[1], r[2]);
      if (!ts || !_inMonth_(ts, monthLabel)) return;
      const day   = _dayOfMonth_(ts);
      const shift = resolveShift(String(r[3] || ''), ts);

      if (action.indexOf('ยืม') !== -1 && note.indexOf('เตรียมพร้อมส่ง') === 0) {
        addCount(_workloadEquipRowKey_(equip), day, shift);
        addStaff(day, shift, name);
      } else if (action.indexOf('คืน') !== -1 && VENTILATOR_EQUIPS.indexOf(equip) !== -1) {
        addCount('ventprep', day, shift);
      }
    });
  }

  // 2) Sheet เตรียมเครื่อง: เตรียม/ส่งมอบเครื่องให้หน่วยงาน (ไม่นับรายการที่ยกเลิก) -> ให้บริการ
  const pSheet = ss.getSheetByName(SHEET_PREPARE);
  if (pSheet && pSheet.getLastRow() > 1) {
    const rows = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, PREPARE_COLS.length).getValues();
    rows.forEach(r => {
      const status = String(r[8] || '');
      if (status.indexOf('ยกเลิก') === 0) return;
      const equip = String(r[3] || '');
      const by    = String(r[6] || '');
      const ts = _parseTsGeneric_(r[7], r[1], r[2]);
      if (!ts || !_inMonth_(ts, monthLabel)) return;
      const day   = _dayOfMonth_(ts);
      const shift = _shiftFromDate_(ts); // Sheet เตรียมเครื่องไม่ได้เก็บเวรไว้ -> คำนวณจากเวลา
      addCount(_workloadEquipRowKey_(equip), day, shift);
      addStaff(day, shift, by);
    });
  }

  // 3) Sheet แก้ไขหน้างาน -> แก้ไขปัญหาหน้างาน
  const fSheet = ss.getSheetByName(SHEET_FIXJOB);
  if (fSheet && fSheet.getLastRow() > 1) {
    const rows = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, FIXJOB_COLS.length).getValues();
    rows.forEach(r => {
      const ts = _parseTsGeneric_(r[9], r[1], r[2]);
      if (!ts || !_inMonth_(ts, monthLabel)) return;
      const day   = _dayOfMonth_(ts);
      const shift = _shiftFromDate_(ts);
      addCount('fixjob', day, shift);
    });
  }

  // ผู้ปฏิบัติงานต่อวัน/เวร = ชื่อที่เตรียม/ส่งเครื่องมากที่สุดในเวรนั้น (ตรงกับแบบฟอร์มกระดาษ 1 เวร = 1 ชื่อ)
  const staffOut = {};
  for (let d = 1; d <= daysInMonth; d++) {
    staffOut[d] = {};
    WORKLOAD_SHIFTS.forEach(s => {
      const counts = staffByDay[d][s];
      let topName = '', topCount = 0;
      Object.keys(counts).forEach(name => {
        if (counts[name] > topCount) { topName = name; topCount = counts[name]; }
      });
      staffOut[d][s] = topName;
    });
  }

  // ยอดรวมทุกแถวต่อวัน/เวร
  const rowsOut = rowDefs.map(def => rowMap[def.key]);
  const grandByDay = {};
  let grandTotal = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    grandByDay[d] = _emptyShiftCount_();
    rowsOut.forEach(row => {
      WORKLOAD_SHIFTS.forEach(s => { grandByDay[d][s] += row.byDay[d][s]; });
    });
    grandTotal += WORKLOAD_SHIFTS.reduce((sum, s) => sum + grandByDay[d][s], 0);
  }

  return {
    ok: true,
    month: monthLabel,
    monthTH: monthTH,
    daysInMonth: daysInMonth,
    shifts: WORKLOAD_SHIFTS,
    rows: rowsOut,
    staffByDay: staffOut,
    grandByDay: grandByDay,
    grandTotal: grandTotal,
    offHoursMorning: offHoursMorning, // { day: true/false } เวรเช้านับเฉพาะวันที่ true (เสาร์/อาทิตย์/วันหยุดราชการ)
    isCurrentMonth: monthLabel === Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM'),
    generatedAt: Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')
  };
}

/** ดูภาระงานแบบสด (สำหรับหน้าแดชบอร์ด) — เดือนไหนก็ได้ ไม่ต้องรอสิ้นเดือน */
function getWorkloadCalendar(monthLabel) {
  return _computeWorkloadData_(monthLabel);
}

/**
 * สร้าง/รีเฟรช Sheet รายงานภาระงานของเดือนที่ระบุ ในรูปแบบเดียวกับแบบฟอร์มกระดาษ
 * เรียกได้ทุกเวลา (ไม่ใช่แค่สิ้นเดือน) — เรียกซ้ำจะลบของเก่าแล้วสร้างใหม่ด้วยข้อมูลล่าสุดเสมอ
 * ใช้ร่วมกับ exportReportToPDF(sheetName) เพื่อ export PDF
 */
function generateWorkloadReport(monthLabel) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = _computeWorkloadData_(monthLabel);
  const sheetName = 'Workload_' + data.month.replace('-', '_');

  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sht = ss.insertSheet(sheetName);

  _writeWorkloadSheet_(sht, data);
  _formatWorkloadSheet_(sht, data);

  return {
    ok: true,
    sheetName: sheetName,
    monthTH: data.monthTH,
    grandTotal: data.grandTotal,
    message: 'สร้างรายงานภาระงาน ' + sheetName + ' เรียบร้อยแล้ว'
  };
}

function _writeWorkloadSheet_(sht, d) {
  const N = d.daysInMonth;
  const width = 3 + N + 1; // ลำดับ, ภาระงาน, เวร, วันที่ 1..N, ยอดรวม

  const rows = [];
  rows.push([HOSPITAL_NAME]);
  rows.push(['ภาระงานนอกเวลาราชการ (ศูนย์เครื่องมือแพทย์)']);
  rows.push(['ประจำเดือน ' + d.monthTH + '   |   จัดทำ: ' + d.generatedAt]);
  rows.push([]);

  const headerRow = ['ลำดับ', 'ภาระงาน', 'เวร'];
  for (let day = 1; day <= N; day++) headerRow.push(String(day));
  headerRow.push('ยอดรวม');
  rows.push(headerRow);

  // เวรเช้าของวันธรรมดา (ไม่ใช่เสาร์/อาทิตย์/วันหยุดราชการ) ไม่ใช่ภาระงานนอกเวลาราชการ -> ใส่ "-" แทนเลข 0
  function morningCell(shift, day, v) {
    if (shift === 'เวรเช้า' && !d.offHoursMorning[day]) return '-';
    return v || '';
  }

  d.rows.forEach((row, idx) => {
    const label = row.label + (row.untracked ? ' (ยังไม่มีการบันทึกในระบบ)' : '');
    d.shifts.forEach((shift, si) => {
      const line = [si === 0 ? (idx + 1) : '', si === 0 ? label : '', WORKLOAD_SHIFT_ABBR[shift]];
      let rowTotal = 0;
      for (let day = 1; day <= N; day++) {
        const v = row.byDay[day][shift] || 0;
        rowTotal += v;
        line.push(morningCell(shift, day, v));
      }
      line.push(row.untracked ? '' : rowTotal);
      rows.push(line);
    });
  });

  // ยอดรวม (ทุกแถวรวมกัน)
  d.shifts.forEach((shift, si) => {
    const line = [si === 0 ? '' : '', si === 0 ? 'ยอดรวม' : '', WORKLOAD_SHIFT_ABBR[shift]];
    let rowTotal = 0;
    for (let day = 1; day <= N; day++) {
      const v = d.grandByDay[day][shift] || 0;
      rowTotal += v;
      line.push(morningCell(shift, day, v));
    }
    line.push(rowTotal);
    rows.push(line);
  });

  // ชื่อผู้ปฏิบัติงาน
  d.shifts.forEach((shift, si) => {
    const line = [si === 0 ? '' : '', si === 0 ? 'ชื่อผู้ปฏิบัติงาน' : '', WORKLOAD_SHIFT_ABBR[shift]];
    for (let day = 1; day <= N; day++) {
      if (shift === 'เวรเช้า' && !d.offHoursMorning[day]) { line.push('-'); continue; }
      const name = (d.staffByDay[day] && d.staffByDay[day][shift]) || '';
      line.push(name);
    }
    line.push('');
    rows.push(line);
  });

  const padded = rows.map(r => {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy.slice(0, width);
  });
  sht.getRange(1, 1, padded.length, width).setValues(padded);
}

function _formatWorkloadSheet_(sht, d) {
  const N = d.daysInMonth;
  const width = 3 + N + 1;
  const headerRowIdx = 5;

  // หมายเหตุ: ห้าม merge ข้ามแนวที่ freeze คอลัมน์ไว้ (Sheets จะ error) — แถบหัวรายงาน 3 แถวนี้
  // เลยใส่สีพื้นหลัง/ฟอนต์แบบไม่ merge เซลล์ ข้อความจะอยู่ชิดซ้ายในคอลัมน์ A แทนการจัดกึ่งกลางเต็มแถว
  sht.getRange(1, 1, 1, width)
     .setFontSize(14).setFontWeight('bold')
     .setBackground('#0A6478').setFontColor('#FFFFFF');
  sht.getRange(2, 1, 1, width)
     .setFontSize(12).setFontWeight('bold')
     .setBackground('#0E7D94').setFontColor('#FFFFFF');
  sht.getRange(3, 1, 1, width)
     .setFontSize(10).setFontColor('#6A8A96');
  sht.getRange(1, 1, 3, 1).setHorizontalAlignment('left');

  sht.getRange(headerRowIdx, 1, 1, width)
     .setFontWeight('bold').setBackground('#DAF0F5').setHorizontalAlignment('center');

  sht.setColumnWidth(1, 36);
  sht.setColumnWidth(2, 230);
  sht.setColumnWidth(3, 28);
  for (let c = 4; c <= 3 + N; c++) sht.setColumnWidth(c, 24);
  sht.setColumnWidth(3 + N + 1, 60);

  const lastRow = sht.getLastRow();
  sht.getRange(4, 1, lastRow - 3, width)
     .setFontFamily('Sarabun, Arial')
     .setVerticalAlignment('middle')
     .setHorizontalAlignment('center');
  sht.getRange(1, 1, 3, width).setFontFamily('Sarabun, Arial').setVerticalAlignment('middle');
  sht.getRange(headerRowIdx + 1, 2, lastRow - headerRowIdx, 1).setHorizontalAlignment('left');

  sht.setFrozenRows(headerRowIdx);
  sht.setFrozenColumns(3);

  // รวมช่องลำดับ+ภาระงาน ให้ครอบ 3 แถวเวร (ช/บ/ด) ของแต่ละกลุ่ม — merge นี้อยู่ในคอลัมน์ 1-2
  // ซึ่งอยู่ในขอบเขต freeze คอลัมน์ (1-3) ทั้งหมด จึงไม่ชนกับ frozen columns
  const groupCount = d.rows.length + 2; // + ยอดรวม + ชื่อผู้ปฏิบัติงาน
  for (let g = 0; g < groupCount; g++) {
    const startRow = headerRowIdx + 1 + g * 3;
    sht.getRange(startRow, 1, 3, 1).merge().setVerticalAlignment('middle');
    sht.getRange(startRow, 2, 3, 1).merge().setVerticalAlignment('middle').setFontWeight('bold');
  }

  sht.getRange(lastRow - 5, 1, 3, width).setBackground('#FFF3CD'); // ยอดรวม
  sht.getRange(lastRow - 2, 1, 3, width).setBackground('#F0F0F0'); // ชื่อผู้ปฏิบัติงาน
}
