/* Real browser → local API adapter → disposable PostgreSQL. No production writes. */
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { chromium } = require("playwright");
const root = path.join(__dirname, "..");
const uuid = "10000000-0000-4000-8000-000000000001";
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
  "Custom device",
];
const fakeClient = `window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:{user:{id:'${uuid}'}}}})},channel(){return {on(){return this},subscribe(){return this},unsubscribe(){}}},from(table){const q={table,filters:[],orders:[]};const b={select(columns){q.columns=columns;return this},eq(k,v){q.filters.push([k,v]);return this},in(k,v){q.in=[k,v];return this},order(k,o){q.orders.push([k,o]);return this},range(a,z){q.range=[a,z];return this},limit(n){q.limit=n;return this},single(){q.single=true;return this},insert(rows){q.insert=rows;return this},update(values){q.update=values;return this},then(resolve,reject){return fetch('/test-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q)}).then(r=>r.json()).then(resolve,reject)}};return b},rpc(name,args){return fetch('/test-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rpc:name,args})}).then(r=>r.json())}}}};`;
(async () => {
  if (!process.env.MEMS_TEST_PG)
    throw new Error("Set MEMS_TEST_PG to a disposable local PostgreSQL server");
  const admin = new Client({ connectionString: process.env.MEMS_TEST_PG });
  await admin.connect();
  const name = "mems_browser_" + Date.now();
  await admin.query(
    `create database ${name} encoding 'UTF8' template template0`,
  );
  const db = new Client({
    connectionString: process.env.MEMS_TEST_PG.replace(/\/[^/]*$/, "/" + name),
  });
  await db.connect();
  let browser, server;
  try {
    await db.query(
      fs.readFileSync(
        path.join(__dirname, "fixtures/lifecycle-baseline.sql"),
        "utf8",
      ),
    );
    const catalog = require("./fixtures/production-triggers.json");
    for (const f of catalog.functions) await db.query(f);
    for (const t of catalog.triggers) await db.query(t);
    await db.query(
      `insert into auth.users values('${uuid}');insert into user_profiles(id,active,role) values('${uuid}',true,'admin');`,
    );
    for (const table of ["assets", "borrow_records", "prepare_records"])
      await db.query(
        `alter table ${table} enable row level security;create policy read on ${table} for select using(true);create policy write on ${table} for all to authenticated using(${table === "assets" ? "private.has_permission('assets')" : "private.is_active_user()"}) with check(${table === "assets" ? "private.has_permission('assets')" : "private.is_active_user()"});`,
      );
    await db.query(
      fs.readFileSync(
        path.join(
          root,
          "supabase/migrations/20261022031655_registry_equipment_lifecycle.sql",
        ),
        "utf8",
      ),
    );
    await db.query(
      fs.readFileSync(
        path.join(
          root,
          "supabase/migrations/20261022042356_registry_lock_rls.sql",
        ),
        "utf8",
      ),
    );
    for (const type of types)
      await db.query("insert into assets(type,no)values($1,1)", [type]);
    await db.query(
      "insert into assets(type,no,status)values('C2',2,'ส่งซ่อม')",
    );
    // Dedicated recommendation fixtures: enough machines to verify the 15-item cap.
    await db.query("insert into assets(type,no) select 'Priority test',generate_series(1,20)");
    await db.query("set session_replication_role=replica");
    await db.query(`insert into borrow_records(record_date,record_time,equipment_name,equipment_number,ward,staff_name,action,recorded_at)
      select current_date,localtime, 'Priority test',n::text,'ER','test','คืน',now()-n*interval '1 day'
      from generate_series(1,18) n`);
    await db.query("set session_replication_role=origin");
    await db.query(
      `set role authenticated;select set_config('request.jwt.claim.sub','${uuid}',false)`,
    );
    const identifier = (s) => {
      if (!/^[a-z_]+$/.test(s)) throw new Error("invalid identifier");
      return '"' + s + '"';
    };
    server = http.createServer(async (req, res) => {
      if (req.url === "/test-api") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const q = JSON.parse(body);
        try {
          let data;
          if (q.rpc) {
            data = (
              await db.query(
                "select public.mems_equipment_batch($1,$2::jsonb) result",
                [q.args.request_id, JSON.stringify(q.args.payload)],
              )
            ).rows[0].result;
          } else if (q.table === "app_settings") data = [];
          else {
            assert.ok(
              [
                "assets",
                "borrow_records",
                "prepare_records",
                "equipment_status",
              ].includes(q.table),
            );
            const values = [],
              where = (q.filters || []).map(([k, v]) => {
                values.push(v);
                return identifier(k) + "=$" + values.length;
              });
            if (q.in) {
              values.push(q.in[1]);
              where.push(identifier(q.in[0]) + "=any($" + values.length + ")");
            }
            let sql =
              "select * from " +
              identifier(q.table) +
              (where.length ? " where " + where.join(" and ") : "");
            if (q.update) {
              const offset = values.length;
              const sets = Object.entries(q.update).map(([k, v], i) => {
                values.push(v);
                return identifier(k) + "=$" + (offset + i + 1);
              });
              sql =
                "update " +
                identifier(q.table) +
                " set " +
                sets.join(",") +
                (where.length ? " where " + where.join(" and ") : "") +
                " returning *";
            } else {
              if (q.orders?.length)
                sql +=
                  " order by " +
                  q.orders
                    .map(
                      ([k, o]) =>
                        identifier(k) +
                        (o?.ascending === false ? " desc" : " asc"),
                    )
                    .join(",");
              if (q.range)
                sql +=
                  " limit " +
                  (q.range[1] - q.range[0] + 1) +
                  " offset " +
                  q.range[0];
              else if (q.limit) sql += " limit " + Number(q.limit);
            }
            data = (await db.query(sql, values)).rows;
            if (q.single) data = data[0] || null;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data, error: null }));
        } catch (e) {
          res.end(
            JSON.stringify({ data: null, error: { message: e.message } }),
          );
        }
      } else {
        const file = path.join(
          root,
          new URL(req.url, "http://localhost").pathname,
        );
        if (!file.startsWith(root + path.sep)) {
          res.writeHead(403).end();
          return;
        }
        try {
          const content = fs.readFileSync(file);
          const ext = path.extname(file);
          res.setHeader(
            "Content-Type",
            {
              ".js": "application/javascript",
              ".css": "text/css",
              ".html": "text/html",
              ".ttf": "font/ttf",
            }[ext] || "application/octet-stream",
          );
          res.end(content);
        } catch {
          res.writeHead(404).end();
        }
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + server.address().port;
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [],
      alerts = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error("PAGE ERROR", e.message);
    });
    page.on("dialog", async (d) => {
      alerts.push(d.message());
      console.log("DIALOG", d.message());
      await d.accept();
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(base + "/vendor/supabase.js"))
        return route.fulfill({
          contentType: "application/javascript",
          body: fakeClient,
        });
      if (url.startsWith(base + "/auth.js"))
        return route.fulfill({
          contentType: "application/javascript",
          body: "async function memsGuard(){document.querySelectorAll('#loginOverlay,#forbiddenOverlay').forEach(e=>e.style.display='none');return {active:true,role:'admin'}};function memsIsAdmin(){return false}",
        });
      if (!url.startsWith(base)) return route.abort();
      return route.continue();
    });
    const open = async (f) => {
      await page.goto(base + "/" + f);
      await page.waitForLoadState("networkidle");
    };
    const action = async (a) => {
      await page.evaluate((a) => {
        setAction(a);
        if (typeof memsHideQrScanPrompt === "function")
          memsHideQrScanPrompt(true);
      }, a);
    };
    const save = async (id, double = false) => {
      if (double)
        await page.evaluate((id) => {
          if (id === "#saveBtn") {
            savePrepare();
            savePrepare();
          } else {
            handleSubmit();
            handleSubmit();
          }
        }, id);
      else await page.click(id);
      const result = id === "#saveBtn" ? "#toast.show" : "#successScreen.show";
      await page.waitForSelector(result, { state: "visible" });
      const message = await page.locator(result).innerText();
      await page.waitForFunction(
        (id) => !document.querySelector(id).disabled,
        id,
      );
      if (id !== "#saveBtn") await page.click("#successScreen .reset-btn");
      return message;
    };
    const ward = async (w) => {
      await page.selectOption("#wardSel", w);
      await page.waitForLoadState("networkidle");
    };
    await open("prepare.html");
    await page.getByRole("button", { name: "Priority test", exact: true }).click();
    assert.equal(await page.locator("#readyEquipmentList button").count(), 15);
    assert.equal(await page.locator("#numberInputs button").count(), 0);
    assert.match(await page.locator("#readyEquipmentList button").first().innerText(), /No. 18/);
    assert.match(await page.locator("#readyEquipmentList button").last().innerText(), /No. 4/);
    assert.match(await page.locator("#readyEquipmentList button").first().innerText(), /18 วัน/);
    await page.locator("#readyEquipmentList button").first().click();
    assert.match(await page.locator("#lifecycleSelection").innerText(), /Priority test No.18/);
    assert.equal(await page.inputValue("#lifecycleManualNumber input"), "18");
    await page.locator("#readyEquipmentList button").first().click();
    assert.equal(await page.inputValue("#lifecycleManualNumber input"), "");
    await page.locator("#readyEquipmentList button").first().click();
    await page.locator("#readyEquipmentList button").nth(1).click();
    assert.equal(await page.inputValue("#lifecycleManualNumber input"), "17");
    assert.match(await page.locator("#lifecycleSelection").innerText(), /Priority test No.18/);
    assert.match(await page.locator("#lifecycleSelection").innerText(), /Priority test No.17/);
    await page.locator("#lifecycleManualNumber input").fill("20");
    await page.locator("#lifecycleManualNumber input").press("Enter");
    assert.match(await page.locator("#lifecycleSelection").innerText(), /Priority test No.20/);
    await page.locator("#lifecycleManualNumber input").fill("9999");
    await page.locator("#lifecycleManualNumber input").press("Enter");
    assert.match(alerts.pop(), /ไม่พบเครื่องพร้อมใช้/);
    assert.doesNotMatch(await page.locator("#lifecycleSelection").innerText(), /9999/);
    await open("prepare.html");
    await page.getByRole("button", { name: "C2", exact: true }).click();
    await page
      .locator("#readyEquipmentList button").filter({ hasText: "No. 1" })
      .click();
    assert.equal(
      await page
        .locator("#readyEquipmentList button").filter({ hasText: "No. 2" })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Syringe Pump", exact: true })
      .click();
    await page
      .locator("#readyEquipmentList button").filter({ hasText: "No. 1" })
      .click();
    await page.selectOption("#wardSel", "ER");
    await page.selectOption("#preparedBySel", "ปวริศ");
    assert.match(await save("#saveBtn"), /2 เครื่อง/);
    await page.getByRole("button", { name: "High Flow", exact: true }).click();
    await page
      .locator("#readyEquipmentList button").filter({ hasText: "No. 1" })
      .click();
    await page.selectOption("#wardSel", "ER");
    await page.evaluate(() =>
      document.getElementById("toast").classList.remove("show"),
    );
    assert.match(await save("#saveBtn"), /1 เครื่อง/);
    await page.getByRole("button", { name: "High Flow", exact: true }).click();
    assert.equal(await page.locator("#numberInputs button").count(), 0);
    const cancelId = (
      await db.query(
        "select id from prepare_records where equipment_type='High Flow' and status='เตรียม'",
      )
    ).rows[0].id;
    await page.evaluate((id) => openCancelModal(id), cancelId);
    await page.locator("#cancelModal .reason-btn").first().click();
    await page.waitForSelector("#readyEquipmentList button");
    assert.equal(
      await page
        .locator("#readyEquipmentList button").filter({ hasText: "No. 1" })
        .count(),
      1,
    );
    await open("borrow.html");
    await action("borrow");
    await ward("ER");
    assert.equal(await page.locator("#preparedBanner h4").count(), 2);
    await page.locator("#preparedBanner .lifecycle-number").nth(0).click();
    await page.locator("#preparedBanner .lifecycle-number").nth(1).click();
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /2 เครื่อง/);
    await action("return");
    await ward("ER");
    assert.equal(await page.locator("#preparedBanner small").count(), 2);
    const compactReturn = await page.waitForFunction(() => {
      const button = document.querySelector(".lifecycle-return-machine > button");
      const height = button?.getBoundingClientRect().height;
      return height > 0 && height <= 48;
    });
    assert.equal(await compactReturn.jsonValue(), true, "return number stays compact on mobile");
    assert.equal(await page.locator(".lifecycle-return-machine .lifecycle-transfer").count(), 2);
    await page
      .locator("#preparedBanner .lifecycle-number")
      .filter({ hasText: "No. 1" })
      .first()
      .click();
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /1 เครื่อง/);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from equipment_status where is_borrowed",
        )
      ).rows[0].n,
      1,
    );
    await action("return");
    await ward("ER");
    await page.locator("#preparedBanner .lifecycle-number").first().click();
    await ward("ICU 100 ปี");
    assert.equal(
      await page.locator("#preparedBanner [aria-pressed=true]").count(),
      0,
    );
    assert.match(
      await page.locator("#preparedBanner").innerText(),
      /ไม่มีเครื่อง/,
    );
    // Existing QR deep link must auto-select only the current holder's open loan.
    const syringe = (
      await db.query("select id from assets where type='Syringe Pump' and no=1")
    ).rows[0].id;
    await open("borrow.html?asset=" + syringe + "&mode=return");
    await page.waitForSelector("#preparedBanner [aria-pressed=true]");
    assert.equal(await page.inputValue("#wardSel"), "ER");
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /1 เครื่อง/);
    const custom = (
      await db.query("select id from assets where type='Custom device'")
    ).rows[0].id;
    await open("prepare.html");
    await page.evaluate(async (id) => {
      await memsHandlePrepareQrResult("MEMS:" + id);
      memsConfirmPrepareQrBatch();
    }, custom);
    assert.match(
      await page.locator("#prepareQrSelection").innerText(),
      /Custom device/,
    );
    await page.click("#modeDeliver");
    await page.selectOption("#wardSel", "ER");
    await page.selectOption("#preparedBySel", "ปวริศ");
    assert.match(await save("#saveBtn", true), /1 เครื่อง/);
    const delivered = await db.query(
      "select (select count(*)::int from prepare_records where equipment_type='Custom device') p,(select count(*)::int from borrow_records where equipment_name='Custom device' and action like '%ยืม%') b",
    );
    assert.deepEqual(delivered.rows[0], { p: 1, b: 1 });
    // Mixed QR preparation, borrowing and returning use the same atomic API.
    const scanned = (
      await db.query(
        "select id from assets where type in('C2','Defibrillator') and no=1 order by type",
      )
    ).rows.map((r) => r.id);
    await open("prepare.html");
    await page.evaluate(async (ids) => {
      for (const id of ids) await memsHandlePrepareQrResult("MEMS:" + id);
      memsConfirmPrepareQrBatch();
    }, scanned);
    await page.selectOption("#wardSel", "ER");
    await page.selectOption("#preparedBySel", "ปวริศ");
    assert.match(await save("#saveBtn"), /2 เครื่อง/);
    await open("borrow.html");
    await action("borrow");
    await ward("ER");
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        if (!(await memsAddPromptScan(id))) throw new Error("QR borrow failed");
      }
      await memsConfirmPromptScans();
    }, scanned);
    assert.equal(
      await page.locator("#preparedBanner [aria-pressed=true]").count(),
      2,
    );
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /2 เครื่อง/);
    await action("return");
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        if (!(await memsAddPromptScan(id))) throw new Error("QR return failed");
      }
      await memsConfirmPromptScans();
    }, scanned);
    assert.equal(
      await page.locator("#preparedBanner [aria-pressed=true]").count(),
      2,
    );
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /2 เครื่อง/);
    await open("c2-statistics.html");
    assert.equal(
      await page.locator("#typeSelect option").count(),
      types.length + 2,
    );
    assert.match(await page.locator("#summaryGrid").innerText(), /ครั้งยืม/);
    assert.doesNotMatch(await page.locator("body").innerText(), /ผู้ป่วย/);
    await page.click("[data-view=monthly]");
    assert.equal(await page.locator("#dailyTrend tbody tr").count(), 31);
    await page.click("[data-view=fiscal]");
    assert.equal(await page.locator("#fiscalTrend tbody tr").count(), 12);
    await page.click("[data-view=machine]");
    assert.equal(
      await page.locator("#viewOutput .detail-btn").count(),
      types.length + 21,
    );
    await page.locator("#viewOutput .detail-btn").first().click();
    assert.match(await page.locator("#machineDetail").innerText(), /รอบใช้งาน/);
    await page.click("#closeMachineDetail");
    await page.fill("#rangeStart", "2026-10-01");
    await page.fill("#rangeEnd", "2026-10-31");
    await page.locator("#rangeEnd").dispatchEvent("change");
    assert.match(await page.locator("#viewTitle").innerText(), /ช่วงวันที่/);
    const download = page.waitForEvent("download");
    await page.click("#csvBtn");
    assert.match((await download).suggestedFilename(), /\.csv$/);
    await page.click("#pdfBtn");
    await page.waitForSelector("#pdfPreviewModal:not([hidden])");
    assert.match(
      await page.locator("#pdfPreviewFrame").getAttribute("src"),
      /^blob:/,
    );
    await page.click("[data-close-pdf]");

    // A typed preparation ward must be selectable on another page after reload,
    // and remain available once its preparation has been consumed.
    const newWard = "ICU หน่วยงานใหม่ <ทดสอบ>";
    await open("prepare.html");
    await page.getByRole("button", { name: "High Flow", exact: true }).click();
    await page.locator("#lifecycleManualNumber input").fill("1");
    // Direct Save must consume the typed number without requiring Add/Enter.
    await page.selectOption("#wardSel", "อื่นๆ โปรดระบุชื่อตึก");
    await page.fill("#otherWard", "  " + newWard + "  ");
    await page.selectOption("#preparedBySel", "ปวริศ");
    assert.match(await save("#saveBtn"), /1 เครื่อง/);
    await open("borrow.html");
    assert.equal(await page.locator("#wardSel option").filter({ hasText: newWard }).count(), 1);
    await action("borrow");
    await ward(newWard);
    assert.equal(await page.inputValue("#wardSel"), newWard);
    assert.match(await page.locator("#preparedBanner").innerText(), /High Flow/);
    await page.locator("#preparedBanner .lifecycle-number").first().click();
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /1 เครื่อง/);
    await open("borrow.html");
    await action("return");
    await ward(newWard);
    await page.locator("#preparedBanner .lifecycle-number").first().click();
    await page.fill("#staffName", "Test");
    assert.match(await save("#submitBtn"), /1 เครื่อง/);
    await open("borrow.html");
    assert.equal(await page.locator("#wardSel option").filter({ hasText: newWard }).count(), 1);

    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 1024 });
      for (const f of ["prepare.html", "borrow.html", "c2-statistics.html"]) {
        await open(f);
        if (f === "prepare.html") {
          await page.getByRole("button", { name: "Priority test", exact: true }).click();
          assert.equal(await page.locator("#readyEquipmentList button").count(), 15);
        }
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          f + " overflow at " + width,
        );
        await page.screenshot({
          path: path.join(
            root,
            "work",
            f.replace(".html", "") + "-" + width + ".png",
          ),
          fullPage: true,
        });
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser: mixed preparation/borrow, partial return, ward reset, repair filtering, single/mixed QR, deliver counts, all-type statistics/trends, CSV/PDF, mobile/tablet layouts",
    );
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    await db.end();
    await admin.query(`drop database ${name} with(force)`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
