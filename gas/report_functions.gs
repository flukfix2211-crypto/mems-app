/**
 * MEMs - ฟังก์ชันสร้างรายงานประจำเดือน
 * เพิ่มเติมลงใน Code.gs เดิม (อยู่ในโปรเจกต์เดียวกัน)
 */

// ============================================================
// CONFIG
// ============================================================
// SPREADSHEET_ID และ SHEET_BORROW ถูกกำหนดแล้วใน Code.gs
// ไฟล์นี้ใช้ตัวแปรเหล่านั้นร่วมกันโดยอัตโนมัติ

const DRIVE_FOLDER_NAME = 'MEMs_Reports';
const HOSPITAL_NAME     = 'โรงพยาบาลพหลพลพยุหเสนา จ.กาญจนบุรี';

// ============================================================
// 1. generateMonthlyReport()
//    สร้างสรุปรายงานของเดือนที่แล้วลง Sheet ใหม่
// ============================================================
function generateMonthlyReport() {
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  const src    = ss.getSheetByName(SHEET_BORROW);
  if (!src || src.getLastRow() <= 1) {
    return { ok: false, error: 'ไม่มีข้อมูลใน Sheet ยืม-คืน' };
  }

  // กำหนดช่วงเวลา: เดือนที่แล้ว
  const now      = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMonth  = new Date(firstOfThisMonth - 1); // วันสุดท้ายของเดือนที่แล้ว

  const monthLabel = Utilities.formatDate(firstOfLastMonth, 'Asia/Bangkok', 'yyyy_MM');
  const monthTH    = _thaiMonthYear(firstOfLastMonth);
  const sheetName  = 'Monthly_Report_' + monthLabel;

  // ถ้า Sheet นี้มีอยู่แล้ว -> ลบทิ้งแล้วสร้างใหม่
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const rpt = ss.insertSheet(sheetName);

  // ดึงข้อมูลดิบ
  const raw = src.getRange(2, 1, src.getLastRow() - 1, 12).getValues();

  // กรองเฉพาะรายการ ยืม/คืน ในเดือนที่แล้ว (ไม่รวม Round)
  const rows = raw.filter(r => {
    const action = String(r[4]);
    if (!action.includes('ยืม') && !action.includes('คืน')) return false;
    const ts = _parseRowTimestamp(r);
    return ts >= firstOfLastMonth && ts <= lastOfLastMonth;
  });

  const borrowRows = rows.filter(r => String(r[4]).includes('ยืม'));
  const returnRows = rows.filter(r => String(r[4]).includes('คืน'));

  //  a) จำนวนการยืมแต่ละประเภทเครื่อง 
  const equipCount = {};
  borrowRows.forEach(r => {
    const e = String(r[5]) || 'ไม่ระบุ';
    equipCount[e] = (equipCount[e] || 0) + 1;
  });
  const equipRanked = Object.entries(equipCount).sort((a, b) => b[1] - a[1]);

  //  b) Top 5 หอผู้ป่วยที่ยืมมากสุด 
  const wardCount = {};
  borrowRows.forEach(r => {
    const w = String(r[7]) || 'ไม่ระบุ';
    wardCount[w] = (wardCount[w] || 0) + 1;
  });
  const wardTop5 = Object.entries(wardCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  //  c) อัตราการใช้งาน (Utilization Rate) 
  // นิยาม: (จำนวนครั้งที่ยืม / จำนวนวันในเดือน) ต่อหน่วยเครื่อง
  const daysInMonth = lastOfLastMonth.getDate();
  const utilization = equipRanked.map(([equip, cnt]) => {
    const rate = (cnt / daysInMonth).toFixed(2);
    return [equip, cnt, daysInMonth, rate];
  });

  //  d) ระยะเวลายืมเฉลี่ย (วัน) 
  const avgDays = _calcAvgBorrowDays(borrowRows, returnRows);

  //  เขียนลง Sheet 
  _writeReportSheet(rpt, {
    monthTH, sheetName, monthLabel,
    total: borrowRows.length,
    totalReturn: returnRows.length,
    equipRanked, wardTop5, utilization, avgDays,
    daysInMonth,
    generatedAt: Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')
  });

  // จัดรูปแบบ
  _formatReportSheet(rpt);

  return {
    ok: true,
    sheetName,
    monthTH,
    totalBorrow: borrowRows.length,
    totalReturn: returnRows.length,
    message: 'สร้างรายงาน ' + sheetName + ' เรียบร้อยแล้ว'
  };
}

// ============================================================
// 2. exportReportToPDF()
//    สร้าง export URL ของ Sheet (ไม่ใช้ DriveApp / UrlFetchApp)
//    เบราว์เซอร์ผู้ใช้เปิด/ดาวน์โหลด PDF เอง -> ไม่ต้องขอ scope พิเศษ
// ============================================================
function exportReportToPDF(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ถ้าไม่ระบุ sheetName -> ใช้รายงานล่าสุดที่พบ
  if (!sheetName) {
    const sheets = ss.getSheets();
    const rptSheets = sheets
      .filter(s => s.getName().startsWith('Monthly_Report_'))
      .sort((a, b) => b.getName().localeCompare(a.getName()));
    if (rptSheets.length === 0) {
      return { ok: false, error: 'ไม่พบ Sheet รายงาน กรุณาสร้างรายงานก่อน' };
    }
    sheetName = rptSheets[0].getName();
  }

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { ok: false, error: 'ไม่พบ Sheet: ' + sheetName };

  const pdfUrl = _pdfExportUrl(ss, sheet);

  return {
    ok: true,
    fileName: sheetName + '.pdf',
    sheetName: sheetName,
    viewUrl: pdfUrl,
    fileUrl: pdfUrl,
    message: 'เปิด / ดาวน์โหลด PDF ได้เลย'
  };
}

// ============================================================
// 3. generateExecutiveSummary()
//    สรุปสำหรับผู้บริหาร 1 หน้า
// ============================================================
function generateExecutiveSummary() {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const src = ss.getSheetByName(SHEET_BORROW);
  if (!src || src.getLastRow() <= 1) {
    return { ok: false, error: 'ไม่มีข้อมูลใน Sheet ยืม-คืน' };
  }

  const now            = new Date();
  const firstOfMonth   = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMo  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMo   = new Date(firstOfMonth - 1);
  const monthTH        = _thaiMonthYear(firstOfLastMo);

  const raw = src.getRange(2, 1, src.getLastRow() - 1, 12).getValues();

  // เดือนที่แล้ว
  const lastMoRows = raw.filter(r => {
    const ts = _parseRowTimestamp(r);
    return ts >= firstOfLastMo && ts <= lastOfLastMo;
  });
  const borrowLast  = lastMoRows.filter(r => String(r[4]).includes('ยืม'));
  const returnLast  = lastMoRows.filter(r => String(r[4]).includes('คืน'));

  // เดือนนี้ (MTD)
  const thisMonthRows = raw.filter(r => {
    const ts = _parseRowTimestamp(r);
    return ts >= firstOfMonth && ts <= now;
  });
  const borrowThis = thisMonthRows.filter(r => String(r[4]).includes('ยืม'));

  // อุปกรณ์ที่ใช้มากสุด
  const ec = {};
  borrowLast.forEach(r => { const e = String(r[5]); ec[e] = (ec[e]||0)+1; });
  const topEquip = Object.entries(ec).sort((a,b)=>b[1]-a[1])[0] || ['ไม่มีข้อมูล',0];

  // หอที่ยืมมากสุด
  const wc = {};
  borrowLast.forEach(r => { const w = String(r[7]); wc[w] = (wc[w]||0)+1; });
  const topWard = Object.entries(wc).sort((a,b)=>b[1]-a[1])[0] || ['ไม่มีข้อมูล',0];

  // เครื่องที่ยังไม่คืน (ณ ปัจจุบัน)
  const statusMap = {};
  raw.forEach(r => {
    const e = String(r[5]), n = String(r[6]), a = String(r[4]);
    if (!e || !n) return;
    statusMap[e+'__'+n] = a.includes('ยืม');
  });
  const stillBorrowed = Object.values(statusMap).filter(Boolean).length;

  // สร้าง Sheet สรุป
  const sName    = 'ExecSummary_' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy_MM');
  const existing = ss.getSheetByName(sName);
  if (existing) ss.deleteSheet(existing);
  const sht = ss.insertSheet(sName);

  _writeExecSheet(sht, {
    monthTH,
    generatedAt: Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm'),
    totalBorrowLastMonth:  borrowLast.length,
    totalReturnLastMonth:  returnLast.length,
    stillBorrowed,
    topEquipName:  topEquip[0],
    topEquipCount: topEquip[1],
    topWardName:   topWard[0],
    topWardCount:  topWard[1],
    borrowThisMonthMTD: borrowThis.length
  });

  _formatExecSheet(sht);

  return {
    ok: true,
    sheetName: sName,
    monthTH,
    totalBorrow: borrowLast.length,
    stillBorrowed,
    topEquip: topEquip[0],
    topWard: topWard[0],
    message: 'สร้างสรุปผู้บริหาร ' + sName + ' เรียบร้อยแล้ว'
  };
}

// ============================================================
// INTERNAL: เขียน Sheet รายงานประจำเดือน
// ============================================================
function _writeReportSheet(sht, d) {
  const rows = [];

  //  หัวรายงาน 
  rows.push([HOSPITAL_NAME, '', '', '', '']);
  rows.push(['รายงานประจำเดือน ' + d.monthTH, '', '', '', '']);
  rows.push(['วันที่พิมพ์: ' + d.generatedAt, '', '', '', '']);
  rows.push(['', '', '', '', '']);

  //  สรุปภาพรวม 
  rows.push(['ภาพรวมการยืม-คืน', '', '', '', '']);
  rows.push(['รายการยืมทั้งหมด', d.total + ' ครั้ง', '', '', '']);
  rows.push(['รายการคืนทั้งหมด', d.totalReturn + ' ครั้ง', '', '', '']);
  rows.push(['จำนวนวันในเดือน', d.daysInMonth + ' วัน', '', '', '']);
  rows.push(['', '', '', '', '']);

  //  a) จำนวนการยืมตามประเภทเครื่อง 
  rows.push(['ก) อุปกรณ์ที่ถูกยืม (จัดอันดับมากไปน้อย)', '', '', '', '']);
  rows.push(['อันดับ', 'ประเภทเครื่อง', 'จำนวนครั้ง', 'สัดส่วน (%)', '']);
  d.equipRanked.forEach(([equip, cnt], i) => {
    const pct = d.total > 0 ? ((cnt / d.total) * 100).toFixed(1) : '0.0';
    rows.push([i + 1, equip, cnt, pct + '%', '']);
  });
  rows.push(['', '', '', '', '']);

  //  b) Top 5 หอผู้ป่วย 
  rows.push(['ข) หน่วยงานที่ยืมมากที่สุด 5 อันดับแรก', '', '', '', '']);
  rows.push(['อันดับ', 'หน่วยงาน', 'จำนวนครั้ง', '', '']);
  d.wardTop5.forEach(([ward, cnt], i) => {
    rows.push([i + 1, ward, cnt, '', '']);
  });
  rows.push(['', '', '', '', '']);

  //  c) Utilization Rate 
  rows.push(['ค) อัตราการใช้งานเฉลี่ยต่อวัน (Utilization Rate)', '', '', '', '']);
  rows.push(['ประเภทเครื่อง', 'ยืมทั้งเดือน (ครั้ง)', 'จำนวนวัน', 'เฉลี่ย (ครั้ง/วัน)', '']);
  d.utilization.forEach(([equip, cnt, days, rate]) => {
    rows.push([equip, cnt, days, rate, '']);
  });
  rows.push(['', '', '', '', '']);

  //  d) ระยะเวลายืมเฉลี่ย 
  rows.push(['ง) ระยะเวลายืมเฉลี่ย', '', '', '', '']);
  if (d.avgDays.length === 0) {
    rows.push(['ไม่สามารถคำนวณได้ (ต้องการข้อมูลคืนที่ตรงกัน)', '', '', '', '']);
  } else {
    rows.push(['ประเภทเครื่อง', 'ระยะเวลาเฉลี่ย (วัน)', 'จำนวนคู่ที่คำนวณได้', '', '']);
    d.avgDays.forEach(([equip, avg, count]) => {
      rows.push([equip, avg, count + ' คู่', '', '']);
    });
  }

  // เขียนลง Sheet
  sht.getRange(1, 1, rows.length, 5).setValues(rows);
}

function _formatReportSheet(sht) {
  // หัวรายงาน
  sht.getRange(1, 1, 1, 5).merge()
     .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center')
     .setBackground('#0A6478').setFontColor('#FFFFFF');
  sht.getRange(2, 1, 1, 5).merge()
     .setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center')
     .setBackground('#0E7D94').setFontColor('#FFFFFF');
  sht.getRange(3, 1, 1, 5).merge()
     .setFontSize(10).setHorizontalAlignment('center').setFontColor('#6A8A96');

  // ปรับความกว้างคอลัมน์
  sht.setColumnWidth(1, 60);
  sht.setColumnWidth(2, 220);
  sht.setColumnWidth(3, 120);
  sht.setColumnWidth(4, 140);
  sht.setColumnWidth(5, 80);

  // ตั้งค่า font ทั้ง sheet
  sht.getRange(1, 1, sht.getLastRow(), 5)
     .setFontFamily('Sarabun, Arial')
     .setVerticalAlignment('middle');

  // freeze header
  sht.setFrozenRows(3);
}

// ============================================================
// INTERNAL: เขียน Sheet Executive Summary
// ============================================================
function _writeExecSheet(sht, d) {
  const rows = [
    [HOSPITAL_NAME],
    ['สรุปผู้บริหาร - ' + d.monthTH],
    ['จัดทำ: ' + d.generatedAt],
    [''],
    ['=================================='],
    ['ภาพรวมเดือนที่ผ่านมา'],
    ['=================================='],
    [''],
    ['จำนวนการยืมทั้งหมด', d.totalBorrowLastMonth + ' ครั้ง'],
    ['จำนวนการคืนทั้งหมด', d.totalReturnLastMonth + ' ครั้ง'],
    ['เครื่องที่ยังค้างอยู่ ณ ปัจจุบัน', d.stillBorrowed + ' เครื่อง'],
    [''],
    ['ข้อมูลที่น่าสนใจ'],
    [''],
    ['อุปกรณ์ที่ถูกยืมมากที่สุด', d.topEquipName + '  (' + d.topEquipCount + ' ครั้ง)'],
    ['หน่วยงานที่ยืมมากที่สุด', d.topWardName + '  (' + d.topWardCount + ' ครั้ง)'],
    ['การยืมเดือนนี้ (ถึงปัจจุบัน)', d.borrowThisMonthMTD + ' ครั้ง'],
    [''],
    ['=================================='],
    ['MEMs - งานศูนย์เครื่องมือแพทย์', HOSPITAL_NAME],
  ];

  sht.getRange(1, 1, rows.length, 2).setValues(rows);
}

function _formatExecSheet(sht) {
  sht.getRange(1, 1, 1, 2).merge()
     .setFontSize(13).setFontWeight('bold').setBackground('#0A6478').setFontColor('#fff')
     .setHorizontalAlignment('center');
  sht.getRange(2, 1, 1, 2).merge()
     .setFontSize(12).setFontWeight('bold').setBackground('#0E7D94').setFontColor('#fff')
     .setHorizontalAlignment('center');
  sht.getRange(3, 1, 1, 2).merge()
     .setFontSize(10).setFontColor('#6A8A96').setHorizontalAlignment('center');

  // ไฮไลต์แถวตัวเลขหลัก
  [9, 10, 11, 15, 16, 17].forEach(row => {
    sht.getRange(row, 1).setFontWeight('bold').setFontSize(11);
    sht.getRange(row, 2).setFontWeight('bold').setFontSize(13).setFontColor('#0A6478');
  });

  sht.setColumnWidth(1, 260);
  sht.setColumnWidth(2, 240);
  sht.getRange(1, 1, sht.getLastRow(), 2)
     .setFontFamily('Sarabun, Arial')
     .setVerticalAlignment('middle');
  sht.setRowHeights(1, sht.getLastRow(), 28);
}

// ============================================================
// HELPERS
// ============================================================

/** แปลง Date เป็นชื่อเดือนภาษาไทย */
function _thaiMonthYear(date) {
  const months = [
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน',
    'พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม',
    'กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
  ];
  const buddhistYear = date.getFullYear() + 543;
  return months[date.getMonth()] + ' ' + buddhistYear;
}

/** แปลงแถว raw -> Date (รองรับทั้ง Timestamp ISO string และ Date object) */
function _parseRowTimestamp(row) {
  const tsCell = row[9]; // col 10: Timestamp (ISO)
  if (tsCell instanceof Date && !isNaN(tsCell)) return tsCell;
  if (typeof tsCell === 'string' && tsCell.length > 0) {
    const d = new Date(tsCell);
    if (!isNaN(d)) return d;
  }
  // fallback: พยายาม parse จาก col 2 (วันที่) + col 3 (เวลา) รูปแบบ dd/MM/yyyy HH:mm:ss
  const dateStr = String(row[1]);
  const timeStr = String(row[2]);
  if (dateStr && dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const iso = parts[2] + '-' + parts[1] + '-' + parts[0] + 'T' + (timeStr || '00:00:00');
      const d2  = new Date(iso);
      if (!isNaN(d2)) return d2;
    }
  }
  return new Date(0); // epoch fallback (จะถูกกรองออกโดยเงื่อนไขช่วงเวลา)
}

