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
const SPREADSHEET_ID = '1Ju2STRjjFaC4ZjuTNAjsrDEyvW6cBM42Yt5NsXALgtg';
const SHEET_BORROW   = 'ยืม-คืน';
const SHEET_SUMMARY  = 'สรุปรายวัน';
const SHEET_ASSETS   = 'ครุภัณฑ์_C2';

// ============================================================
// doPost — รับข้อมูลจาก frontend
// ============================================================
function doPost(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter || {};
    }

    if (data.action === 'delete') {
      deleteRecord(parseInt(data.rowIndex, 10));
      return jsonResponse({ ok: true });
    }

    if (data.action === 'deleteBulk') {
      deleteBulkRecords(data.rowIndexes || []);
      return jsonResponse({ ok: true });
    }

    if (data.action === 'edit') {
      editRecord(parseInt(data.rowIndex, 10), data.fields || {});
      return jsonResponse({ ok: true });
    }

    if (data.action === 'saveAsset') {
      saveAsset(data.fields || {});
      return jsonResponse({ ok: true });
    }

    if (data.action === 'editAsset') {
      editAsset(parseInt(data.rowIndex, 10), data.fields || {});
      return jsonResponse({ ok: true });
    }

    if (data.action === 'deleteAsset') {
      deleteAsset(parseInt(data.rowIndex, 10));
      return jsonResponse({ ok: true });
    }

    const result = saveRecord(data);
    return jsonResponse({ ok: true, id: result.row, timestamp: result.timestamp });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

// ============================================================
// editRecord — แก้ไขข้อมูลในแถวที่ระบุ
// ============================================================
function editRecord(sheetRow, fields) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_BORROW);

  // คอลัมน์ที่สามารถแก้ไขได้ (index เริ่มจาก 1)
  // col 4: เวร, col 7: หมายเลขเครื่อง, col 8: ตึก/Ward,
  // col 9: ชื่อผู้บันทึก, col 11: สถานะ Round, col 12: หมายเหตุ
  if (fields.shift       !== undefined && fields.shift       !== null) sheet.getRange(sheetRow, 4).setValue(fields.shift);
  if (fields.ward        !== undefined && fields.ward        !== null) sheet.getRange(sheetRow, 8).setValue(fields.ward);
  if (fields.name        !== undefined && fields.name        !== null) sheet.getRange(sheetRow, 9).setValue(fields.name);
  if (fields.roundStatus !== undefined && fields.roundStatus !== null) sheet.getRange(sheetRow, 11).setValue(fields.roundStatus);
  if (fields.note        !== undefined && fields.note        !== null) sheet.getRange(sheetRow, 12).setValue(fields.note);
}

// ============================================================
// deleteRecord — ลบแถวเดียว
// ============================================================
function deleteRecord(sheetRow) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_BORROW);
  sheet.deleteRow(sheetRow);
}

