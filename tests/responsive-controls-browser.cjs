/* Layout and selection checks against local fixtures; no production requests. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const types = ['Brid เขียว', 'C2', 'High Flow', 'Infusion Pump', 'Monnal t60', 'NIBP', 'Patient Monitor', 'Syringe Pump', 'T1'];
const assets = types.flatMap((type, index) => [1, 2].map(no => ({ id: index * 2 + no, type, no, status: 'ใช้งานได้' })));
const fake = `window.supabase={createClient(){return {from(table){let single=false;const q={select(){return q},eq(){return q},in(){return q},is(){return q},order(){return q},range(){return q},limit(){return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve,reject){return Promise.resolve({data:table==='assets'?${JSON.stringify(assets)}:single?null:[],error:null}).then(resolve,reject)}};return q}}}};`;

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.dismiss());
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/vendor/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: fake });
      if (url.pathname === '/auth.js') return route.fulfill({ contentType: 'text/javascript', body: `async function memsGuard(){document.getElementById('memsUserBadge').textContent='เจ้าหน้าที่ทดสอบ · ผู้ดูแลระบบ';return {role:'admin'}}` });
      return route.continue();
    });
    await page.goto(base + '/prepare.html');
    await page.waitForFunction(() => document.querySelectorAll('#equipGrid button').length === 9);
    for (const [width, height] of [[320,740],[390,844],[480,844],[600,900],[768,1024],[1024,768],[1440,1000],[1920,1080],[844,390]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${width}`);
      const bounds = await page.locator('#equipGrid button, .mode-toggle button, #lifecycleManualNumber button, #saveBtn').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect();
        return { text: node.textContent, left: r.left, right: r.right, height: r.height, clipped: node.scrollWidth > node.clientWidth + 1 };
      }));
      for (const box of bounds) {
        assert.ok(box.left >= 0 && box.right <= width + 1, `offscreen ${box.text} at ${width}`);
        assert.ok(box.height >= 44, `small tap target ${box.text} at ${width}`);
        assert.equal(box.clipped, false, `clipped ${box.text} at ${width}`);
      }
      const mode = await page.locator('.prepare-mode-card').boundingBox();
      const choices = await page.locator('.prepare-types-card').boundingBox();
      assert.ok(choices.y >= mode.y + mode.height, 'equipment choices follow the mode without a tall empty column');
      await page.locator('#equipGrid button').filter({ hasText: /^C2$/ }).click();
      await page.locator('#lifecycleManualNumber input').fill('1');
      await page.locator('#lifecycleManualNumber button').click();
      await assert.match(await page.locator('#lifecycleSelection').textContent(), /C2 No\.1/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `selected state overflow at ${width}`);
      if (width === 390 || width === 1440) await page.screenshot({ path: path.join(root, `work/prepare-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    for (const file of ['borrow.html', 'round.html', 'fixjob.html', 'assets.html']) {
      await page.goto(base + '/' + file);
      for (const width of [320,390,768,1024,1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${file} overflow at ${width}`);
        const clipped = await page.locator('.content button').evaluateAll(nodes => nodes.filter(node =>
          node.checkVisibility() && node.scrollWidth > node.clientWidth + 1
        ).map(node => node.textContent.trim()));
        assert.deepEqual(clipped, [], `${file} clipped control labels at ${width}`);
      }
    }
    console.log('PASS: 9 viewport sizes, readable controls, 44px targets, compact preparation layout, equipment selection and adding a number.');
    console.log('PASS: borrow, round, fixjob and asset controls fit at 5 viewport widths.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
