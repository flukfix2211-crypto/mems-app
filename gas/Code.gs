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
const SHEET_ASSETS   = 'ครุภัณฑ์_C2';
const SHEET_FIXJOB   = 'แก้ไขหน้างาน';
const SHEET_SUPPLY   = 'จ่ายวัสดุ';
const FIXJOB_PHOTO_FOLDER = 'MEMs - แก้ไขหน้างาน';

// ============================================================
// Telegram — แจ้งเตือนยืม/คืน
// ตั้งค่า token/chat id ผ่าน Script Properties (ปลอดภัยกว่าเขียนในโค้ด):
//   Apps Script editor -> ⚙️ Project Settings -> Script Properties -> Add property
//   TELEGRAM_TOKEN   = โทเคนบอทจาก @BotFather
//   TELEGRAM_CHAT_ID = chat id ของกลุ่ม/แชท
// หรือรันฟังก์ชัน setupTelegram('โทเคน','chatId') หนึ่งครั้งจาก Apps Script editor
// ============================================================
const THAI_TZ = 'Asia/Bangkok';

function setupTelegram(token, chatId) {
  PropertiesService.getScriptProperties().setProperties({
    TELEGRAM_TOKEN: token,
    TELEGRAM_CHAT_ID: chatId
  });
}

function getTelegramConfig_() {
  const p = PropertiesService.getScriptProperties();
  return { token: p.getProperty('TELEGRAM_TOKEN'), chatId: p.getProperty('TELEGRAM_CHAT_ID') };
}

function sendTelegramMessage_(text) {
  const { token, chatId } = getTelegramConfig_();
  if (!token || !chatId) return { ok: false, statusCode: null, body: 'ยังไม่ได้ตั้งค่า Telegram' }; // ยังไม่ได้ตั้งค่า -> ข้าม ไม่ทำให้การบันทึกล้มเหลว
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const payload = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  return { ok: code === 200, statusCode: code, body: code === 200 ? '' : res.getContentText() };
}

