const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const path = require("node:path");
const root = path.join(__dirname, "..");
const user = "10000000-0000-4000-8000-000000000001";
let seq = 0;
async function setup(returnChecks = false) {
  let db;
  if (process.env.MEMS_TEST_PG) {
    const { Client } = require("pg");
    const admin = new Client({ connectionString: process.env.MEMS_TEST_PG });
    await admin.connect();
    const name =
      "mems_test_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    await admin.query(
      `create database ${name} encoding 'UTF8' template template0`,
    );
    const connectionString = process.env.MEMS_TEST_PG.replace(
      /\/[^/]*$/,
      "/" + name,
    );
    const client = new Client({ connectionString });
    await client.connect();
    db = {
      exec: (sql) => client.query(sql),
      query: (sql, params) => client.query(sql, params),
      connectionString,
      async close() {
        await client.end();
        await admin.query(`drop database ${name} with (force)`);
        await admin.end();
      },
    };
  } else db = new PGlite();
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, "fixtures/lifecycle-baseline.sql"),
      "utf8",
    ),
  );
  const catalog = require("./fixtures/production-triggers.json");
  for (const f of catalog.functions) await db.exec(f);
  for (const t of catalog.triggers) await db.exec(t);
  await db.exec(
    `insert into auth.users values('${user}');insert into public.user_profiles(id,active,role) values('${user}',true,'admin');`,
  );
  for (const table of ["assets", "borrow_records", "prepare_records"])
    await db.exec(
      `alter table public.${table} enable row level security;create policy read on public.${table} for select using(true);create policy write on public.${table} for all to authenticated using(${table === "assets" ? "private.has_permission('assets')" : "private.is_active_user()"}) with check(${table === "assets" ? "private.has_permission('assets')" : "private.is_active_user()"});`,
    );
  await db.exec(
    fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20261022031655_registry_equipment_lifecycle.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20261022042356_registry_lock_rls.sql",
      ),
      "utf8",
    ),
  );
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261024050733_er_high_flow_cross_ward_return.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261104000000_prepare_unreturned_equipment.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261104033354_picu_lower_pediatrics_cross_ward_return.sql'), 'utf8'));
  if (returnChecks) await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261117140000_return_receipt_confirmation.sql'), 'utf8'));
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`,
  );
  return db;
}
async function batch(db, mode, items, ward = "ER", id) {
  const request =
    id || `20000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const payload = { mode, items, ward, name: "Test", timestamp: null };
  const result = await db.query(
    "select public.mems_equipment_batch($1,$2::jsonb) result",
    [request, JSON.stringify(payload)],
  );
  return { request, payload, result: result.rows[0].result };
}
const item = (equipment, number = 1) => ({ equipment, number: String(number) });
test("production trigger fixture + migration: all types prepare → borrow → return, aliases and shared numbers", async () => {
  const db = await setup();
  try {
    const types = [
      "C2",
      "High Flow",
      "Infusion Pump",
      "Syringe Pump",
      "Patient Monitor",
      "NIBP",
      "Defibrillator",
      "T1",
      "Monnal t60",
      "Brid เขียว",
      "New Type",
    ];
    for (const type of types) {
      await db.query("insert into assets(type,no) values($1,1)", [type]);
      const i = item(type === "Syringe Pump" ? "Syringe pump" : type);
      await batch(db, "prepare", [i]);
      await assert.rejects(batch(db, "prepare", [i], "ICU"), /เตรียมไว้แล้ว/);
      await assert.rejects(batch(db, "borrow", [i], "ICU"), /ไม่ได้เตรียม/);
      await batch(db, "borrow", [i]);
      await assert.rejects(batch(db, "borrow", [i]), /ถูกยืม/);
      if (type !== "High Flow") await assert.rejects(batch(db, "return", [i], "ICU"), /ตึกอื่น/);
      await batch(db, "return", [i]);
      await assert.rejects(batch(db, "return", [i]), /คืนแล้ว/);
    }
    const linked = await db.query(
      "select count(*)::int n from prepare_records where borrow_record_id is not null",
    );
    assert.equal(linked.rows[0].n, types.length);
    await db.exec("reset role");
    assert.ok(
      (await db.query("select count(*)::int n from audit_log")).rows[0].n > 0,
    );
  } finally {
    await db.close();
  }
});
test("atomic batch rollback, deliver once, retries, repair, round and transfer", async () => {
  const db = await setup();
  try {
    await db.exec(
      "insert into assets(type,no) values('C2',1),('Syringe Pump',1);insert into assets(type,no,status)values('C2',2,'ชำรุด');",
    );
    await assert.rejects(
      batch(db, "prepare", [item("C2"), item("missing")]),
      /ทะเบียน/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from prepare_records")).rows[0].n,
      0,
    );
    await assert.rejects(batch(db, "prepare", [item("C2", 2)]), /ไม่พร้อมใช้/);
    const saved = await batch(db, "deliver", [
      item("C2"),
      item("Syringe pump"),
    ]);
    const again = await batch(
      db,
      "deliver",
      [item("C2"), item("Syringe pump")],
      "ER",
      saved.request,
    );
    assert.deepEqual(saved.result, again.result);
    assert.equal(
      (await db.query("select count(*)::int n from borrow_records")).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query("select count(*)::int n from prepare_records")).rows[0].n,
      2,
    );
    await db.exec(
      "insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name) values(current_date,current_time,'Round','C2','1','ER','Test');",
    );
    assert.equal(
      (
        await db.query(
          "select is_borrowed from equipment_status where equipment_name='C2'",
        )
      ).rows[0].is_borrowed,
      true,
    );
    await db.exec(
      "insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name,note) values(current_date,current_time,'🔁 ย้ายวอร์ด','C2','1','ICU','Test','ย้ายจาก ER');",
    );
    await assert.rejects(batch(db, "return", [item("C2")]), /ตึกอื่น/);
    await batch(db, "return", [item("C2")], "ICU");
    assert.equal(
      (
        await db.query(
          "select count(distinct loan_id)::int n from borrow_records where equipment_name='C2' and loan_id is not null",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from equipment_status where is_borrowed",
        )
      ).rows[0].n,
      1,
    );
    await db.exec(
      "update assets set status='ส่งซ่อม' where type='Syringe Pump';",
    );
    await batch(db, "return", [item("Syringe Pump")]);
    await assert.rejects(
      batch(db, "prepare", [item("Syringe Pump")]),
      /ไม่พร้อมใช้/,
    );
    const dates = await db.query(
      "select count(*)::int n from borrow_records where record_date<>(recorded_at at time zone 'Asia/Bangkok')::date or record_time<>(recorded_at at time zone 'Asia/Bangkok')::time",
    );
    assert.equal(dates.rows[0].n, 0);
  } finally {
    await db.close();
  }
});
test("anonymous and inactive users denied; direct REST inserts obey same guards", async () => {
  const db = await setup();
  try {
    await db.exec("insert into assets(type,no)values('C2',1);");
    await assert.rejects(
      db.exec(
        "insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name)values(current_date,current_time,'🟩 ยืม','C2','1','ER','Test');",
      ),
      /ไม่ได้เตรียม/,
    );
    await db.exec("set role anon");
    await assert.rejects(
      batch(db, "prepare", [item("C2")]),
      /permission denied/,
    );
    await db.exec(
      `reset role;update user_profiles set active=false;set role authenticated;`,
    );
    await assert.rejects(batch(db, "prepare", [item("C2")]), /เข้าสู่ระบบ/);
  } finally {
    await db.close();
  }
});