/** คำนวณระยะเวลายืมเฉลี่ยต่อประเภทเครื่อง (จับคู่ยืม-คืนจาก equipmentNumber) */
function _calcAvgBorrowDays(borrowRows, returnRows) {
  // จับคู่โดย equipment + number + ward -> หา return ที่ใกล้ที่สุดหลังจากยืม
  const equipSet = {};
  borrowRows.forEach(r => {
    const key = String(r[5]) + '__' + String(r[6]) + '__' + String(r[7]);
    const t   = _parseRowTimestamp(r);
    if (!equipSet[key]) equipSet[key] = [];
    equipSet[key].push({ borrow: t, equip: String(r[5]) });
  });

  const returnMap = {};
  returnRows.forEach(r => {
    const key = String(r[5]) + '__' + String(r[6]) + '__' + String(r[7]);
    const t   = _parseRowTimestamp(r);
    if (!returnMap[key]) returnMap[key] = [];
    returnMap[key].push(t);
  });

  const durations = {}; // { equipType: [days, ...] }
  Object.keys(equipSet).forEach(key => {
    const bList = equipSet[key];
    const rList = (returnMap[key] || []).slice().sort((a, b) => a - b);
    bList.forEach(({ borrow, equip }) => {
      // หา return ที่ >= borrow ที่ใกล้สุด
      const ret = rList.find(t => t >= borrow);
      if (ret) {
        const days = (ret - borrow) / (1000 * 60 * 60 * 24);
        if (!durations[equip]) durations[equip] = [];
        durations[equip].push(days);
      }
    });
  });

  return Object.entries(durations).map(([equip, arr]) => {
    const avg = (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1);
    return [equip, avg, arr.length];
  });
}

