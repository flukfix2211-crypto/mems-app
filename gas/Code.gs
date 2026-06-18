/**
 * MEMs — Medical Equipment Management Systems
 * Google Apps Script Backend
 *
 * วิธีติดตั้ง:
 * 1. ไปที่ script.google.com สร้าง project ใหม่
 * 2. วางโค้ดนี้ใน Code.gs
 * 3. สร้าง Google Sheets ใหม่ คัดลอก Spreadsheet ID จาก URL
 * 4. ใส่ SPREADSHEET_ID ด้านล่าง
 * 5. Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. คัดลอก Web app URL ไปใส่ใน index.html (ตัวแปร SCRIPT_URL)
 */

// ============================================================
// CONFIG — ใส่ Spreadsheet ID ของคุณ
// ============================================================
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
const SHEET_BORROW   = 'ยืม-คืน';   // sheet สำหรับบันทึกรายการยืม/คืน
const SHEET_SUMMARY  = 'สรุปรายวัน'; // sheet สรุปรายวัน (สร้างอัตโนมัติ)

// ============================================================
// doPost — รับข้อมูลจาก frontend
// ============================================================
function doPost(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      // fallback: form-encoded (e.parameter)
      data = e.parameter || {};
    }
    const result = saveRecord(data);
    return jsonResponse({ ok: true, id: result.row, timestamp: result.timestamp });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

// ============================================================
// doGet — dashboard API สำหรับดูข้อมูล
// ============================================================
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'records';

  try {
    if (action === 'records') {
      const limit  = parseInt(e.parameter.limit  || '50');
      const offset = parseInt(e.parameter.offset || '0');
      const filter = e.parameter.filter || '';
      return jsonResponse(getRecords(limit, offset, filter));
    }

    if (action === 'summary') {
      return jsonResponse(getSummary());
    }

    if (action === 'equipment') {
      return jsonResponse(getEquipmentStatus());
    }

    if (action === 'roundHistory') {
      const ward      = e.parameter.ward      || '';
      const equipment = e.parameter.equipment || 'Infusion Pump';
      return jsonResponse(getRoundHistory(ward, equipment));
    }

    if (action === 'c2status') {
      return jsonResponse(getC2Status());
    }

    return jsonResponse({ ok: false, error: 'unknown action' }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

// ============================================================
// saveRecord — บันทึก 1 รายการลง Sheet
// ============================================================
function saveRecord(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, SHEET_BORROW);

  // สร้าง header ถ้ายังไม่มี
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ลำดับ', 'วันที่', 'เวลา', 'เวร',
      'ประเภท (ยืม/คืน/Round)', 'ชื่อเครื่อง', 'หมายเลขเครื่อง',
      'ตึก/Ward', 'ชื่อผู้บันทึก', 'Timestamp (ISO)',
      'สถานะ Round', 'หมายเหตุ'
    ]);
    sheet.setFrozenRows(1);
    formatHeader(sheet);
  }

  const now       = new Date();
  const dateStr   = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy');
  const timeStr   = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm:ss');
  const rowNumber = sheet.getLastRow(); // ลำดับ = แถวสุดท้าย (ไม่นับ header)

  sheet.appendRow([
    rowNumber,
    dateStr,
    timeStr,
    data.shift           || '',
    data.action          || '',
    data.equipment       || '',
    data.equipmentNumber || '',
    data.ward            || '',
    data.name            || '',
    data.timestamp       || now.toISOString(),
    data.roundStatus     || '',   // col 11: สถานะ Round (ปกติ/ชำรุด/สูญหาย)
    data.note            || ''    // col 12: หมายเหตุ
  ]);

  // color row by action
  const lastRow = sheet.getLastRow();
  const isRound  = (data.action || '').includes('Round');
  const isBorrow = (data.action || '').includes('ยืม');
  const bg = isRound ? '#DAF0F5' : isBorrow ? '#DCF2E5' : '#FDEAEA';
  sheet.getRange(lastRow, 1, 1, 12).setBackground(bg);

  return { row: rowNumber, timestamp: now.toISOString() };
}

// ============================================================
// getRecords — ดึงรายการล่าสุด
// ============================================================
function getRecords(limit, offset, filter) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true, total: 0, records: [] };

  // ใช้ชื่อคอลัมน์ fixed เพื่อรองรับ sheet เดิมที่ header ยังไม่ครบ 12 คอลัมน์
  const COLS = [
    'ลำดับ','วันที่','เวลา','เวร',
    'ประเภท (ยืม/คืน)','ชื่อเครื่อง','หมายเลขเครื่อง',
    'ตึก/Ward','ชื่อผู้ยืม','Timestamp (ISO)',
    'สถานะ Round','หมายเหตุ'
  ];
  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12);
  let rows = dataRange.getValues();

  // กรองข้อมูล
  if (filter) {
    const f = filter.toLowerCase();
    rows = rows.filter(r =>
      r.some(cell => String(cell).toLowerCase().includes(f))
    );
  }

  // เรียงจากใหม่ไปเก่า
  rows.reverse();

  const total = rows.length;
  const paged = rows.slice(offset, offset + limit);

  const records = paged.map(row => {
    const obj = {};
    COLS.forEach((h, i) => {
      let val = row[i];
      // แปลง Date object → string ในรูปแบบที่ใช้งานได้
      if (val instanceof Date) {
        if (h === 'วันที่') {
          val = Utilities.formatDate(val, 'Asia/Bangkok', 'dd/MM/yyyy');
        } else if (h === 'เวลา') {
          val = Utilities.formatDate(val, 'Asia/Bangkok', 'HH:mm:ss');
        } else {
          val = Utilities.formatDate(val, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
        }
      }
      obj[h] = val;
    });
    return obj;
  });

  return { ok: true, total, limit, offset, records };
}

