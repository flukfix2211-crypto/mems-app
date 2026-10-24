const { test } = require("node:test");
const assert = require("node:assert/strict");
const ledger = require("../equipment-ledger");
const event = (id, date, action, ward = "ER", type = "C2", no = "1") => ({
  id,
  ts: new Date(date),
  ward,
  type,
  no,
  isBorrow: action === "b",
  isReturn: action === "r",
  isTransfer: action === "t",
});
test("report clips transfers across Bangkok fiscal boundary without duplicate hours", () => {
  const events = [
    event(1, "2026-09-30T15:00Z", "b"),
    event(2, "2026-09-30T17:00Z", "t", "ICU"),
    event(3, "2026-10-01T03:00Z", "r", "ICU"),
  ];
  const { sessions, anomalies } = ledger.build(events);
  assert.equal(sessions.length, 1);
  assert.equal(anomalies.length, 0);
  const start = new Date("2026-09-30T17:00Z"),
    end = new Date("2026-10-01T17:00Z");
  const er = ledger.metrics(events, sessions, [], start, end, { ward: "ER" }),
    icu = ledger.metrics(events, sessions, [], start, end, { ward: "ICU" });
  assert.equal(er.usageMs, 0);
  assert.equal(icu.usageMs, 10 * 3600000);
  assert.equal(icu.borrowed, 0);
  assert.equal(icu.returned, 1);
  assert.equal(icu.completed, 1);
  assert.equal(icu.averageMs, 12 * 3600000);
});
test("historical outstanding is separate from current status; open sessions cap at now", () => {
  const events = [
    event(1, "2026-09-29T17:00Z", "b"),
    event(2, "2026-10-02T17:00Z", "r"),
  ];
  const { sessions } = ledger.build(events);
  const m = ledger.metrics(
    events,
    sessions,
    [],
    new Date("2026-09-30T17:00Z"),
    new Date("2026-10-01T17:00Z"),
  );
  assert.equal(m.outstanding, 1);
  assert.equal(m.borrowed, 0);
  assert.equal(m.returned, 0);
  assert.equal(m.usageMs, 86400000);
  const open = ledger.build(events.slice(0, 1)).sessions;
  assert.equal(
    ledger.clipped(
      open[0],
      new Date("2026-09-29T17:00Z"),
      new Date("2026-10-03T17:00Z"),
      new Date("2026-09-30T17:00Z"),
    ),
    86400000,
  );
});
test("unmatched returns/transfers flagged; duplicate borrow never produces invented overlapping hours", () => {
  const events = [
    event(1, "2026-10-01T00:00Z", "r"),
    event(2, "2026-10-01T01:00Z", "t"),
    event(3, "2026-10-01T02:00Z", "b"),
    event(4, "2026-10-01T03:00Z", "b"),
    event(5, "2026-10-01T04:00Z", "r"),
  ];
  const built = ledger.build(events);
  assert.equal(built.anomalies.length, 3);
  assert.ok(built.sessions.some((s) => s.incomplete));
  const m = ledger.metrics(
    events,
    built.sessions,
    [],
    new Date("2026-10-01"),
    new Date("2026-10-02"),
  );
  assert.equal(m.borrowed, 2);
  assert.equal(m.returned, 2);
  assert.equal(m.completed, 0);
  assert.equal(m.usageMs, 0);
});
test("same number across equipment types remains independent; preparation and zero-duration return", () => {
  const events = [
    event(1, "2026-10-01T00:00Z", "b"),
    event(2, "2026-10-01T01:00Z", "b", "ER", "NIBP"),
    event(3, "2026-10-01T01:00Z", "r", "ER", "NIBP"),
  ];
  const { sessions } = ledger.build(events);
  assert.equal(sessions.length, 2);
  const start = new Date("2026-10-01"),
    end = new Date("2026-10-02");
  const m = ledger.metrics(
    events,
    sessions,
    [{ type: "NIBP", no: "1", ward: "ER", ts: start }],
    start,
    end,
    { type: "NIBP" },
  );
  assert.equal(m.completed, 1);
  assert.equal(m.prepared, 1);
  assert.equal(m.usageMs, 0);
  assert.equal(m.outstanding, 0);
});

test("ER High Flow returned by another ward closes a complete session", () => {
  const events = [event(1, '2026-10-24T01:00Z', 'b', 'ER', 'High Flow'),
    event(2, '2026-10-24T03:00Z', 'r', 'ICU', 'High Flow')];
  const result = ledger.build(events);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.sessions[0].completed, true);
  assert.equal(result.sessions[0].incomplete, false);
  assert.equal(result.sessions[0].returnWard, 'ICU');
  assert.equal(result.sessions[0].segments[0].ward, 'ER');
  events[0].ward = 'ICU 100 ปี';
  assert.equal(ledger.build(events).anomalies.length, 1);
});