/** หา/สร้าง Google Drive Folder */
function _getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

/** สร้าง export URL (PDF) ของชีต - ไม่ใช้ scope พิเศษ */
function _pdfExportUrl(ss, sheet) {
  return 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
    '/export?format=pdf&size=A4&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=true&gridlines=false&fzr=false' +
    '&gid=' + sheet.getSheetId();
}

/** แปลง millisec -> "X วัน Y ชม." */
function _fmtDur(ms) {
  if (!ms || ms <= 0) return '0 ชม.';
  const totalHours = ms / (1000 * 60 * 60);
  const days  = Math.floor(totalHours / 24);
  const hours = Math.round(totalHours - days * 24);
  // ปัดเศษชั่วโมงครบ 24 -> บวกวัน
  let dd = days, hh = hours;
  if (hh >= 24) { dd += Math.floor(hh / 24); hh = hh % 24; }
  if (dd > 0 && hh > 0) return dd + ' วัน ' + hh + ' ชม.';
  if (dd > 0)           return dd + ' วัน';
  return hh + ' ชม.';
}

// ============================================================
// 4. generateC2Report()
//    สถิติเชิงลึกรายเครื่อง C2 (No. 1-58) ตั้งแต่ต้นจนปัจจุบัน
//    - แต่ละเครื่องไปวอร์ดไหน กี่ครั้ง รวมกี่วัน/ชม.
//    - เวลาว่างพร้อมใช้รวมกี่วัน/ชม. กี่ครั้ง
//    - เครื่องที่ใช้บ่อยสุด / ใช้นานสุด
// ============================================================
function generateC2Report() {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const src = ss.getSheetByName(SHEET_BORROW);
  if (!src || src.getLastRow() <= 1) {
    return { ok: false, error: 'ไม่มีข้อมูลใน Sheet ยืม-คืน' };
  }

  const now = new Date();
  const raw = src.getRange(2, 1, src.getLastRow() - 1, 12).getValues();

  // เก็บ event ของแต่ละ No. (เฉพาะ C2, ไม่รวม Round)
  const events = {}; // { no: [ {ts, isBorrow, ward} ] }
  raw.forEach(r => {
    const equip  = String(r[5]);
    const action = String(r[4]);
    if (!equip.includes('C2')) return;
    if (action.includes('Round')) return;
    const isBorrow = action.includes('ยืม');
    const isReturn = action.includes('คืน');
    if (!isBorrow && !isReturn) return;
    const no = parseInt(String(r[6]), 10);
    if (isNaN(no) || no < 1 || no > 58) return;
    const ts = _parseRowTimestamp(r);
    if (!ts || ts.getTime() <= 0) return;
    if (!events[no]) events[no] = [];
    events[no].push({ ts: ts, isBorrow: isBorrow, ward: String(r[7]) || 'ไม่ระบุ' });
  });

  // คำนวณต่อเครื่อง
  const units = {}; // no -> stat
  Object.keys(events).forEach(noKey => {
    const list = events[noKey].slice().sort((a, b) => a.ts - b.ts);
    const stat = {
      no: parseInt(noKey, 10),
      borrowCount: 0,
      borrowedMs: 0,
      availableMs: 0,
      availableCount: 0,
      perWard: {},            // ward -> { count, ms }
      currentStatus: 'ว่าง',  // 'ว่าง' หรือ 'อยู่ <ward>'
      lastWard: ''
    };

    let openBorrow = null; // {ts, ward}
    let lastReturnTs = null;

    list.forEach(ev => {
      if (ev.isBorrow) {
        // ถ้ามีช่วงว่างก่อนหน้า (ตั้งแต่คืนล่าสุด -> ยืมนี้)
        if (lastReturnTs && ev.ts > lastReturnTs) {
          stat.availableMs += (ev.ts - lastReturnTs);
          stat.availableCount++;
          lastReturnTs = null;
        }
        // เปิดช่วงยืมใหม่ (ถ้ามีช่วงยืมค้างอยู่ ให้ปิดด้วย ts นี้ก่อน - กันข้อมูลซ้ำ)
        if (openBorrow) {
          const dur = ev.ts - openBorrow.ts;
          if (dur > 0) { stat.borrowedMs += dur; _addWard(stat, openBorrow.ward, dur, false); }
        }
        openBorrow = { ts: ev.ts, ward: ev.ward };
        stat.borrowCount++;
        _addWard(stat, ev.ward, 0, true); // นับครั้ง
      } else {
        // คืน: ปิดช่วงยืมที่เปิดอยู่
        if (openBorrow) {
          const dur = ev.ts - openBorrow.ts;
          if (dur > 0) { stat.borrowedMs += dur; _addWard(stat, openBorrow.ward, dur, false); }
          openBorrow = null;
        }
        lastReturnTs = ev.ts;
      }
    });

    // ยังยืมค้างอยู่ -> นับถึงปัจจุบัน
    if (openBorrow) {
      const dur = now - openBorrow.ts;
      if (dur > 0) { stat.borrowedMs += dur; _addWard(stat, openBorrow.ward, dur, false); }
      stat.currentStatus = 'อยู่ ' + openBorrow.ward;
      stat.lastWard = openBorrow.ward;
    } else if (lastReturnTs) {
      // ว่างอยู่ -> นับช่วงว่างถึงปัจจุบัน
      const dur = now - lastReturnTs;
      if (dur > 0) { stat.availableMs += dur; stat.availableCount++; }
      stat.currentStatus = 'ว่าง (พร้อมใช้)';
    }

    units[noKey] = stat;
  });

  const statList = Object.values(units);
  if (statList.length === 0) {
    return { ok: false, error: 'ไม่พบข้อมูลการยืม-คืนของเครื่อง C2' };
  }

  // เครื่องที่ใช้บ่อยสุด / ใช้นานสุด
  const mostUsed = statList.slice().sort((a, b) => b.borrowCount - a.borrowCount)[0];
  const longest  = statList.slice().sort((a, b) => b.borrowedMs - a.borrowedMs)[0];
  const activeNow = statList.filter(s => s.currentStatus.indexOf('อยู่') === 0).length;

  // สร้างชีต
  const stamp = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy_MM_dd');
  const sheetName = 'C2_Report_' + stamp;
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sht = ss.insertSheet(sheetName);

  _writeC2Sheet(sht, {
    generatedAt: Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm'),
    statList: statList.slice().sort((a, b) => a.no - b.no),
    mostUsed, longest, activeNow,
    usedUnits: statList.length
  });
  _formatC2Sheet(sht);

  return {
    ok: true,
    sheetName: sheetName,
    mostUsedNo: mostUsed.no,
    mostUsedCount: mostUsed.borrowCount,
    longestNo: longest.no,
    longestDur: _fmtDur(longest.borrowedMs),
    pdfUrl: _pdfExportUrl(ss, sht),
    viewUrl: _pdfExportUrl(ss, sht),
    message: 'สร้างรายงาน C2 รายเครื่อง เรียบร้อยแล้ว'
  };
}