function escHTML_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notifyBorrowReturn_(data, now) {
  const action = data.action || '';
  const isBorrow = action.includes('ยืม');
  const isReturn = action.includes('คืน');
  if (!isBorrow && !isReturn) return; // แจ้งเฉพาะยืม/คืน ไม่แจ้ง Round

  const statusLabel = isBorrow ? 'ยืม' : 'คืน';
  const dateStr = Utilities.formatDate(now, THAI_TZ, 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, THAI_TZ, 'HH:mm:ss');

  let msg = '📢 มีการ <b>' + escHTML_(statusLabel) + '</b> เครื่องมือ: <b>' + escHTML_(data.equipment || '') + '</b>\n';
  msg += '📅 วันที่: ' + escHTML_(dateStr + '  เวลา ' + timeStr) + '\n\n';
  msg += '🔹 <b>หมายเลขเครื่อง</b>: ' + escHTML_(data.equipmentNumber || '') + '\n';
  msg += '🔹 <b>ตึก/Ward</b>: ' + escHTML_(data.ward || '') + '\n';
  msg += '🔹 <b>ผู้บันทึก</b>: ' + escHTML_(data.name || '') + '\n';
  msg += '🔹 <b>เวร</b>: ' + escHTML_(data.shift || '') + '\n';
  if (data.note) msg += '🔹 <b>หมายเหตุ</b>: ' + escHTML_(data.note) + '\n';

  if ((data.equipment || '').toUpperCase().trim() === 'C2' && isBorrow) {
    const changeDate = new Date(now);
    changeDate.setDate(changeDate.getDate() + 14);
    msg += '\n⚡️ <b>วันที่เปลี่ยน Circuit:</b> ' + escHTML_(Utilities.formatDate(changeDate, THAI_TZ, 'dd/MM/yyyy'));
  }

  try { sendTelegramMessage_(msg); } catch (e) { /* ไม่ให้กระทบการบันทึกหลัก */ }
}

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

    if (data.action === 'savePrepare') {
      savePrepare(data.fields || {});
      return jsonResponse({ ok: true });
    }

    if (data.action === 'deletePrepare') {
      deletePrepare(parseInt(data.rowIndex, 10));
      return jsonResponse({ ok: true });
    }
    if (data.action === 'cancelPrepare') {
      cancelPrepare(parseInt(data.rowIndex, 10), data.reason || '');
      return jsonResponse({ ok: true });
    }

    if (data.action === 'saveSupply') {
      saveSupply(data.fields || {});
      return jsonResponse({ ok: true });
    }
    if (data.action === 'cancelSupply') {
      cancelSupply(parseInt(data.rowIndex, 10), data.reason || '');
      return jsonResponse({ ok: true });
    }

    if (data.action === 'saveFixJob') {
      saveFixJob(data.fields || {});
      return jsonResponse({ ok: true });
    }

    if (data.action === 'deleteFixJob') {
      deleteFixJob(parseInt(data.rowIndex, 10));
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
      const equipment = e.parameter.equipment || 'C2';
      return jsonResponse(getRoundHistory(ward, equipment));
    }

    if (action === 'c2status') {
      return jsonResponse(getC2Status());
    }

    if (action === 'sendDigestNow') {
      return jsonResponse(sendAlertDigestManual());
    }

    if (action === 'monthlyReport') {
      return jsonResponse(generateMonthlyReport());
    }

    if (action === 'exportPDF') {
      return jsonResponse(exportReportToPDF(e.parameter.sheetName || ''));
    }

    if (action === 'workloadCalendar') {
      return jsonResponse(getWorkloadCalendar(e.parameter.month || ''));
    }

    if (action === 'workloadReport') {
      return jsonResponse(generateWorkloadReport(e.parameter.month || ''));
    }

    if (action === 'execSummary') {
      return jsonResponse(generateExecutiveSummary());
    }

    if (action === 'c2Report') {
      return jsonResponse(generateC2Report());
    }

    if (action === 'prepareList') {
      return jsonResponse(getPrepareList());
    }

    if (action === 'prepareHistory') {
      return jsonResponse(getPrepareHistory());
    }

    if (action === 'supplyList') {
      return jsonResponse(getSupplyList());
    }

    if (action === 'assets') {
      return jsonResponse(getAssets());
    }

    if (action === 'fixJobTopics') {
      return jsonResponse(getFixJobTopics());
    }

    if (action === 'fixJobList') {
      return jsonResponse(getFixJobList());
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
  const isRound    = (data.action || '').includes('Round');
  const isTransfer = (data.action || '').includes('ย้าย');
  const isBorrow   = (data.action || '').includes('ยืม');
  const bg = isRound ? '#DAF0F5' : isTransfer ? '#FFF3D6' : isBorrow ? '#DCF2E5' : '#FDEAEA';
  sheet.getRange(lastRow, 1, 1, 12).setBackground(bg);

  // ถ้าเป็นการยืม -> เครื่องที่ถูกเตรียมไว้ให้หายจากรายการเตรียม
  if (isBorrow) {
    try { markPreparedUsed(data.equipment || '', data.equipmentNumber || ''); } catch (e) {}
  }

  notifyBorrowReturn_(data, now);

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
    if (action.includes('ยืม'))       byDate[date].borrow++;
    else if (action.includes('คืน'))  byDate[date].return++;
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
    const ts     = r[9] instanceof Date ? Utilities.formatDate(r[9], THAI_TZ, 'dd/MM/yyyy HH:mm:ss') : String(r[9]);
    const key    = `${equip}__${num}`;
    // เก็บแถวล่าสุด (rows เรียงจากเก่าไปใหม่)
    statusMap[key] = {
      equipment: equip,
      number: num,
      lastAction: action,
      ward,
      borrowedBy: name,
      lastUpdate: ts,
      isBorrowed: action.includes('ยืม') || action.includes('ย้าย')
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
// Daily Alert Digest — สรุปยืมเกินกำหนด (C2) + ใกล้หมด ส่ง Telegram ทุกเช้า
// เงื่อนไขเดียวกับ computeAlerts() ฝั่ง dashboard.html
// ============================================================
const DIGEST_OVERDUE_C2_DAYS = 14;
const DIGEST_SHORTAGE_MAX = 2;

function parseThaiTimestamp_(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}

function computeDailyAlerts_() {
  const status = getEquipmentStatus().equipment || [];
  const now = new Date();

  const overdue = status
    .filter(e => e.isBorrowed && e.equipment.includes('C2'))
    .map(e => {
      const dt = parseThaiTimestamp_(e.lastUpdate);
      const days = dt ? Math.floor((now - dt) / 86400000) : null;
      return { number: e.number, ward: e.ward, days };
    })
    .filter(e => e.days !== null && e.days >= DIGEST_OVERDUE_C2_DAYS)
    .sort((a, b) => b.days - a.days);

  const availByType = {};
  status.forEach(e => {
    if (!e.equipment) return; // ข้ามแถวที่ไม่มีชื่อเครื่อง (ข้อมูลไม่สมบูรณ์)
    if (!(e.equipment in availByType)) availByType[e.equipment] = 0;
    if (!e.isBorrowed) availByType[e.equipment]++;
  });
  const shortage = Object.keys(availByType)
    .filter(eq => availByType[eq] <= DIGEST_SHORTAGE_MAX)
    .map(eq => ({ equipment: eq, available: availByType[eq] }))
    .sort((a, b) => a.available - b.available);

  return { overdue, shortage };
}

function buildAlertDigestMessage_(overdue, shortage, opts) {
  opts = opts || {};
  const dateStr = Utilities.formatDate(new Date(), THAI_TZ, 'dd/MM/yyyy');
  let msg = (opts.test ? '🧪 <b>ทดสอบระบบแจ้งเตือน</b>\n' : '') +
    '📋 <b>สรุปแจ้งเตือนประจำวัน ' + escHTML_(dateStr) + '</b>\n';

  if (overdue.length) {
    msg += '\n⏰ <b>ยืมเกินกำหนด (C2 ≥' + DIGEST_OVERDUE_C2_DAYS + ' วัน)</b>\n';
    overdue.forEach(o => {
      msg += '• C2 No.' + escHTML_(o.number) + ' ตึก ' + escHTML_(o.ward || '—') + ' — ยืมมาแล้ว ' + o.days + ' วัน\n';
    });
  }

  if (shortage.length) {
    msg += '\n⚠️ <b>ใกล้หมด (เหลือ ≤' + DIGEST_SHORTAGE_MAX + ' เครื่อง)</b>\n';
    shortage.forEach(s => {
      msg += '• ' + escHTML_(s.equipment) + ' — เหลือว่าง ' + s.available + ' เครื่อง\n';
    });
  }

  if (!overdue.length && !shortage.length) msg += '\n✅ ไม่มีรายการยืมเกินกำหนดหรือใกล้หมด';

  return msg;
}

function sendDailyAlertDigest_() {
  const { overdue, shortage } = computeDailyAlerts_();
  if (!overdue.length && !shortage.length) return; // ไม่มีอะไรผิดปกติ -> ไม่ส่ง กันสแปมทุกเช้า
  const msg = buildAlertDigestMessage_(overdue, shortage);
  try { sendTelegramMessage_(msg); } catch (e) { /* ไม่ให้กระทบ trigger รอบถัดไป */ }
}

// เรียกจาก doGet action=sendDigestNow — ปุ่ม "ส่งแจ้งเตือนตอนนี้" ใน admin_report.html
// ส่งข้อความสรุปจริง (รูปแบบเดียวกับที่ trigger 08:00 ส่งอัตโนมัติ) ทันทีตามคำสั่งผู้ใช้
// ถ้าไม่มี alert อะไรเลยจะไม่ส่ง (เหมือน sendDailyAlertDigest_) แต่รายงานกลับให้รู้ว่าไม่ได้ส่งเพราะอะไร
function sendAlertDigestManual() {
  const { overdue, shortage } = computeDailyAlerts_();
  const { token, chatId } = getTelegramConfig_();
  const configured = !!(token && chatId);

  if (!overdue.length && !shortage.length) {
    return {
      ok: true, configured, sent: false, skipped: true,
      statusCode: null, errorDetail: '',
      overdueCount: 0, shortageCount: 0, message: ''
    };
  }

  const message = buildAlertDigestMessage_(overdue, shortage);
  let sendResult = { ok: false, statusCode: null, body: 'ยังไม่ได้ตั้งค่า Telegram' };
  if (configured) {
    try { sendResult = sendTelegramMessage_(message); }
    catch (e) { sendResult = { ok: false, statusCode: null, body: e.message }; }
  }
  return {
    ok: true,
    configured,
    sent: sendResult.ok,
    skipped: false,
    statusCode: sendResult.statusCode,
    errorDetail: sendResult.ok ? '' : sendResult.body,
    overdueCount: overdue.length,
    shortageCount: shortage.length,
    message
  };
}

// รันฟังก์ชันนี้ "ครั้งเดียว" จาก Apps Script editor เพื่อผูก time-driven trigger (ทุกวัน 08:00 น.)
// ต้องตั้งค่า Telegram ด้วย setupTelegram('โทเคน','chatId') ก่อน ไม่งั้นจะไม่มีอะไรถูกส่ง
function setupDailyDigestTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendDailyAlertDigest_')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendDailyAlertDigest_')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone(THAI_TZ)
    .create();
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
    if (isNaN(n) || n < 1 || n > 58) return;
    const stillBorrowed = action.includes('ยืม') || action.includes('ย้าย');
    statusMap[num] = {
      number:     num,
      isBorrowed: stillBorrowed,
      ward:       stillBorrowed ? ward : '',
      borrowedBy: stillBorrowed ? name : '',
      lastUpdate: ts instanceof Date
        ? Utilities.formatDate(ts, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')
        : String(ts)
    };
  });

  return { ok: true, units: buildC2Units(statusMap) };
}

