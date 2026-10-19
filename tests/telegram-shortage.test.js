const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/telegram-notify/index.ts'), 'utf8').replace(/^import .*;\n/gm, '');
function setup(assets, status, telegramOK = true) {
  const sent = [];
  const db = { from(table) { return { select() { return this; }, order() { return this; }, range(from, to) { return Promise.resolve({ data: (table === 'assets' ? assets : status).slice(from, to + 1), error: null }); } }; } };
  const ctx = { Request, Response, Date, Intl, createClient: () => db, fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: telegramOK, status: telegramOK ? 200 : 429, text: async () => 'retry later' }; }, Deno: { env: { get: () => 'test' }, serve(fn) { ctx.handler = fn; } } };
  vm.createContext(ctx);
  vm.runInContext(stripTypeScriptTypes(source), ctx);
  return { ctx, sent, request: async (payload) => ctx.handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify(payload) })) };
}
const assetsFor = (type, count) => Array.from({ length: count }, (_, i) => ({ type, no: i + 1, status: 'ใช้งานได้' }));
const loansFor = (equipment_name, count) => Array.from({ length: count }, (_, i) => ({ equipment_name, equipment_number: String(i + 1), is_borrowed: true }));

test('inventory includes never-borrowed units and excludes hidden/sold/repair/pending; loans stay borrowed without rounds', () => {
  const assets = [...assetsFor('C2', 10), { type: 'C2', no: 11, status: 'ชำรุด' }, { type: 'C2', no: 12, status: 'รอเลขครุภัณฑ์' }, { type: 'C2', no: 13, status: 'จำหน่าย' }, { type: 'C2', no: 14, status: 'เครื่องยังไม่พร้อมใช้งาน' }];
  const status = [...loansFor('C2', 6), { equipment_name: 'C2', equipment_number: '014', is_borrowed: true }, { equipment_name: 'C2', equipment_number: '01', is_borrowed: true }];
  const { ctx } = setup(assets, status);
  const [summary] = ctx.computeAvailability(assets, status);
  assert.equal(summary.available, 4);
  assert.equal(summary.borrowed, 6);
  assert.equal(summary.total, 12);
});

test('hourly sends only C2 <=4, HF <=2 and Brid <=2, repeats each invocation, stops after return', async () => {
  const assets = [...assetsFor('C2', 10), ...assetsFor('High Flow', 3), ...assetsFor('Brid เขียว', 3), ...assetsFor('T1', 1)];
  const status = [...loansFor('C2', 6), ...loansFor('High Flow', 1)];
  const { request, sent } = setup(assets, status);
  const first = await (await request({ type: 'hourly_shortage' })).json();
  assert.equal(first.sent, true);
  assert.equal(first.shortageCount, 2);
  assert.match(sent[0].text, /C2/);
  assert.match(sent[0].text, /High Flow/);
  assert.doesNotMatch(sent[0].text, /<b>T1<\/b>/);
  await request({ type: 'hourly_shortage' });
  assert.equal(sent.length, 2);
  status[0].is_borrowed = false;
  status[6].is_borrowed = false;
  assert.equal((await (await request({ type: 'hourly_shortage' })).json()).skipped, true);
  assert.equal(sent.length, 2);
  status.push(...loansFor('Brid เขียว', 1));
  assert.equal((await (await request({ type: 'hourly_shortage' })).json()).shortageCount, 1);
  assert.match(sent.at(-1).text, /Brid เขียว/);
});

test('dry run never sends and Telegram failure is reported as HTTP 502', async () => {
  const { request, sent } = setup(assetsFor('C2', 4), [], false);
  assert.equal((await (await request({ type: 'hourly_shortage', dryRun: true })).json()).dryRun, true);
  assert.equal(sent.length, 0);
  const result = await request({ type: 'hourly_shortage' });
  assert.equal(result.status, 502);
  assert.equal((await result.json()).sent, false);
});

test('asset and status fetching paginates past 1000 rows', async () => {
  const { request } = setup([...assetsFor('Infusion Pump', 1000), ...assetsFor('C2', 4)], []);
  const result = await (await request({ type: 'hourly_shortage', dryRun: true })).json();
  assert.equal(result.shortage[0].equipment, 'C2');
  assert.equal(result.shortage[0].available, 4);
});