/** เพิ่มสถิติต่อวอร์ด */
function _addWard(stat, ward, ms, countOnly) {
  if (!stat.perWard[ward]) stat.perWard[ward] = { count: 0, ms: 0 };
  if (countOnly) stat.perWard[ward].count++;
  else           stat.perWard[ward].ms += ms;
}

/** เขียนชีตรายงาน C2 */
function _writeC2Sheet(sht, d) {
  const rows = [];
  const W = 6; // จำนวนคอลัมน์

  const pad = (arr) => { const a = arr.slice(); while (a.length < W) a.push(''); return a; };

  rows.push(pad([HOSPITAL_NAME]));
  rows.push(pad(['รายงานสถิติเครื่อง C2 รายเครื่อง (ตั้งแต่เริ่มใช้งาน)']));
  rows.push(pad(['วันที่พิมพ์: ' + d.generatedAt]));
  rows.push(pad(['']));

  // ภาพรวม
  rows.push(pad(['ภาพรวม']));
  rows.push(pad(['เครื่องที่ถูกยืมบ่อยที่สุด', 'No. ' + d.mostUsed.no + '  (' + d.mostUsed.borrowCount + ' ครั้ง)']));
  rows.push(pad(['เครื่องที่ถูกใช้งานนานที่สุด', 'No. ' + d.longest.no + '  (' + _fmtDur(d.longest.borrowedMs) + ')']));
  rows.push(pad(['จำนวนเครื่องที่เคยถูกใช้', d.usedUnits + ' เครื่อง']));
  rows.push(pad(['เครื่องที่กำลังถูกยืมอยู่', d.activeNow + ' เครื่อง']));
  rows.push(pad(['']));

  // ตารางสรุปรายเครื่อง
  rows.push(pad(['ก) สรุปรายเครื่อง']));
  rows.push(pad(['No.', 'จำนวนครั้งที่ยืม', 'เวลาถูกยืมรวม', 'เวลาว่างรวม', 'ครั้งที่ว่าง', 'สถานะปัจจุบัน']));
  d.statList.forEach(s => {
    rows.push([
      s.no, s.borrowCount + ' ครั้ง', _fmtDur(s.borrowedMs),
      _fmtDur(s.availableMs), s.availableCount + ' ครั้ง', s.currentStatus
    ]);
  });
  rows.push(pad(['']));

  // รายละเอียดต่อวอร์ด
  rows.push(pad(['ข) รายละเอียดการใช้งานต่อวอร์ด']));
  rows.push(pad(['No.', 'วอร์ด', 'จำนวนครั้ง', 'เวลารวม', '', '']));
  d.statList.forEach(s => {
    const wards = Object.keys(s.perWard);
    if (wards.length === 0) return;
    wards.sort((a, b) => s.perWard[b].count - s.perWard[a].count);
    wards.forEach((w, i) => {
      const pw = s.perWard[w];
      rows.push([ i === 0 ? s.no : '', w, pw.count + ' ครั้ง', _fmtDur(pw.ms), '', '' ]);
    });
  });

  sht.getRange(1, 1, rows.length, W).setValues(rows);
}