// ============================================================
// getSummary — สรุปรายการแต่ละวัน
// ============================================================
function getSummary() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true, summary: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  const byDate = {};

  rows.forEach(r => {
    const date   = String(r[1]);
    const action = String(r[4]);
    const equip  = String(r[5]);
    const ward   = String(r[7]);
    if (!byDate[date]) byDate[date] = { date, borrow: 0, return: 0, wards: {}, equipments: {} };
    if (action.includes('ยืม')) byDate[date].borrow++;
    else                        byDate[date].return++;
    byDate[date].wards[ward]  = (byDate[date].wards[ward]  || 0) + 1;
    byDate[date].equipments[equip] = (byDate[date].equipments[equip] || 0) + 1;
  });

  const summary = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  return { ok: true, summary };
}

// ============================================================
// getEquipmentStatus — สถานะเครื่องปัจจุบัน (ยืมอยู่/ว่าง)
// ============================================================
function getEquipmentStatus() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true, equipment: {} };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();

  // คำนวณสถานะล่าสุดของแต่ละหมายเลขเครื่อง
  const statusMap = {};
  rows.forEach(r => {
    const equip  = String(r[5]);
    const num    = String(r[6]);
    const action = String(r[4]);
    const ward   = String(r[7]);
    const name   = String(r[8]);
    const ts     = String(r[9]);
    const key    = `${equip}__${num}`;
    // เก็บแถวล่าสุด (rows เรียงจากเก่าไปใหม่)
    statusMap[key] = {
      equipment: equip,
      number: num,
      lastAction: action,
      ward,
      borrowedBy: name,
      lastUpdate: ts,
      isBorrowed: action.includes('ยืม')
    };
  });

  return { ok: true, equipment: Object.values(statusMap) };
}

// ============================================================
// getRoundHistory — สถานะล่าสุดของเครื่องใน ward นั้น (Round เท่านั้น)
// ============================================================
function getRoundHistory(ward, equipmentType) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true, machines: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();

  // เก็บ record ล่าสุดของแต่ละหมายเลขเครื่องใน ward นี้
  const map = {};
  rows.forEach(r => {
    const action  = String(r[4]);
    const equip   = String(r[5]);
    const num     = String(r[6]);
    const w       = String(r[7]);
    const date    = String(r[1]);
    const time    = String(r[2]);
    const status  = String(r[10]);

    if (!action.includes('Round')) return;
    if (equipmentType && !equip.includes(equipmentType)) return;
    if (ward && w !== ward) return;

    // rows เรียงเก่า→ใหม่ ดังนั้นเขียนทับได้เรื่อยๆ เพื่อเก็บล่าสุด
    map[num] = { number: num, lastStatus: status, lastDate: date, lastTime: time };
  });

  const machines = Object.values(map).filter(m => m.number && m.number !== '');
  return { ok: true, ward, equipment: equipmentType, machines };
}

// ============================================================
// Helpers
// ============================================================
function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function formatHeader(sheet) {
  const header = sheet.getRange(1, 1, 1, 12);
  header.setBackground('#0A6478')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
  sheet.setColumnWidths(1, 12, 120);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 80);
}

function jsonResponse(obj) {
  // GAS เพิ่ม Access-Control-Allow-Origin: * อัตโนมัติเมื่อ deploy แบบ "Anyone"
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function getC2Status() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true, units: buildC2Units({}) };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  const statusMap = {};

  rows.forEach(r => {
    const equip  = String(r[5]);
    const num    = String(r[6]);
    const action = String(r[4]);
    const ward   = String(r[7]);
    const name   = String(r[8]);
    let   ts     = r[9];
    if (!equip.includes('C2')) return;
    const n = parseInt(num, 10);
    if (isNaN(n) || n < 1 || n > 60) return;
    statusMap[num] = {
      number:     num,
      isBorrowed: action.includes('ยืม'),
      ward:       action.includes('ยืม') ? ward : '',
      borrowedBy: action.includes('ยืม') ? name : '',
      lastUpdate: ts instanceof Date
        ? Utilities.formatDate(ts, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')
        : String(ts)
    };
  });

  return { ok: true, units: buildC2Units(statusMap) };
}

function buildC2Units(statusMap) {
  const units = [];
  for (let i = 1; i <= 60; i++) {
    const key = String(i);
    units.push(statusMap[key] || { number: key, isBorrowed: false, ward: '', borrowedBy: '', lastUpdate: '' });
  }
  return units;
}
