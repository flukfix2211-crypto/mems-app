const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const dashboard = fs.readFileSync(new URL('../dashboard.html', `file://${__filename}`), 'utf8');
const helperStart = dashboard.indexOf('function getCurrentLoanTimeline');
const helperEnd = dashboard.indexOf('// ความพร้อมใช้ต่อประเภท', helperStart);

assert.notEqual(helperStart, -1, 'circuit timeline helpers are present');
assert.notEqual(helperEnd, -1, 'circuit timeline helper block has an end marker');

const context = {
  allRecords: [],
  OVERDUE_C2_DAYS: 14,
  normalizeMachineNo(value) {
    const text = String(value ?? '').trim();
    const numeric = Number(text);
    return Number.isInteger(numeric) ? String(numeric) : text;
  },
  parseThaiTimestampStr(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date : null;
  },
  parseThaiDT(record) {
    const value = record['Timestamp (ISO)'];
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date : null;
  },
  bkkDateStr(date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  },
  isoAddDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  },
  isoDaysBetween(from, to) {
    return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
  },
  circuitChangeDay(dueISO) {
    return dueISO;
  },
  Date,
  Intl,
};

vm.createContext(context);
vm.runInContext(dashboard.slice(helperStart, helperEnd), context);

const record = (action, timestamp) => ({
  'ประเภท (ยืม/คืน)': action,
  'ชื่อเครื่อง': 'C2',
  'หมายเลขเครื่อง': '23',
  'Timestamp (ISO)': timestamp,
});

test('changing a circuit keeps the original borrow age and schedules another 14 days', () => {
  context.allRecords = [
    record('🔧 ครบกำหนดเปลี่ยน Circuit', '2026-10-15T04:03:23Z'),
    record('🔧 ครบกำหนดเปลี่ยน Circuit', '2026-10-15T04:03:04Z'),
    record('🟩 ยืม', '2026-09-30T08:03:38.776Z'),
  ];

  const timing = context.getCircuitTiming(
    'C2', '23', '2026-10-15T04:03:23Z',
    { active: true, dueISO: '2026-10-15' },
    new Date('2026-10-16T04:04:00Z')
  );

  assert.equal(timing.daysBorrowed, 15);
  assert.equal(timing.dueISO, '2026-10-29');
  assert.equal(timing.daysLeft, 13);
  assert.equal(timing.source, 'mems');
});

test('a newer Round due date can replace a completed local circuit round', () => {
  const timing = context.getCircuitTiming(
    'C2', '23', '2026-10-15T04:03:23Z',
    { active: true, dueISO: '2026-10-29' },
    new Date('2026-10-16T04:04:00Z')
  );

  assert.equal(timing.dueISO, '2026-10-29');
  assert.equal(timing.source, 'round');
});