module.exports = { setup, batch, item, user };
test(
  "two database sessions serialize preparation, borrowing, returning and same-request retry",
  { skip: !process.env.MEMS_TEST_PG },
  async () => {
    const db = await setup();
    const { Client } = require("pg");
    const c = new Client({ connectionString: db.connectionString });
    await c.connect();
    const other = {
      exec: (sql) => c.query(sql),
      query: (sql, p) => c.query(sql, p),
    };
    try {
      const second = "10000000-0000-4000-8000-000000000002";
      await db.exec(
        `reset role;insert into auth.users values('${second}');insert into user_profiles(id,active,role) values('${second}',true,'admin');set role authenticated;`,
      );
      await other.exec(
        `set role authenticated;select set_config('request.jwt.claim.sub','${second}',false)`,
      );
      await db.exec("insert into assets(type,no)values('C2',1)");
      async function race(mode, ward = "ER") {
        await db.exec("begin");
        const first = await batch(db, mode, [item("C2")], ward);
        const waiting = batch(other, mode, [item("C2")], ward).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await db.exec("select pg_sleep(0.05);commit");
        const result = await waiting;
        assert.ok(result.error, `second ${mode} must fail`);
        return first;
      }
      await race("prepare");
      await race("borrow");
      await race("return");
      const request = "90000000-0000-4000-8000-000000000001";
      await other.exec(
        `select set_config('request.jwt.claim.sub','${user}',false)`,
      );
      await db.exec("begin");
      const first = await batch(db, "deliver", [item("C2")], "ER", request);
      const waiting = batch(other, "deliver", [item("C2")], "ER", request);
      await db.exec("select pg_sleep(0.05);commit");
      assert.deepEqual((await waiting).result, first.result);
      const counts = await db.query(
        "select count(*)::int n from borrow_records where action like '%ยืม%'",
      );
      assert.equal(counts.rows[0].n, 2);
    } finally {
      await c.end();
      await db.close();
    }
  },
);
test("cancellation reasons, blank numbers, alias collisions, limits and forged acknowledgements", async () => {
  const db = await setup();
  try {
    await db.exec(
      "insert into assets(type,no)values('Syringe Pump',1),('C2',1),('High Flow',1)",
    );
    await assert.rejects(
      db.exec("insert into assets(type,no)values('Syringe pump',1)"),
      /duplicate key/,
    );
    await assert.rejects(batch(db, "prepare", [item("C2", "")]), /ทะเบียน/);
    await assert.rejects(
      batch(db, "prepare", [item("High Flow Plus")]),
      /ทะเบียน/,
    );
    const p = await batch(db, "prepare", [item("C2")]);
    await db.query(
      "update prepare_records set status='ยกเลิก: หน่วยงานไม่คีย์ยืมเครื่องมือ' where id=$1",
      [p.result[0].id],
    );
    await assert.rejects(
      db.query("update prepare_records set status='เตรียม' where id=$1", [
        p.result[0].id,
      ]),
      /ปิดแล้ว/,
    );
    await batch(db, "prepare", [item("C2")]);
    await batch(db, "borrow", [item("C2")]);
    await assert.rejects(
      db.exec(
        "update prepare_records set status='ยกเลิก: ผู้เตรียมบันทึกผิดพลาด' where status='ยืมแล้ว'",
      ),
      /ปิดแล้ว/,
    );
    await assert.rejects(
      db.query(
        "insert into equipment_requests(id,payload,result)values($1,$2,$3)",
        [
          "80000000-0000-4000-8000-000000000001",
          JSON.stringify({ mode: "borrow", ward: "ER", items: [item("C2")] }),
          JSON.stringify([{ id: 999999 }]),
        ],
      ),
      /ไม่พบรายการ/,
    );
    const many = Array.from({ length: 6 }, (_, i) => item("C2", i + 1));
    await assert.rejects(batch(db, "borrow", many), /สูงสุด/);
    const infusion = Array.from({ length: 10 }, (_, i) =>
      item("Infusion Pump", i + 1),
    );
    for (let i = 1; i <= 10; i++)
      await db.query("insert into assets(type,no)values('Infusion Pump',$1)", [
        i,
      ]);
    await batch(db, "prepare", infusion);
    await batch(db, "borrow", infusion);
    await batch(db, "return", infusion);
    // Legacy used preparations may lack a link; retain metadata corrections and audit.
    await db.exec(
      "reset role;alter table prepare_records disable trigger mems_prepare_guard;insert into prepare_records(record_date,record_time,equipment_type,equipment_number,ward,prepared_by,status)values(current_date,current_time,'High Flow','1','ER','Legacy','ยืมแล้ว');alter table prepare_records enable trigger mems_prepare_guard;set role authenticated;",
    );
    await db.exec(
      "update prepare_records set prepared_by='Corrected' where prepared_by='Legacy'",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from prepare_records where prepared_by='Corrected' and borrow_record_id is null",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("borrow-only accounts complete the flow without registry edit permission", async () => {
  const db = await setup();
  try {
    const borrower = "10000000-0000-4000-8000-000000000003";
    await db.exec(
      `insert into assets(type,no) values('C2',1);reset role;insert into auth.users values('${borrower}');insert into user_profiles(id,active,role,permissions)values('${borrower}',true,'user',array['borrow','prepare']);set role authenticated;select set_config('request.jwt.claim.sub','${borrower}',false)`,
    );
    assert.equal(
      (await db.query("select private.has_permission('assets') allowed"))
        .rows[0].allowed,
      false,
    );
    await batch(db, "prepare", [item("C2")]);
    await batch(db, "borrow", [item("C2")]);
    await batch(db, "return", [item("C2")]);
    const update = await db.query(
      "update assets set status='ชำรุด' where type='C2' returning id",
    );
    assert.equal(update.rows.length, 0);
    assert.equal(
      (await db.query("select status from assets where type='C2'")).rows[0]
        .status,
      "ใช้งานได้",
    );
  } finally {
    await db.close();
  }
});

test(
  "registry repair update serializes with a concurrent borrowing request",
  { skip: !process.env.MEMS_TEST_PG },
  async () => {
    const db = await setup();
    const { Client } = require("pg");
    const c = new Client({ connectionString: db.connectionString });
    await c.connect();
    const other = { query: (s, p) => c.query(s, p) };
    try {
      await c.query(
        `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
      );
      await db.exec("insert into assets(type,no)values('C2',1)");
      await batch(db, "prepare", [item("C2")]);
      await db.exec("begin;update assets set status='ส่งซ่อม' where type='C2'");
      const pending = batch(other, "borrow", [item("C2")]).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await db.exec("select pg_sleep(0.05);commit");
      const result = await pending;
      assert.match(result.error?.message || "", /ไม่พร้อมใช้|สถานะในทะเบียน/);
      assert.equal(
        (await db.query("select count(*)::int n from borrow_records")).rows[0]
          .n,
        0,
      );
    } finally {
      await c.end();
      await db.close();
    }
  },
);

test("ER High Flow cross-ward return, direct inserts, ICU restrictions and transfer remain consistent", async () => {
  const db = await setup();
  try {
    await db.exec("insert into assets(type,no)values('High Flow',1),('C2',1)");
    await batch(db, 'deliver', [item('HighFlow')]);
    await batch(db, 'return', [item('High Flow')], 'ศัลยกรรมชาย');
    await assert.rejects(batch(db, 'return', [item('High Flow')], 'ICU'), /คืนแล้ว/);
    assert.equal((await db.query("select count(distinct loan_id)::int n from borrow_records where equipment_name='High Flow'")).rows[0].n, 1);
    await batch(db, 'deliver', [item('High Flow')]);
    await db.exec("insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name)values(current_date,current_time,'คืน','High Flow','1','ICU','Test')");
    await batch(db, 'deliver', [item('High Flow')], 'ICU');
    await assert.rejects(batch(db, 'return', [item('High Flow')], 'ER'), /ตึกอื่น/);
    await batch(db, 'return', [item('High Flow')], 'ICU');
    await batch(db, 'deliver', [item('High Flow')]);
    await db.exec("insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name,note)values(current_date,current_time,'ย้ายวอร์ด','High Flow','1','ICU','Test','ย้ายจาก ER')");
    await assert.rejects(batch(db, 'return', [item('High Flow')], 'ER'), /ตึกอื่น/);
    await batch(db, 'return', [item('High Flow')], 'ICU');
    await batch(db, 'deliver', [item('C2')]);
    await assert.rejects(batch(db, 'return', [item('C2')], 'ICU'), /ตึกอื่น/);
  } finally { await db.close(); }
});

test("prepare confirms missing return, records ward reason and retries without duplicate returns", async () => {
  const db = await setup();
  try {
    await db.exec("insert into public.assets(type,no,status) values('C2',1,'ใช้งานได้')");
    await batch(db, 'prepare', [item('C2')]);
    await batch(db, 'borrow', [item('C2')]);
    await assert.rejects(batch(db, 'prepare', [item('C2')]), /สถานะยืมเปลี่ยน/);
    const holder = (await db.query("select ward, recorded_at from public.borrow_records where action ~ 'ยืม' order by id desc limit 1")).rows[0];
    const payload = {mode:'prepare',items:[item('C2')],ward:'ICU',name:'Admin',unreturned:[{...item('C2'),ward:holder.ward,lastUpdate:holder.recorded_at}]};
    const request = '30000000-0000-4000-8000-000000000001';
    for (let n=0;n<2;n++) await db.query('select public.mems_equipment_batch($1,$2::jsonb)',[request,JSON.stringify(payload)]);
    const returns = (await db.query("select ward,note from public.borrow_records where action ~ 'คืน'")).rows;
    assert.deepEqual(returns,[{ward:'ER',note:'หน่วยงาน ER ไม่คีย์คืนเครื่อง'}]);
    assert.equal((await db.query("select count(*)::int n from public.prepare_records where status='เตรียม' and ward='ICU'")).rows[0].n,1);
  } finally { await db.close(); }
});

test('PICU and lower pediatrics share returns both directions for all types, keeping loan links and blocking outsiders', async () => {
  const db = await setup();
  try {
    for (const type of ['C2','High Flow','Infusion Pump','NIBP']) {
      await db.query('insert into assets(type,no) values($1,1)',[type]);
      for (const [holder,receiver] of [['PICU','เด็กล่าง'],['เด็กล่าง','PICU']]) {
        await batch(db,'deliver',[item(type)],holder);
        await assert.rejects(batch(db,'return',[item(type)],'ICU'),/ตึกอื่น/);
        const loan=(await db.query("select id from borrow_records where equipment_name=$1 and action ~ 'ยืม' order by id desc limit 1",[type])).rows[0].id;
        await batch(db,'return',[item(type)],receiver);
        const returned=(await db.query("select loan_id,ward from borrow_records where equipment_name=$1 and action ~ 'คืน' order by id desc limit 1",[type])).rows[0];
        assert.equal(returned.loan_id,loan);
        assert.equal(returned.ward,receiver);
        await assert.rejects(batch(db,'return',[item(type)],holder),/คืนแล้ว/);
      }
      await batch(db,'deliver',[item(type)],'ICU');
      await assert.rejects(batch(db,'return',[item(type)],'PICU'),/ตึกอื่น/);
      await assert.rejects(batch(db,'return',[item(type)],'เด็กล่าง'),/ตึกอื่น/);
      await batch(db,'return',[item(type)],'ICU');
    }
    await batch(db,'deliver',[item('C2')],'PICU');
    await db.exec("insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name) values(current_date,current_time,'คืน','C2','1','เด็กล่าง','Test')");
    await batch(db,'deliver',[item('C2')],'PICU');
    await db.exec("insert into borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name,note) values(current_date,current_time,'ย้ายวอร์ด','C2','1','ICU','Test','ย้ายจาก PICU')");
    await assert.rejects(batch(db,'return',[item('C2')],'เด็กล่าง'),/ตึกอื่น/);
  } finally { await db.close(); }
});

test("physical returns wait for signed receipt, enforce permissions and cannot prepare via direct API", async () => {
  const db = await setup(true);
  try {
    await db.exec("insert into assets(type,no)values('C2',1),('C2',2),('High Flow',1)");
    await batch(db, 'deliver', [item('C2'), item('High Flow')]);
    const returned = await batch(db, 'return', [item('C2')]);
    const rid = returned.result[0].id;
    assert.equal((await db.query("select is_return_pending,is_borrowed from equipment_status where equipment_name='C2'")).rows[0].is_return_pending,true);
    await assert.rejects(batch(db,'prepare',[item('C2')]), /รอตรวจ/);
    await assert.rejects(batch(db,'deliver',[item('C2')]), /รอตรวจ/);
    await assert.rejects(db.exec("insert into prepare_records(record_date,record_time,equipment_type,equipment_number,ward,prepared_by)values(current_date,current_time,'C2','1','ER','Test')"), /รอตรวจ/);
    await assert.rejects(db.query("select mems_confirm_equipment_return($1,'   ')",[rid]), /ลงชื่อ/);
    await assert.rejects(db.query("update equipment_return_checks set confirmed_at=now() where return_id=$1",[rid]), /permission denied/);
    // Ward users may return, but cannot sign their own physical receipt.
    await db.exec("reset role; update user_profiles set role='user',permissions=array['borrow']::text[];set role authenticated");
    await assert.rejects(db.query("select mems_confirm_equipment_return($1,'Ward')",[rid]), /ไม่มีสิทธิ์/);
    assert.equal((await db.query("update equipment_return_checks set confirmed_by='Ward' where return_id=$1 returning *",[rid])).rows.length,0);
    await db.exec("reset role;update user_profiles set permissions=array['prepare']::text[];set role authenticated");
    await db.query("select mems_confirm_equipment_return($1,'  Receiver  ')",[rid]);
    const signed=(await db.query("select * from equipment_return_checks where return_id=$1",[rid])).rows[0];
    assert.equal(signed.confirmed_by,'Receiver');assert.equal(signed.confirmed_user_id,user);assert.ok(signed.confirmed_at);
    await assert.rejects(db.query("select mems_confirm_equipment_return($1,'Other')",[rid]), /ยืนยันรับคืนแล้ว/);
    await assert.rejects(db.query("update equipment_return_checks set confirmed_by='Other' where return_id=$1",[rid]), /ยืนยันรับคืนแล้ว/);
    assert.equal((await db.query("select is_return_pending from equipment_status where equipment_name='C2'")).rows[0].is_return_pending,false);
    await batch(db,'prepare',[item('C2')]);
    // Other equipment type with same number retains its loan.
    assert.equal((await db.query("select is_borrowed from equipment_status where equipment_name='High Flow'")).rows[0].is_borrowed,true);
    await db.exec("reset role;update user_profiles set role='admin';set role authenticated");
    await batch(db,'borrow',[item('C2')]);
    await batch(db,'return',[item('C2')]);
    assert.equal((await db.query("select count(*)::int n from equipment_return_checks where confirmed_at is null")).rows[0].n,1);
    await assert.rejects(batch(db,'prepare',[item('C2'),item('C2',2)]), /รอตรวจ/);
    assert.equal((await db.query("select count(*)::int n from prepare_records where equipment_number='2'")).rows[0].n,0);
  } finally {await db.close();}
});
test("physical return confirmation preserves legacy returns and signs staff's missing-return preparation atomically", async()=>{
  const db=await setup();
  try {
    await db.exec("insert into assets(type,no)values('C2',1)");
    await batch(db,'deliver',[item('C2')]);await batch(db,'return',[item('C2')]);
    await db.exec("reset role");
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261117140000_return_receipt_confirmation.sql'),'utf8'));
    await db.exec("set role authenticated");
    assert.equal((await db.query("select is_return_pending from equipment_status")).rows[0].is_return_pending,false);
    await batch(db,'deliver',[item('C2')]);
    const holder=(await db.query("select * from equipment_status")).rows[0];
    const payload={mode:'prepare',items:[item('C2')],ward:'ICU',name:'Staff',unreturned:[{...item('C2'),ward:holder.ward,lastUpdate:holder.recorded_at}]};
    const id='40000000-0000-4000-8000-000000000001';
    await db.query("select mems_equipment_batch($1,$2::jsonb)",[id,JSON.stringify(payload)]);
    await db.query("select mems_equipment_batch($1,$2::jsonb)",[id,JSON.stringify(payload)]);
    const checks=(await db.query("select * from equipment_return_checks")).rows;
    assert.equal(checks.length,1);assert.equal(checks[0].confirmed_by,'Staff');assert.ok(checks[0].confirmed_at);
  } finally {await db.close();}
});

test('return receipt switch pauses pending checks and queues only returns made while enabled', async()=>{
 const db=await setup(true);
 try {
  await db.exec("reset role;create table public.app_settings(id text primary key,bool_value boolean not null);grant select on app_settings to authenticated;");
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261117150000_return_receipt_setting.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261117160000_return_receipt_disabled_preparation.sql'),'utf8'));
  await db.exec('set role authenticated');
  await db.exec("insert into assets(type,no)values('C2',1)");
  await batch(db,'deliver',[item('C2')]);await batch(db,'return',[item('C2')]);
  await assert.rejects(batch(db,'prepare',[item('C2')]),/รอตรวจ/);
  await db.exec("reset role;update app_settings set bool_value=false;set role authenticated");
  assert.equal((await db.query('select is_return_pending from equipment_status')).rows[0].is_return_pending,false);
  await batch(db,'deliver',[item('C2')]);await batch(db,'return',[item('C2')]);
  assert.equal((await db.query('select count(*)::int n from equipment_return_checks')).rows[0].n,1);
  await batch(db,'deliver',[item('C2')]);
  const holder=(await db.query('select * from equipment_status')).rows[0];
  await db.query('select mems_equipment_batch($1,$2::jsonb)',[crypto.randomUUID(),JSON.stringify({mode:'prepare',items:[item('C2')],ward:'ICU',name:'Staff',unreturned:[{...item('C2'),ward:holder.ward,lastUpdate:holder.recorded_at}]})]);
  await db.exec("update prepare_records set status='ยกเลิก: test' where status='เตรียม'");

  await db.exec("reset role;update app_settings set bool_value=true;set role authenticated");
  await assert.rejects(batch(db,'prepare',[item('C2')]),/รอตรวจ/);
 }finally{await db.close();}
});

test("Siri preparation requires a linked account, readback and confirmation before saving", async () => {
  const db = await setup(true);
  try {
    await db.exec("reset role; alter table public.user_profiles add column username text, add column display_name text");
    await db.exec(`update public.user_profiles set display_name='Siri Tester' where id='${user}'`);
    await db.exec("insert into public.assets(type,no) values ('High Flow',12),('High Flow',13),('High Flow',14)");
    await db.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261123033327_siri_voice_prepare.sql"), "utf8"));
    const link = async action => (await db.query("select public.mems_siri_prepare_link($1) value", [action])).rows[0].value;
    const request = async (code, action, phrase = null, id = null) => (await db.query(
      "select public.mems_siri_prepare($1,$2,$3,$4) value", [code, action, phrase, id],
    )).rows[0].value;
    const records = async () => (await db.query("select * from public.prepare_records order by id")).rows;
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
    const { code } = await link("create");
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(() => link("create"), /permission denied/);
    await assert.rejects(() => db.query("select code_hash from private.mems_siri_prepare_links"), /permission denied/);
    assert.equal((await request("a".repeat(64), "preview", "High Flow เบอร์ 12 ให้ ER")).status, "error");
    const preview = await request(code, "preview", "เตรียมเครื่องมือ High Flow ให้กับหน่วยงาน ER เบอร์ 12");
    assert.equal(preview.status, "preview");
    assert.match(preview.message, /High Flow เบอร์ 12 ให้ ER/);
    assert.equal((await records()).length, 0);
    assert.equal((await request(code, "confirm", "ไม่ยืนยัน", preview.draft_id)).status, "error");
    assert.equal((await request(code, "confirm", "ยกเลิก", preview.draft_id)).status, "cancelled");
    assert.equal((await request(code, "confirm", "ยืนยัน", preview.draft_id)).status, "error");
    assert.equal((await request(code, "preview", "High Flow เบอร์ 1 2 ให้ ER")).status, "error");
    const again = await request(code, "preview", "เตรียมเครื่องมือให้หน่วยงาน ER เครื่อง High Flow เบอร์ ๑๒");
    assert.equal(again.status, "preview");
    const saved = await request(code, "confirm", "ยืนยัน.", again.draft_id);
    assert.equal(saved.status, "saved");
    assert.match(saved.message, /High Flow เบอร์ 12 ให้ ER แล้ว/);
    assert.deepEqual(await request(code, "confirm", "ยืนยัน", again.draft_id), saved);
    assert.equal((await records()).length, 1);
    assert.equal((await records())[0].actor_user_id, user);
    assert.equal((await records())[0].prepared_by, "Siri Tester เจ้าหน้าที่ศูนย์เครื่องมือแพทย์");
    assert.equal((await db.query("select auth.uid() actor")).rows[0].actor, null);
    assert.equal((await request(code, "preview", "ไฮโฟลว์ เบอร์สิบสอง ให้ห้องฉุกเฉิน")).status, "error");

    const race = await request(code, "preview", "ไฮโฟลว์ เบอร์สิบสาม ให้ห้องฉุกเฉิน");
    assert.equal(race.status, "preview");
    await db.exec("reset role; update public.assets set status='ส่งซ่อม' where type='High Flow' and no=13; set role anon");
    assert.equal((await request(code, "confirm", "ยืนยัน", race.draft_id)).status, "error");
    assert.equal((await records()).length, 1);
    await db.exec(`reset role; update public.user_profiles set role='staff',permissions=array['borrow'] where id='${user}'; set role anon`);
    assert.equal((await request(code, "preview", "High Flow เบอร์ 14 ให้ ER")).status, "error");
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
    await assert.rejects(() => link("create"), /ไม่มีสิทธิ์/);
    assert.equal((await link("revoke")).status, "revoked");
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");
    assert.equal((await request(code, "preview", "High Flow เบอร์ 14 ให้ ER")).status, "error");
  } finally {
    await db.close();
  }
});
