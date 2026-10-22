const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const path = require("node:path");
const root = path.join(__dirname, "..");
const user = "10000000-0000-4000-8000-000000000001";
let seq = 0;
async function setup() {
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
    `insert into auth.users values('${user}');insert into public.user_profiles values('${user}',true,'admin');`,
  );
  for (const table of ["assets", "borrow_records", "prepare_records"])
    await db.exec(
      `alter table public.${table} enable row level security;create policy read on public.${table} for select using(true);create policy write on public.${table} for all to authenticated using(private.is_active_user()) with check(private.is_active_user());`,
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
      await assert.rejects(batch(db, "return", [i], "ICU"), /ตึกอื่น/);
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
        `reset role;insert into auth.users values('${second}');insert into user_profiles values('${second}',true,'admin');set role authenticated;`,
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