// ============================================================
// deleteBulkRecords — ลบหลายแถวพร้อมกัน
// ต้องเรียงจากมากไปน้อย (bottom→top) เพื่อไม่ให้เลข row เลื่อน
// ============================================================
function deleteBulkRecords(rowIndexes) {
  if (!rowIndexes || rowIndexes.length === 0) return;
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_BORROW);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_BORROW);

  // เรียง descending เพื่อลบจากล่างขึ้นบน
  const sorted = rowIndexes
    .map(i => parseInt(i, 10))
    .filter(i => i >= 2)
    .sort((a, b) => b - a);

  sorted.forEach(row => sheet.deleteRow(row));
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

    if (action === 'monthlyReport') {
      return jsonResponse(generateMonthlyReport());
    }

    if (action === 'exportPDF') {
      return jsonResponse(exportReportToPDF(e.parameter.sheetName || ''));
    }

    if (action === 'execSummary') {
      return jsonResponse(generateExecutiveSummary());
    }

    if (action === 'assets') {
      return jsonResponse(getAssets());
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

  // แนบ rowIndex จริง (เลขแถวใน Sheet = index+2 เพราะ header อยู่แถว 1)
  let indexed = rows.map((row, i) => ({ row, sheetRow: i + 2 }));

  // กรองข้อมูล
  if (filter) {
    const f = filter.toLowerCase();
    indexed = indexed.filter(({ row: r }) =>
      r.some(cell => String(cell).toLowerCase().includes(f))
    );
  }

  // เรียงจากใหม่ไปเก่า
  indexed.reverse();

  const total = indexed.length;
  const paged = indexed.slice(offset, offset + limit);

  const records = paged.map(({ row, sheetRow }) => {
    const obj = { _rowIndex: sheetRow };
    COLS.forEach((h, i) => {
      let val = row[i];
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

// ============================================================
// ASSET MANAGEMENT — ทะเบียนครุภัณฑ์ C2
// ============================================================
const ASSET_COLS = ['No.', 'เลขครุภัณฑ์', 'S/N', 'ID', 'ประเภท', 'สถานะ', 'หมายเหตุ', 'อัปเดตล่าสุด'];

function getOrCreateAssetSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_ASSETS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ASSETS);
    sheet.appendRow(ASSET_COLS);
    sheet.setFrozenRows(1);
    const h = sheet.getRange(1, 1, 1, ASSET_COLS.length);
    h.setBackground('#0A6478').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidths(1, ASSET_COLS.length, 130);
    initAssetData(sheet);
  }
  return sheet;
}

function initAssetData(sheet) {
  const INIT = [
    [1,'6515-003-2101-14/53',1835,103981,'Infusion Pump','จำหน่าย','จำหน่าย'],
    [2,'6515-003-2102-33/58',8658,114722,'Infusion Pump','ใช้งานได้',''],
    [3,'6515-003-2102-34/58',8688,114723,'Infusion Pump','ใช้งานได้',''],
    [4,'6515-003-2102-35/58',8656,114724,'Infusion Pump','ใช้งานได้',''],
    [5,'6515-003-2102-36/58',8650,114725,'Infusion Pump','ใช้งานได้',''],
    [6,'6515-003-2102-37/58',8676,114726,'Infusion Pump','ใช้งานได้',''],
    [7,'6515-003-2102-38/58',8670,114727,'Infusion Pump','ใช้งานได้',''],
    [8,'6515-003-2102-39/58',8651,114728,'Infusion Pump','ใช้งานได้',''],
    [9,'6515-003-2102-40/58',8662,114749,'Infusion Pump','ใช้งานได้',''],
    [10,'6515-003-2102-41/58',8679,114730,'Infusion Pump','ใช้งานได้',''],
    [11,'6515-003-2102-43/58',10280,124980,'Infusion Pump','ใช้งานได้',''],
    [12,'6515-003-2102-44/58',10158,124981,'Infusion Pump','ใช้งานได้',''],
    [13,'6515-003-2102-45/58',10204,124982,'Infusion Pump','ใช้งานได้',''],
    [14,'6515-003-2102-46/58',10207,124983,'Infusion Pump','ใช้งานได้',''],
    [15,'6515-003-2102-47/58',10288,124984,'Infusion Pump','ใช้งานได้',''],
    [16,'6515-003-2102-48/58',10271,124985,'Infusion Pump','ใช้งานได้',''],
    [17,'6515-003-2102-49/58',10275,124986,'Infusion Pump','ใช้งานได้',''],
    [18,'6515-003-2102-50/58',10277,124987,'Infusion Pump','ใช้งานได้',''],
    [19,'6515-003-2102-51/58',10205,124988,'Infusion Pump','ใช้งานได้',''],
    [20,'6515-003-2102-52/58',10198,124989,'Infusion Pump','ใช้งานได้',''],
    [21,'6515-003-2102-53/58',10188,124990,'Infusion Pump','ใช้งานได้',''],
    [22,'6515-003-2102-54/58',10235,124992,'Infusion Pump','ใช้งานได้',''],
    [23,'6515-003-2102-55/58',10191,124993,'Infusion Pump','ใช้งานได้',''],
    [24,'6515-003-2102-58/59',10284,127000,'Infusion Pump','ใช้งานได้',''],
    [25,'6515-003-2102-59/59',10266,127001,'Infusion Pump','ใช้งานได้',''],
    [26,'6515-026-2201-35/59',11228,130646,'Infusion Pump','ใช้งานได้',''],
    [27,'6515-026-2001-36/59',11477,130647,'Infusion Pump','ใช้งานได้',''],
    [28,'6515-026-2001-37/59',11479,130648,'Infusion Pump','ใช้งานได้',''],
    [29,'6515-026-2001-38/59',11537,130649,'Infusion Pump','ใช้งานได้',''],
    [30,'6515-026-2001-39/59',11495,130650,'Infusion Pump','ใช้งานได้',''],
    [31,'6515-026-2001-24/55',1748,119965,'Infusion Pump','จำหน่าย','จำหน่าย'],
    [32,'6515-026-2001-25/55',1300,114756,'Infusion Pump','จำหน่าย','จำหน่าย'],
    [33,'6515-026-2001-40/60',12030,132537,'Infusion Pump','ใช้งานได้',''],
    [34,'6515-026-2001-41/60',12039,132538,'Infusion Pump','ใช้งานได้',''],
    [35,'6515-026-2001-42/60',12053,132539,'Infusion Pump','ใช้งานได้',''],
    [36,'6515-003-2102-60/60',12057,133131,'Infusion Pump','ใช้งานได้',''],
    [37,'6515-026-2001-43/62',13365,136296,'Infusion Pump','ใช้งานได้',''],
    [38,'6515-026-2001-44/62',13364,136853,'Infusion Pump','ใช้งานได้',''],
    [39,'6515-003-2102-88/63',13845,138310,'Infusion Pump','ใช้งานได้',''],
    [40,'6515-003-2102-89/63',13851,138311,'Infusion Pump','ใช้งานได้',''],
    [41,'6515-003-2102-90/63',13856,138312,'Infusion Pump','ใช้งานได้',''],
    [42,'6515-003-2102-91/63',13848,138313,'Infusion Pump','ใช้งานได้',''],
    [43,'6515-003-2102-92/63',12871,138314,'Infusion Pump','ใช้งานได้',''],
    [44,'6515-003-2102-98/64',10387,139526,'Infusion Pump','ใช้งานได้',''],
    [45,'6515-003-2102-99/64',10487,139527,'Infusion Pump','ใช้งานได้',''],
    [46,'6515-003-2102-100/64',10497,139528,'Infusion Pump','ใช้งานได้',''],
    [47,'6515-003-2102-101/64',10492,139529,'Infusion Pump','ใช้งานได้',''],
    [48,'6515-003-2102-102/64',13263,142508,'Infusion Pump','ใช้งานได้',''],
    [49,'6515-003-2102-113/67','',150143,'Infusion Pump','ใช้งานได้',''],
    [50,'6515-003-2102-114/67',17827,150751,'Infusion Pump','ใช้งานได้',''],
    [51,'6515-003-2102-115/67',17828,150752,'Infusion Pump','ใช้งานได้',''],
    [52,'6515-003-2102-116/67',17829,150753,'Infusion Pump','ใช้งานได้',''],
    [53,'6515-003-2102-200/68','',155175,'Infusion Pump','ใช้งานได้',''],
    [54,'6515-003-2102-201/68','',155185,'Infusion Pump','ใช้งานได้',''],
    [55,'6515-003-2102-202/68','',155191,'Infusion Pump','ใช้งานได้',''],
    [56,'6515-003-2102-203/68','',155192,'Infusion Pump','ใช้งานได้',''],
    [57,'6515-003-2102-204/68','',155193,'Infusion Pump','ใช้งานได้',''],
    [58,'6515-003-2102-207/69','',157180,'Infusion Pump','ใช้งานได้',''],
  ];
  const ts = new Date().toISOString();
  INIT.forEach(r => sheet.appendRow([...r, ts]));
}

function getAssets() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateAssetSheet(ss);
  if (sheet.getLastRow() <= 1) return { ok: true, assets: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ASSET_COLS.length).getValues();
  const assets = rows
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 };
      ASSET_COLS.forEach((h, j) => { obj[h] = row[j] instanceof Date ? row[j].toISOString() : row[j]; });
      return obj;
    })
    .filter(a => a['No.'] !== '' && a['No.'] !== null);

  assets.sort((a, b) => (Number(a['No.']) || 0) - (Number(b['No.']) || 0));
  return { ok: true, assets };
}