function buildC2Units(statusMap) {
  const units = [];
  for (let i = 1; i <= 58; i++) {
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
    [1,'6515-003-2101-14/53',1835,103981,'C2','จำหน่าย','จำหน่าย'],
    [2,'6515-003-2102-33/58',8658,114722,'C2','ใช้งานได้',''],
    [3,'6515-003-2102-34/58',8688,114723,'C2','ใช้งานได้',''],
    [4,'6515-003-2102-35/58',8656,114724,'C2','ใช้งานได้',''],
    [5,'6515-003-2102-36/58',8650,114725,'C2','ใช้งานได้',''],
    [6,'6515-003-2102-37/58',8676,114726,'C2','ใช้งานได้',''],
    [7,'6515-003-2102-38/58',8670,114727,'C2','ใช้งานได้',''],
    [8,'6515-003-2102-39/58',8651,114728,'C2','ใช้งานได้',''],
    [9,'6515-003-2102-40/58',8662,114749,'C2','ใช้งานได้',''],
    [10,'6515-003-2102-41/58',8679,114730,'C2','ใช้งานได้',''],
    [11,'6515-003-2102-43/58',10280,124980,'C2','ใช้งานได้',''],
    [12,'6515-003-2102-44/58',10158,124981,'C2','ใช้งานได้',''],
    [13,'6515-003-2102-45/58',10204,124982,'C2','ใช้งานได้',''],
    [14,'6515-003-2102-46/58',10207,124983,'C2','ใช้งานได้',''],
    [15,'6515-003-2102-47/58',10288,124984,'C2','ใช้งานได้',''],
    [16,'6515-003-2102-48/58',10271,124985,'C2','ใช้งานได้',''],
    [17,'6515-003-2102-49/58',10275,124986,'C2','ใช้งานได้',''],
    [18,'6515-003-2102-50/58',10277,124987,'C2','ใช้งานได้',''],
    [19,'6515-003-2102-51/58',10205,124988,'C2','ใช้งานได้',''],
    [20,'6515-003-2102-52/58',10198,124989,'C2','ใช้งานได้',''],
    [21,'6515-003-2102-53/58',10188,124990,'C2','ใช้งานได้',''],
    [22,'6515-003-2102-54/58',10235,124992,'C2','ใช้งานได้',''],
    [23,'6515-003-2102-55/58',10191,124993,'C2','ใช้งานได้',''],
    [24,'6515-003-2102-58/59',10284,127000,'C2','ใช้งานได้',''],
    [25,'6515-003-2102-59/59',10266,127001,'C2','ใช้งานได้',''],
    [26,'6515-026-2201-35/59',11228,130646,'C2','ใช้งานได้',''],
    [27,'6515-026-2001-36/59',11477,130647,'C2','ใช้งานได้',''],
    [28,'6515-026-2001-37/59',11479,130648,'C2','ใช้งานได้',''],
    [29,'6515-026-2001-38/59',11537,130649,'C2','ใช้งานได้',''],
    [30,'6515-026-2001-39/59',11495,130650,'C2','ใช้งานได้',''],
    [31,'6515-026-2001-24/55',1748,119965,'C2','จำหน่าย','จำหน่าย'],
    [32,'6515-026-2001-25/55',1300,114756,'C2','จำหน่าย','จำหน่าย'],
    [33,'6515-026-2001-40/60',12030,132537,'C2','ใช้งานได้',''],
    [34,'6515-026-2001-41/60',12039,132538,'C2','ใช้งานได้',''],
    [35,'6515-026-2001-42/60',12053,132539,'C2','ใช้งานได้',''],
    [36,'6515-003-2102-60/60',12057,133131,'C2','ใช้งานได้',''],
    [37,'6515-026-2001-43/62',13365,136296,'C2','ใช้งานได้',''],
    [38,'6515-026-2001-44/62',13364,136853,'C2','ใช้งานได้',''],
    [39,'6515-003-2102-88/63',13845,138310,'C2','ใช้งานได้',''],
    [40,'6515-003-2102-89/63',13851,138311,'C2','ใช้งานได้',''],
    [41,'6515-003-2102-90/63',13856,138312,'C2','ใช้งานได้',''],
    [42,'6515-003-2102-91/63',13848,138313,'C2','ใช้งานได้',''],
    [43,'6515-003-2102-92/63',12871,138314,'C2','ใช้งานได้',''],
    [44,'6515-003-2102-98/64',10387,139526,'C2','ใช้งานได้',''],
    [45,'6515-003-2102-99/64',10487,139527,'C2','ใช้งานได้',''],
    [46,'6515-003-2102-100/64',10497,139528,'C2','ใช้งานได้',''],
    [47,'6515-003-2102-101/64',10492,139529,'C2','ใช้งานได้',''],
    [48,'6515-003-2102-102/64',13263,142508,'C2','ใช้งานได้',''],
    [49,'6515-003-2102-113/67','',150143,'C2','ใช้งานได้',''],
    [50,'6515-003-2102-114/67',17827,150751,'C2','ใช้งานได้',''],
    [51,'6515-003-2102-115/67',17828,150752,'C2','ใช้งานได้',''],
    [52,'6515-003-2102-116/67',17829,150753,'C2','ใช้งานได้',''],
    [53,'6515-003-2102-200/68','',155175,'C2','ใช้งานได้',''],
    [54,'6515-003-2102-201/68','',155185,'C2','ใช้งานได้',''],
    [55,'6515-003-2102-202/68','',155191,'C2','ใช้งานได้',''],
    [56,'6515-003-2102-203/68','',155192,'C2','ใช้งานได้',''],
    [57,'6515-003-2102-204/68','',155193,'C2','ใช้งานได้',''],
    [58,'6515-003-2102-207/69','',157180,'C2','ใช้งานได้',''],
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
    fields.type || 'C2', fields.status || 'ใช้งานได้',
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

// รันครั้งเดียวเพื่อเปลี่ยนประเภทเก่าทั้งหมดเป็น C2
function migrateAssetTypes() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ASSETS);
  if (!sheet || sheet.getLastRow() <= 1) return;
  const rows = sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).getValues();
  rows.forEach((row, i) => {
    const val = String(row[0]);
    if (val === 'Infusion Pump C2' || val === 'Infusion Pump' || val === '') {
      sheet.getRange(i + 2, 5).setValue('C2');
    }
  });
  Logger.log('เปลี่ยนประเภทเสร็จแล้ว');
}

