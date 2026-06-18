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
    const data = JSON.parse(e.postData.contents);
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
      'ประเภท (ยืม/คืน)', 'ชื่อเครื่อง', 'หมายเลขเครื่อง',
      'ตึก/Ward', 'ชื่อผู้ยืม', 'Timestamp (ISO)'
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
    data.shift        || '',
    data.action       || '',
    data.equipment    || '',
    data.equipmentNumber || '',
    data.ward         || '',
    data.name         || '',
    data.timestamp    || now.toISOString()
  ]);

  // color row by action
  const lastRow = sheet.getLastRow();
  const isBorrow = (data.action || '').includes('ยืม');
  sheet.getRange(lastRow, 1, 1, 10)
       .setBackground(isBorrow ? '#DCF2E5' : '#FDEAEA');

  return { row: rowNumber, timestamp: now.toISOString() };
}

// ============================================================
// getRecords — ดึงรายการล่าสุด
// ============================================================
function getRecords(limit, offset, filter) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true, total: 0, records: [] };

  const headers = sheet.getRange(1, 1, 1, 10).getValues()[0];
  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10);
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
    headers.forEach((h, i) => { obj[h] = row[i]; });
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

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
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

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();

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
// Helpers
// ============================================================
function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function formatHeader(sheet) {
  const header = sheet.getRange(1, 1, 1, 10);
  header.setBackground('#0A6478')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
  sheet.setColumnWidths(1, 10, 120);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 80);
}

function jsonResponse(obj, code) {
  const output = ContentService.createTextOutput(JSON.stringify(obj))
                               .setMimeType(ContentService.MimeType.JSON);
  // Google Apps Script ไม่รองรับ HTTP status code โดยตรง
  // CORS headers จะถูกเพิ่มโดย GAS อัตโนมัติเมื่อ deploy เป็น Web App
  return output;
}