function saveAsset(fields) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateAssetSheet(ss);
  const ts    = new Date().toISOString();
  sheet.appendRow([
    fields.no || '', fields.asset || '', fields.sn || '', fields.id || '',
    fields.type || 'Infusion Pump', fields.status || 'ใช้งานได้',
    fields.note || '', ts
  ]);
}

function editAsset(sheetRow, fields) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ASSETS);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_ASSETS);

  if (fields.no     != null) sheet.getRange(sheetRow, 1).setValue(fields.no);
  if (fields.asset  != null) sheet.getRange(sheetRow, 2).setValue(fields.asset);
  if (fields.sn     != null) sheet.getRange(sheetRow, 3).setValue(fields.sn);
  if (fields.id     != null) sheet.getRange(sheetRow, 4).setValue(fields.id);
  if (fields.type   != null) sheet.getRange(sheetRow, 5).setValue(fields.type);
  if (fields.status != null) sheet.getRange(sheetRow, 6).setValue(fields.status);
  if (fields.note   != null) sheet.getRange(sheetRow, 7).setValue(fields.note);
  sheet.getRange(sheetRow, 8).setValue(new Date().toISOString());
}

function deleteAsset(sheetRow) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ASSETS);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_ASSETS);
  sheet.deleteRow(sheetRow);
}