// ============================================================
// PREPARE — เตรียมเครื่องมือ (ฝั่งแอดมิน)
// ============================================================
const SHEET_PREPARE   = 'เตรียมเครื่อง';
const PREPARE_COLS = ['ลำดับ', 'วันที่', 'เวลา', 'ประเภท', 'หมายเลข', 'ตึก/Ward', 'ผู้เตรียม', 'Timestamp', 'สถานะ'];

/** แปลง timestamp -> { date: 'd ม.ค. 2569', time: 'HH:mm:ss' } (เวลาไทย) */
function _fmtThaiDateTime(cellTs) {
  let d = (cellTs instanceof Date) ? cellTs : new Date(String(cellTs));
  if (isNaN(d)) return { date: '', time: '' };
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const day  = Utilities.formatDate(d, 'Asia/Bangkok', 'd');
  const mon  = parseInt(Utilities.formatDate(d, 'Asia/Bangkok', 'M'), 10) - 1;
  const year = parseInt(Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy'), 10) + 543;
  const time = Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm:ss');
  return { date: day + ' ' + months[mon] + ' ' + year, time: time };
}

function getOrCreatePrepareSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_PREPARE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PREPARE);
    sheet.appendRow(PREPARE_COLS);
    sheet.setFrozenRows(1);
    const h = sheet.getRange(1, 1, 1, PREPARE_COLS.length);
    h.setBackground('#0A6478').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidths(1, PREPARE_COLS.length, 120);
  }
  return sheet;
}

