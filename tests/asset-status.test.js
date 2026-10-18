const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const dashboard = fs.readFileSync(new URL('../dashboard.html', `file://${__filename}`), 'utf8');
const assetsPage = fs.readFileSync(new URL('../assets.html', `file://${__filename}`), 'utf8');

const filterStart = dashboard.indexOf('function filterDashboardEquipmentStatus');
const filterEnd = dashboard.indexOf('/* ============================================================ HOME:', filterStart);
const availabilityStart = dashboard.indexOf('function computeTypeAvailability()');
const availabilityEnd = dashboard.indexOf('// HOME: ความพร้อมใช้แยกประเภท', availabilityStart);
const c2Start = dashboard.indexOf('function classifyC2Status');
const c2End = dashboard.indexOf('async function renderC2Dashboard()', c2Start);

assert.notEqual(filterStart, -1);
assert.notEqual(availabilityStart, -1);
assert.notEqual(c2Start, -1);

const context = {
  ASSET_STATUS_WAITING_FOR_NUMBER: 'รอเลขครุภัณฑ์',
  ASSET_STATUS_NOT_READY: 'เครื่องยังไม่พร้อมใช้งาน',
  REPAIR_STATUSES: ['ชำรุด', 'ส่งซ่อม'],
  assetRows: [],
  equipStatus: [],
  normalizeMachineNo(value) {
    const text = String(value ?? '').trim();
    const numeric = Number(text);
    return Number.isInteger(numeric) ? String(numeric) : text;
  },
  isAssetHiddenFromDashboard(status) {
    return String(status || '').trim() === 'เครื่องยังไม่พร้อมใช้งาน';
  },
};

vm.createContext(context);
vm.runInContext(dashboard.slice(filterStart, filterEnd), context);
vm.runInContext(dashboard.slice(availabilityStart, availabilityEnd), context);
vm.runInContext(dashboard.slice(c2Start, c2End), context);

test('asset management offers both requested statuses', () => {
  assert.match(assetsPage, /<option value="รอเลขครุภัณฑ์">/);
  assert.match(assetsPage, /<option value="เครื่องยังไม่พร้อมใช้งาน">/);
});

test('not-ready assets are hidden from dashboard state and availability totals', () => {
  const assets = [
    { type: 'C2', no: 59, status: 'เครื่องยังไม่พร้อมใช้งาน' },
    { type: 'C2', no: 60, status: 'รอเลขครุภัณฑ์' },
    { type: 'C2', no: 61, status: 'ใช้งานได้' },
    { type: 'C2', no: 62, status: 'ส่งซ่อม' },
  ];
  const equipment = [
    { equipment: 'C2', number: '59', isBorrowed: true },
    { equipment: 'C2', number: '61', isBorrowed: true },
  ];

  context.assetRows = assets;
  context.equipStatus = context.filterDashboardEquipmentStatus(equipment, assets);
  assert.deepEqual(context.equipStatus.map(item => item.number), ['61']);

  const [summary] = context.computeTypeAvailability();
  assert.equal(summary.total, 3);
  assert.equal(summary.borrowed, 1);
  assert.equal(summary.repair, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.available, 0);
});

test('C2 dashboard omits not-ready units and separates waiting-for-number units', () => {
  const result = context.computeC2Summary(
    [
      { number: '59', isBorrowed: false },
      { number: '60', isBorrowed: false },
      { number: '61', isBorrowed: false },
    ],
    {
      59: 'เครื่องยังไม่พร้อมใช้งาน',
      60: 'รอเลขครุภัณฑ์',
      61: 'ใช้งานได้',
    }
  );

  assert.deepEqual(result.items.map(item => item.number), ['60', '61']);
  assert.equal(result.counts.pending, 1);
  assert.equal(result.counts.avail, 1);
  assert.equal(Object.values(result.counts).reduce((sum, value) => sum + value, 0), 2);
});

const shortageStart = dashboard.indexOf('const SHORTAGE_MAX =');
const shortageEnd = dashboard.indexOf('\n}', shortageStart) + 2;
vm.runInContext(dashboard.slice(shortageStart, shortageEnd), context);

test('C2 low-stock threshold is below five; other types keep their existing threshold', () => {
  for (const available of [0, 1, 2, 3, 4]) {
    assert.equal(context.isEquipmentLowStock({ equipment: 'C2', total: 10, available }), true);
  }
  assert.equal(context.isEquipmentLowStock({ equipment: 'C2', total: 10, available: 5 }), false);
  assert.equal(context.isEquipmentLowStock({ equipment: 'High Flow', total: 10, available: 3 }), false);
  assert.equal(context.isEquipmentLowStock({ equipment: 'High Flow', total: 10, available: 2 }), true);
});

test('missing round entries cannot free borrowed C2 units; a recorded return can', () => {
  context.assetRows = Array.from({ length: 10 }, (_, i) => ({ type: 'C2', no: i + 1, status: 'ใช้งานได้' }));
  context.equipStatus = Array.from({ length: 6 }, (_, i) => ({ equipment: 'C2', number: String(i + 1), isBorrowed: true }));
  context.roundC2 = { latestRoundDate: '2026-10-18', byNumber: {} };
  const start = dashboard.indexOf('function computeAlerts()');
  const end = dashboard.indexOf('// นับจำนวนยืม/คืนรายวัน', start);
  context.getCircuitTiming = () => ({ daysBorrowed: 1, dueISO: null, daysLeft: null });
  context.roundMachineNo = context.normalizeMachineNo;
  context.parseThaiTimestampStr = () => null;
  vm.runInContext(dashboard.slice(start, end), context);
  const alerts = context.computeAlerts();
  assert.equal(alerts.notInRound.length, 6);
  assert.equal(alerts.shortage[0].available, 4);
  assert.equal(alerts.shortage[0].borrowed, 6);
  context.equipStatus[0].isBorrowed = false;
  assert.equal(context.computeTypeAvailability()[0].available, 5);
  assert.equal(context.computeAlerts().shortage.length, 0);
});
