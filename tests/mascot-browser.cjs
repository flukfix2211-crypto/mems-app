const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('header mascot reserves space and yields to forms, dialogs and user preferences', async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    try { res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'text/html'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); }
  catch (error) { server.close(); throw error; }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname !== '127.0.0.1' || (route.request().resourceType() === 'script' && !u.pathname.endsWith('/mascot.js'))) return route.abort();
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/prepare.html`);
    await page.evaluate(() => { const login = document.querySelector('#loginOverlay'); if (login) login.style.display = 'none'; });
    await page.locator('#mems-mascot').waitFor();
    await page.evaluate(() => sessionStorage.setItem('mems-guide-welcomed', '1'));
    await page.waitForTimeout(500);
    const formY = await page.locator('.content').evaluate(el => el.getBoundingClientRect().top);
    await page.locator('.mems-guide-call').click();
    await page.waitForTimeout(3800);
    assert.match(await page.locator('#mems-guide-tip').textContent(), /เลือกประเภทเครื่อง/);
    assert.equal(await page.locator('.content').evaluate(el => el.getBoundingClientRect().top), formY);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '/tmp/mascot-mobile.png', fullPage: false });
    // Programmatic modal opening must also silence the helper.
    await page.evaluate(() => { document.querySelector('#cancelModal').style.display = 'flex'; });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#mems-guide-tip').textContent(), '');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#mems-mascot').getAttribute('data-state'), 'rest');
    await page.evaluate(() => { document.querySelector('#cancelModal').style.display = 'none'; });
    await page.locator('.mems-guide-pause').click();
    assert.equal(await page.locator('.mems-guide-call').isDisabled(), true);
    await page.reload();
    assert.equal(await page.locator('.mems-guide-pause').getAttribute('aria-pressed'), 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.mems-guide-pause').click();
    await page.waitForTimeout(300);
    await page.locator('.mems-guide-call').click();
    assert.equal(await page.locator('#mems-mascot').getAttribute('data-state'), 'rest');
    assert.notEqual(await page.locator('#mems-guide-tip').textContent(), '');
    await page.locator('.number-input').first().focus();
    assert.equal(await page.locator('#mems-guide-tip').textContent(), '');
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
});