function savePrepare(fields) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreatePrepareSheet(ss);
  const now   = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm:ss');
  const equip   = fields.equipment || '';
  const ward    = fields.ward || '';
  const by      = fields.preparedBy || '';
  const numbers = Array.isArray(fields.numbers) ? fields.numbers : [fields.numbers];

  numbers.filter(n => String(n).trim() !== '').forEach(num => {
    const rowNumber = sheet.getLastRow();
    sheet.appendRow([
      rowNumber, dateStr, timeStr, equip, String(num).trim(),
      ward, by, now.toISOString(), 'เตรียม'
    ]);
    sheet.getRange(sheet.getLastRow(), 1, 1, PREPARE_COLS.length).setBackground('#FFF3CD');
  });
}

function getPrepareList() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreatePrepareSheet(ss);
  if (sheet.getLastRow() <= 1) return { ok: true, prepared: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PREPARE_COLS.length).getValues();
  const prepared = [];
  rows.forEach((r, i) => {
    if (String(r[8]) !== 'เตรียม') return; // เฉพาะที่ยังเตรียมอยู่
    const dt = _fmtThaiDateTime(r[7] || r[1]);
    prepared.push({
      _rowIndex: i + 2,
      date:      dt.date,
      time:      dt.time,
      equipment: String(r[3]),
      number:    String(r[4]),
      ward:      String(r[5]),
      preparedBy: String(r[6])
    });
  });
  return { ok: true, prepared };
}

