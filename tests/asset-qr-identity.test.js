const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const read = path => readFileSync(new URL('../' + path, 'file://' + __filename), 'utf8');

test('printed QR survives a missing or replaced registry row and keeps its equipment type', async () => {
  const db = new PGlite();
  try {
    await db.exec(read('tests/fixtures/lifecycle-baseline.sql'));
    const lifecycle = read('supabase/migrations/20261022031655_registry_equipment_lifecycle.sql');
    await db.exec(lifecycle.slice(lifecycle.indexOf('create or replace function'), lifecycle.indexOf('alter table public.borrow_records')));
    await db.exec(`
      insert into assets(id, no, type) values
        (757, 346, 'Infusion Pump'), (758, 346, 'Syringe Pump'), (900, 22, 'C2');
      insert into audit_log(table_name, action, row_id, old_data, new_data) values
        ('assets','delete','732','{"id":732,"no":346,"type":"Infusion Pump"}',null),
        ('assets','update','700','{"id":700,"no":346,"type":"Infusion Pump"}','{"id":700,"no":346,"type":"Syringe Pump"}');
    `);
    await db.exec(read('supabase/migrations/20261119044628_asset_qr_by_equipment_number.sql'));
    const as = async (role, run) => {
      await db.exec('set role ' + role);
      try { return await run(); } finally { await db.exec('reset role'); }
    };
    const resolve = (id, type = null, no = null) => as('authenticated', async () =>
      (await db.query('select * from public.mems_resolve_asset_qr($1,$2,$3)', [id, type, no])).rows.map(row => Number(row.id))
    );
    assert.deepEqual(await resolve(732), [757]);
    assert.deepEqual(await resolve(700), []);
    assert.deepEqual(await resolve(null, 'Syringe Pump', 346), [758]);
    await db.exec('update assets set no = 347 where id = 757');
    assert.deepEqual(await resolve(757), []);
    await db.exec('delete from assets where id = 757');
    assert.deepEqual(await resolve(732), []);
    await db.exec("insert into assets(id, no, type) values (759, 346, 'Infusion Pump')");
    assert.deepEqual(await resolve(732), [759]);
    assert.deepEqual(await resolve(757), [759]);
    assert.deepEqual(await resolve(null, ' Infusion  Pump ', 346), [759]);
    assert.deepEqual(await resolve(758), [758]);
    await assert.rejects(as('anon', () => db.query('select * from public.mems_resolve_asset_qr(732,null,null)')), /permission denied/);
    await assert.rejects(as('authenticated', () => db.exec("delete from private.asset_qr_legacy")), /permission denied/);
  } finally {
    await db.close();
  }
});
