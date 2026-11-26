/* Render the real preparation page with local inventory fixtures; no remote requests. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const base = "http://mems.test";

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === "/vendor/supabase.js") {
        return route.fulfill({ contentType: "application/javascript",
          body: "window.supabase={createClient(){return {}}};" });
      }
      if (url.pathname === "/auth.js") {
        return route.fulfill({ contentType: "application/javascript",
          body: "async function memsGuard(){return null}" });
      }
      const file = path.join(root, url.pathname);
      const contentType = { ".html": "text/html", ".js": "application/javascript",
        ".css": "text/css" }[path.extname(file)] || "application/octet-stream";
      await route.fulfill({ contentType, body: await fs.readFile(file) });
    });

    for (const type of ["C2", "High Flow", "Brid เขียว", "Infusion Pump"]) {
      const showAll = type !== "Infusion Pump";
      for (const count of showAll ? [25, 5, 0] : [25]) {
        const expectedCount = showAll ? count : 15;
        await page.goto(base + "/prepare.html");
        await page.evaluate(async ({ type, count }) => {
          const registry = [], status = [], prepared = [];
          const alias = { "High Flow": "HighFlow", "Brid เขียว": "Bird" }[type] || type;
          const add = (no, assetStatus = "ใช้งานได้", extra = {}) => {
            registry.push({ type, no, status: assetStatus });
            status.push({ equipment: alias, number: String(no), isBorrowed: false,
              lastUpdate: new Date(Date.UTC(2026, 10, 1, 0, no)).toISOString(), ...extra });
          };
          // Reverse registry order to prove that return dates determine the queue.
          for (let no = count; no > 0; no--) add(no);
          add(count + 1, "ใช้งานได้", { isBorrowed: true });
          add(count + 2, "ใช้งานได้", { isReturnPending: true });
          add(count + 3);
          prepared.push({ equipment: alias, number: String(count + 3) });
          add(count + 4, "ส่งซ่อม");
          add(count + 5);
          registry.push({ type, no: count + 5, status: "ใช้งานได้" });
          registry.push({ type, no: null, status: "ใช้งานได้" });
          fetchRegistryEquipment = async () => registry;
          fetchEquipmentStatus = async () => status;
          fetchPreparedList = async () => prepared;
          fetchPreparationWards = async () => [];
          memsLoadReturnChecks = async () => {};
          document.getElementById("loginOverlay").style.display = "none";
          await memsInitEquipmentLifecycle();
        }, { type, count });
        await page.getByRole("button", { name: type, exact: true }).click();
        const rows = page.locator("#readyEquipmentList button");
        assert.equal(await rows.count(), expectedCount, `${type}: ${expectedCount} recommendations`);
        assert.equal(await page.locator("#readyEquipmentCount").innerText(), `${expectedCount} ลำดับ`);
        assert.match(await page.locator("#readyEquipmentContext").innerText(),
          showAll ? /เครื่องพร้อมใช้ทั้งหมด/ : /15 อันดับแรก/);
        if (count) {
          assert.match(await rows.first().innerText(), /No\. 1\n/);
          assert.match(await rows.last().innerText(), new RegExp(`No\\. ${expectedCount}\\n`));
          await rows.last().click();
          assert.equal(await page.inputValue("#lifecycleManualNumber input"), String(expectedCount));
          // Changing selection must not truncate the queue on re-render.
          assert.equal(await rows.count(), expectedCount);
        } else {
          assert.match(await page.locator("#readyEquipmentList").innerText(), /ยังไม่มีเครื่องพร้อมใช้/);
        }
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        console.log(`PASS ${type}: ${expectedCount} recommendations; order, exclusions, selection, desktop/mobile`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