/** ประวัติการเตรียมทั้งหมด (รวมที่ยืมแล้ว) — ใหม่ไปเก่า */
function getPrepareHistory() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreatePrepareSheet(ss);
  if (sheet.getLastRow() <= 1) return { ok: true, history: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PREPARE_COLS.length).getValues();
  const history = rows.map((r, i) => {
    const dt = _fmtThaiDateTime(r[7] || r[1]);
    return {
      _rowIndex: i + 2,
      date:      dt.date,
      time:      dt.time,
      equipment: String(r[3]),
      number:    String(r[4]),
      ward:      String(r[5]),
      preparedBy: String(r[6]),
      timestamp: String(r[7]),
      status:    String(r[8])
    };
  });
  history.reverse(); // ใหม่ไปเก่า
  return { ok: true, history };
}

function deletePrepare(sheetRow) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PREPARE);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_PREPARE);
  sheet.deleteRow(sheetRow);
}

/** ยกเลิกรายการเตรียม พร้อมหมายเหตุ (เก็บไว้ในประวัติ ไม่ลบทิ้ง) */
function cancelPrepare(sheetRow, reason) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PREPARE);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_PREPARE);
  const r = String(reason || '').trim();
  sheet.getRange(sheetRow, 9).setValue('ยกเลิก' + (r ? ': ' + r : ''));
  sheet.getRange(sheetRow, 1, 1, PREPARE_COLS.length).setBackground('#FDEAEA');
}