/** จัดรูปแบบชีต C2 */
function _formatC2Sheet(sht) {
  const last = sht.getLastRow();
  const W = 6;

  // หัวรายงาน 3 แถว
  sht.getRange(1, 1, 1, W).merge()
     .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center')
     .setBackground('#0A6478').setFontColor('#FFFFFF');
  sht.getRange(2, 1, 1, W).merge()
     .setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center')
     .setBackground('#0E7D94').setFontColor('#FFFFFF');
  sht.getRange(3, 1, 1, W).merge()
     .setFontSize(10).setHorizontalAlignment('center').setFontColor('#6A8A96');

  // ฟอนต์ทั้งชีต
  sht.getRange(1, 1, last, W)
     .setFontFamily('Sarabun, Arial')
     .setVerticalAlignment('middle');

  // ไฮไลต์แถวหัวข้อ section + หัวตาราง (หาโดยอ่านค่า col A)
  const colA = sht.getRange(1, 1, last, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    const v = String(colA[i][0]);
    const row = i + 1;
    if (v === 'ภาพรวม' || v.indexOf('ก) ') === 0 || v.indexOf('ข) ') === 0) {
      sht.getRange(row, 1, 1, W).merge()
         .setFontWeight('bold').setFontSize(12).setBackground('#DAF0F5').setFontColor('#0A6478');
    }
    if (v === 'No.') {
      sht.getRange(row, 1, 1, W)
         .setFontWeight('bold').setBackground('#0A6478').setFontColor('#FFFFFF')
         .setHorizontalAlignment('center');
    }
  }

  // ความกว้างคอลัมน์
  sht.setColumnWidth(1, 60);
  sht.setColumnWidth(2, 170);
  sht.setColumnWidth(3, 130);
  sht.setColumnWidth(4, 130);
  sht.setColumnWidth(5, 90);
  sht.setColumnWidth(6, 170);

  sht.setFrozenRows(3);
}
