const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.join(__dirname, '..');
test('explicit action permission does not inherit admin role and rejects inactive accounts', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'auth.js'), 'utf8'), ctx);
  for (const role of ['admin', 'user']) {
    assert.equal(ctx.memsCanTransferWard({ role, active: true }), false);
    assert.equal(ctx.memsCanTransferWard({ role, active: true, can_transfer_ward: false }), false);
    assert.equal(ctx.memsCanTransferWard({ role, active: true, can_transfer_ward: true }), true);
    assert.equal(ctx.memsCanTransferWard({ role, active: false, can_transfer_ward: true }), false);
  }
  assert.equal(ctx.memsCanTransferWard(null), false);
});
test('database blocks direct transfers, applies revocation immediately, preserves ordinary records', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema private; create role authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.user_profiles(id uuid primary key, active boolean, role text, permissions text[], is_super_admin boolean default false);
      create table public.borrow_records(id int, action text, ward text, equipment_name text, equipment_number text, recorded_at timestamptz);
      insert into public.user_profiles values ('10000000-0000-4000-8000-000000000001',true,'user',array['borrow'],false);
      alter table public.user_profiles enable row level security;
      create policy own on public.user_profiles for select to authenticated using(id=auth.uid());
      grant usage on schema public,private,auth to authenticated;
      grant select on public.user_profiles to authenticated;
      grant insert,update,select on public.borrow_records to authenticated;
      set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261022090948_ward_transfer_permission.sql'), 'utf8'));
    const transfer = "insert into public.borrow_records(id,action,ward) values(1,'🔁 ย้ายวอร์ด','B')";
    await db.exec('set role authenticated');
    await assert.rejects(db.exec(transfer), /ไม่มีสิทธิ์/);
    await assert.rejects(db.exec('update public.user_profiles set can_transfer_ward=true'), /permission denied/);
    await db.exec("insert into public.borrow_records(id,action,ward) values(2,'ยืม','A'),(3,'คืน','A')");
    await assert.rejects(db.exec("update public.borrow_records set action='ย้ายวอร์ด' where id=2"), /ไม่มีสิทธิ์/);
    await db.exec('reset role; update public.user_profiles set can_transfer_ward=true; set role authenticated');
    await db.exec(transfer);
    await db.exec('reset role; update public.user_profiles set can_transfer_ward=false,role=\'admin\'; set role authenticated');
    await assert.rejects(db.exec(transfer), /ไม่มีสิทธิ์/);
    await db.exec("update public.borrow_records set recorded_at=now() where id=1");
    await db.exec('reset role; update public.user_profiles set can_transfer_ward=true,active=false; set role authenticated');
    await assert.rejects(db.exec(transfer), /ไม่มีสิทธิ์/);
    await db.exec("reset role; update public.user_profiles set active=true,role='user',permissions=array['round']; set role authenticated");
    await assert.rejects(db.exec(transfer), /ไม่มีสิทธิ์/);
    await db.exec("reset role; update public.user_profiles set permissions=array['dashboard']; set role authenticated");
    await db.exec(transfer);
    await db.exec("set request.jwt.claim.sub=''");
    await assert.rejects(db.exec(transfer), /ไม่มีสิทธิ์/);
  } finally { await db.close(); }
});