/** ทำเครื่องหมายว่าเครื่องที่เตรียมไว้ถูกยืมแล้ว (หายจากรายการเตรียม) */
function markPreparedUsed(equipment, number) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PREPARE);
  if (!sheet || sheet.getLastRow() <= 1) return;
  const equip = String(equipment).trim();
  const num   = String(number).trim();
  if (!equip || !num) return;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PREPARE_COLS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[8]) === 'เตรียม' && String(r[3]).trim() === equip && String(r[4]).trim() === num) {
      const row = i + 2;
      sheet.getRange(row, 9).setValue('ยืมแล้ว');
      sheet.getRange(row, 1, 1, PREPARE_COLS.length).setBackground('#DCF2E5');
    }
  }
}

// ============================================================
// SUPPLY — จ่ายวัสดุสำรอง (Cuff BP ผู้ใหญ่/เด็ก/คนอ้วน ฯลฯ — ไม่ผูกหมายเลขครุภัณฑ์)
// ============================================================
const SUPPLY_COLS = ['ลำดับ', 'วันที่', 'เวลา', 'รายการ', 'จำนวน', 'ตึก/Ward', 'ผู้จ่าย', 'Timestamp', 'สถานะ'];

function getOrCreateSupplySheet(ss) {
  let sheet = ss.getSheetByName(SHEET_SUPPLY);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SUPPLY);
    sheet.appendRow(SUPPLY_COLS);
    sheet.setFrozenRows(1);
    const h = sheet.getRange(1, 1, 1, SUPPLY_COLS.length);
    h.setBackground('#0A6478').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidths(1, SUPPLY_COLS.length, 120);
  }
  return sheet;
}

function saveSupply(fields) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSupplySheet(ss);
  const now   = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm:ss');
  const item  = fields.item || '';
  const qty   = fields.qty || '';
  const ward  = fields.ward || '';
  const by    = fields.dispensedBy || '';

  const rowNumber = sheet.getLastRow();
  sheet.appendRow([rowNumber, dateStr, timeStr, item, String(qty).trim(), ward, by, now.toISOString(), 'จ่ายแล้ว']);
  sheet.getRange(sheet.getLastRow(), 1, 1, SUPPLY_COLS.length).setBackground('#FFF3CD');
}

/** รายการจ่ายวัสดุล่าสุด (ไม่รวมที่ยกเลิก) — ใหม่ไปเก่า */
function getSupplyList() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSupplySheet(ss);
  if (sheet.getLastRow() <= 1) return { ok: true, supplied: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SUPPLY_COLS.length).getValues();
  const supplied = [];
  rows.forEach((r, i) => {
    if (String(r[8]).indexOf('ยกเลิก') === 0) return;
    const dt = _fmtThaiDateTime(r[7] || r[1]);
    supplied.push({
      _rowIndex: i + 2,
      date:        dt.date,
      time:        dt.time,
      item:        String(r[3]),
      qty:         String(r[4]),
      ward:        String(r[5]),
      dispensedBy: String(r[6])
    });
  });
  supplied.reverse();
  return { ok: true, supplied: supplied.slice(0, 30) };
}

/** ยกเลิกรายการจ่ายวัสดุ พร้อมหมายเหตุ (เก็บไว้ในประวัติ ไม่ลบทิ้ง) */
function cancelSupply(sheetRow, reason) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SUPPLY);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_SUPPLY);
  const r = String(reason || '').trim();
  sheet.getRange(sheetRow, 9).setValue('ยกเลิก' + (r ? ': ' + r : ''));
  sheet.getRange(sheetRow, 1, 1, SUPPLY_COLS.length).setBackground('#FDEAEA');
}

// ============================================================
// FIXJOB — แก้ไขหน้างาน (บันทึกการออกไปแก้ไขปัญหาที่หน่วยงาน)
// ============================================================
const FIXJOB_COLS = ['ลำดับ', 'วันที่', 'เวลา', 'หน่วยงาน', 'เรื่องที่แก้ไข', 'รายละเอียดงาน',
  'วิธีแก้ไข', 'ผู้ปฏิบัติ', 'รูปภาพ', 'Timestamp'];

function getOrCreateFixJobSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_FIXJOB);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_FIXJOB);
    sheet.appendRow(FIXJOB_COLS);
    sheet.setFrozenRows(1);
    const h = sheet.getRange(1, 1, 1, FIXJOB_COLS.length);
    h.setBackground('#0A6478').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidths(1, FIXJOB_COLS.length, 120);
  }
  return sheet;
}

/** อัปโหลดรูปภาพ (base64) ขึ้น Drive แล้วคืน array ของ URL */
function _uploadFixJobPhotos(images) {
  if (!images || !images.length) return [];
  const folder = _getOrCreateFolder(FIXJOB_PHOTO_FOLDER);
  const urls = [];
  images.forEach((img, i) => {
    if (!img || !img.data) return;
    try {
      const blob = Utilities.newBlob(Utilities.base64Decode(img.data), img.mimeType || 'image/jpeg',
        img.name || ('fixjob_' + Date.now() + '_' + i + '.jpg'));
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push(file.getUrl());
    } catch (e) { /* รูปเสีย/อัปโหลดไม่สำเร็จ -> ข้ามรูปนี้ ไม่ให้กระทบการบันทึกหลัก */ }
  });
  return urls;
}

function saveFixJob(fields) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateFixJobSheet(ss);
  const now   = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm:ss');

  const photoUrls = _uploadFixJobPhotos(fields.images);

  sheet.appendRow([
    sheet.getLastRow(), dateStr, timeStr,
    fields.ward || '', fields.topic || '', fields.detail || '', fields.solution || '',
    fields.staff || '', photoUrls.join(', '), now.toISOString()
  ]);
}

/** รายการหัวข้อ "เรื่องที่แก้ไข" ที่เคยบันทึกไว้ (distinct, เรียงตามตัวอักษร) */
function getFixJobTopics() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateFixJobSheet(ss);
  if (sheet.getLastRow() <= 1) return { ok: true, topics: [] };

  const rows = sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).getValues();
  const set = new Set();
  rows.forEach(r => { const t = String(r[0]).trim(); if (t) set.add(t); });
  return { ok: true, topics: Array.from(set).sort((a, b) => a.localeCompare(b, 'th')) };
}

/** ประวัติการแก้ไขหน้างานล่าสุด — ใหม่ไปเก่า */
function getFixJobList() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateFixJobSheet(ss);
  if (sheet.getLastRow() <= 1) return { ok: true, items: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, FIXJOB_COLS.length).getValues();
  const items = rows.map((r, i) => {
    const dt = _fmtThaiDateTime(r[9] || r[1]);
    return {
      _rowIndex: i + 2,
      date:     dt.date,
      time:     dt.time,
      ward:     String(r[3]),
      topic:    String(r[4]),
      detail:   String(r[5]),
      solution: String(r[6]),
      staff:    String(r[7]),
      photos:   String(r[8] || '').split(',').map(s => s.trim()).filter(Boolean)
    };
  });
  items.reverse();
  return { ok: true, items };
}

function deleteFixJob(sheetRow) {
  if (!sheetRow || sheetRow < 2) throw new Error('rowIndex ไม่ถูกต้อง');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_FIXJOB);
  if (!sheet) throw new Error('ไม่พบ Sheet: ' + SHEET_FIXJOB);
  sheet.deleteRow(sheetRow);
}

/** ฟังก์ชันทดสอบ Telegram — รันเองจาก Apps Script editor เพื่อตรวจสอบว่าตั้งค่าถูกต้องไหม */
function testTelegramNotify() {
  const cfg = getTelegramConfig_();
  Logger.log('TOKEN ที่อ่านได้: ' + (cfg.token ? cfg.token.substring(0, 10) + '...(มีค่า)' : 'ว่างเปล่า/ไม่มี'));
  Logger.log('CHAT_ID ที่อ่านได้: ' + (cfg.chatId || 'ว่างเปล่า/ไม่มี'));

  if (!cfg.token || !cfg.chatId) {
    Logger.log('❌ ยังไม่ได้ตั้งค่า Script Properties ถูกต้อง กรุณาเช็คชื่อ property ให้ตรง TELEGRAM_TOKEN และ TELEGRAM_CHAT_ID');
    return;
  }

  const url = 'https://api.telegram.org/bot' + cfg.token + '/sendMessage';
  const payload = { chat_id: cfg.chatId, text: 'ทดสอบระบบแจ้งเตือน MEMs ✅', parse_mode: 'HTML' };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  Logger.log('Telegram ตอบกลับ: ' + res.getResponseCode() + ' ' + res.getContentText());
}
