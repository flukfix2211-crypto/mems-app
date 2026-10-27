/* MEMs header companion: reserved space, no form inspection or floating overlay. */
(() => {
  'use strict';
  if (document.getElementById('mems-mascot')) return;
  const source = document.currentScript?.src || document.baseURI;
  const asset = path => new URL(path, source).href;
  const header = document.querySelector('header.header, .header');
  if (!header) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const read = (key, storage) => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value, storage) => { try { storage.setItem(key, value); } catch {} };
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet'; sheet.href = asset('mascot.css?v=20261027-loop-1');
  document.head.append(sheet);
  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
  const tips = {
    index: 'เลือกเมนูยืม–คืนเครื่องมือ เพื่อเริ่มบันทึกรายการครับ',
    prepare: 'เลือกประเภทเครื่อง แล้วเพิ่มหมายเลขเครื่องได้เลยครับ',
    borrow: 'ตรวจประเภท หมายเลขเครื่อง และหน่วยงานก่อนบันทึกครับ',
    dashboard: 'เลือกประเภทเครื่อง เพื่อดูสถานะและรายการที่ต้องติดตามครับ',
    assets: 'ค้นหาเครื่องด้วยหมายเลขเครื่อง เลขครุภัณฑ์ หรือ S/N ครับ',
    round: 'เลือกหน่วยงาน แล้วบันทึกผลตรวจเครื่องมือครับ',
    fixjob: 'ระบุอาการและวิธีแก้ไข เพื่อให้ค้นประวัติย้อนหลังได้ครับ',
    settings: 'ตรวจสิทธิ์ผู้ใช้งานก่อนบันทึกการเปลี่ยนแปลงครับ',
    admin_report: 'ตรวจช่วงวันที่และรายงานก่อนดาวน์โหลดหรือพิมพ์ครับ'
  };
  const dock = document.createElement('section');
  dock.id = 'mems-mascot'; dock.setAttribute('aria-label', 'ผู้ช่วย MEMs');
  dock.innerHTML = `<div class="mems-guide-rail" aria-hidden="true">
    <div class="mems-guide-shadow"></div><canvas width="300" height="320"></canvas>
    <div class="mems-guide-home"><img alt="" src="${asset('logo.png')}"></div>
    <span class="mems-guide-floor"></span>
  </div>
  <div class="mems-guide-controls"><button type="button" class="mems-guide-call" aria-expanded="false" aria-controls="mems-guide-tip">คำแนะนำ</button><button type="button" class="mems-guide-pause" aria-pressed="false">พักผู้ช่วย</button></div>
  <div class="mems-guide-tip-slot"><p id="mems-guide-tip" role="status" aria-live="polite"></p><button type="button" class="mems-guide-close" aria-label="ปิดคำแนะนำ" hidden>×</button></div>`;
  header.append(dock);
  const rail = dock.querySelector('.mems-guide-rail');
  const canvas = dock.querySelector('canvas');
  const shadow = dock.querySelector('.mems-guide-shadow');
  const ctx = canvas.getContext('2d');
  const call = dock.querySelector('.mems-guide-call');
  const pause = dock.querySelector('.mems-guide-pause');
  const tip = dock.querySelector('p');
  const close = dock.querySelector('.mems-guide-close');
  if (!ctx) { dock.remove(); return; }
  let paused = read('mems-guide-paused', localStorage) === '1';
  let inView = true, state = 'rest', started = 0, raf = 0, timer = 0, speechTimer = 0;
  let x = -30, retreatFrom = 0, lastFrame = 0, distance = 0;
  let ready = false, destroyed = false;
  let screenLock = null, lockPending = false;
  async function keepScreenAwake() {
    if (destroyed || paused || document.hidden || screenLock || lockPending || !globalThis.navigator?.wakeLock) return;
    lockPending = true;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (destroyed || paused || document.hidden) { await acquired.release(); return; }
      screenLock = acquired;
      acquired.addEventListener('release', () => { if (screenLock === acquired) screenLock = null; });
    } catch { /* Browser or device policy may deny screen wake locks. */ }
    finally { lockPending = false; }
  }
  function syncScreenAwake() {
    if (!destroyed && !paused && !document.hidden) { keepScreenAwake(); return; }
    const old = screenLock; screenLock = null;
    if (old) old.release().catch(() => {});
  }
  const poses = {};
  const home = -30, end = 88;
  const duration = { peek: 1050, emerge: 800, walk: 1800, greet: 3500, turn: 220, turnRight: 220, back: 2400, retreat: 420 };
  const load = (name, path) => new Promise(resolve => {
    const image = new Image();
    image.onload = () => { poses[name] = image; resolve(); };
    image.onerror = () => resolve(); image.src = asset(path);
  });
  const visible = el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  function blocked() {
    return document.hidden || !inView || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '') ||
      document.activeElement?.isContentEditable ||
      [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"], #loginOverlay, #helpModal, #editModal, #cancelModal, #successScreen, .qr-scan-prompt')].some(visible);
  }
  function silence() {
    clearTimeout(speechTimer); tip.textContent = ''; close.hidden = true;
    call.setAttribute('aria-expanded', 'false');
  }
  function speak() {
    if (blocked() || paused) return;
    tip.textContent = tips[page] || 'แตะเมนูที่ต้องการเพื่อเริ่มใช้งาน MEMs ครับ';
    close.hidden = false; call.setAttribute('aria-expanded', 'true');
    clearTimeout(speechTimer); speechTimer = setTimeout(silence, 6000);
  }
  function draw(now, walking = false, facingLeft = false) {
    ctx.clearRect(0, 0, 300, 320);
    const image = poses.walk;
    ctx.save();
    if (state === 'turn' || state === 'turnRight') {
      const phase = Math.min(1, (now - started) / duration.turn);
      ctx.translate(150, 0); ctx.scale(Math.max(.2, Math.abs(Math.cos(phase * Math.PI))), 1); ctx.translate(-150, 0);
      facingLeft = state === 'turn' ? phase > .5 : phase < .5;
    }
    if (facingLeft) { ctx.translate(300, 0); ctx.scale(-1, 1); }
    if (walking && image) {
      // Frames advance with travel distance, so the feet do not keep cycling at a stop.
      const frame = Math.floor(distance / 5) % 8;
      const w = image.width / 4, h = image.height / 2;
      ctx.drawImage(image, frame % 4 * w, Math.floor(frame / 4) * h, w, h, 30, 0, 240, 320);
    } else {
      const blink = now % 4100 < 140;
      const pose = state === 'greet' && now - started < 1100 ? poses.wave : blink ? poses.blink : poses.idle;
      const img = pose || poses.idle;
      const breath = reduce.matches ? 0 : Math.sin(now / 850) * 1.4;
      if (img) ctx.drawImage(img, 0, breath, 300, 320);
    }
    ctx.restore();
    canvas.style.transform = `translateX(${x}px)`;
    shadow.style.transform = `translateX(${x + 14}px)`;
  }
  function rest() {
    cancelAnimationFrame(raf); raf = 0; state = 'rest'; x = home;
    dock.dataset.state = 'rest'; canvas.style.visibility = 'hidden'; shadow.style.visibility = 'hidden';
  }
  function change(next, now) { state = next; started = now; dock.dataset.state = next; }
  function retreat() {
    silence(); clearTimeout(timer);
    if (state === 'rest') return;
    if (reduce.matches || !inView || document.hidden) { rest(); return; }
    if (state !== 'retreat') { retreatFrom = x; change('retreat', performance.now()); }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    raf = 0;
    if (blocked() && state !== 'retreat') { retreat(); return; }
    if (state === 'rest') return;
    const t = Math.min(1, (now - started) / duration[state]);
    const before = x;
    if (state === 'peek') x = home + Math.sin(t * Math.PI / 2) * 14;
    else if (state === 'emerge') x = -16 + t * 44;
    else if (state === 'walk') x = 28 + t * (end - 28);
    else if (state === 'back') x = end - t * (end - 28);
    else if (state === 'retreat') x = retreatFrom + (home - retreatFrom) * (t * t * (3 - 2 * t));
    distance += Math.abs(x - before);
    const walking = ['emerge', 'walk', 'back', 'retreat'].includes(state);
    // Limit drawing work to 30fps; movement remains driven by elapsed time.
    if (now - lastFrame >= 32 || t === 1) { draw(now, walking, ['back', 'retreat', 'turn'].includes(state)); lastFrame = now; }
    if (t === 1) {
      if (state === 'peek') change('emerge', now);
      else if (state === 'emerge') change('walk', now);
      else if (state === 'walk') {
        if (!read('mems-guide-welcomed', sessionStorage)) {
          speak(); write('mems-guide-welcomed', '1', sessionStorage);
        }
        change('turn', now);
      }
      else if (state === 'greet') { silence(); change('turn', now); }
      else if (state === 'turn') change('back', now);
      else if (state === 'back') change('turnRight', now);
      else if (state === 'turnRight') change('walk', now);
      else { rest(); return; }
    }
    raf = requestAnimationFrame(tick);
  }
  function start(manual = false) {
    if (!ready || paused || blocked() || destroyed) return;
    clearTimeout(timer);
    if (reduce.matches) { speak(); return; }
    if (state !== 'rest') { if (manual) speak(); return; }
    distance = 0; x = home; change('peek', performance.now());
    canvas.style.visibility = 'visible'; shadow.style.visibility = 'visible';
    raf = requestAnimationFrame(tick);
  }
  function scheduleWelcome() {
    clearTimeout(timer);
    if (!ready || paused || reduce.matches || blocked()) return;
    timer = setTimeout(() => {
      if (blocked() || paused) return;
      start();
    }, 350);
  }
  function updatePause() {
    pause.textContent = paused ? 'เปิดผู้ช่วย' : 'พักผู้ช่วย';
    pause.setAttribute('aria-pressed', String(paused));
    call.disabled = paused;
    syncScreenAwake();
  }
  call.addEventListener('click', () => start(true));
  pause.addEventListener('click', () => {
    paused = !paused; write('mems-guide-paused', paused ? '1' : '0', localStorage);
    updatePause(); if (paused) retreat(); else start(true);
  });
  close.addEventListener('click', retreat);
  function activity(event) {
    keepScreenAwake();
    if (dock.contains(event.target)) return;
    retreat(); scheduleWelcome();
  }
  ['pointerdown', 'keydown', 'focusin', 'wheel', 'touchstart'].forEach(name => document.addEventListener(name, activity, { passive: true }));
  document.addEventListener('focusout', () => { clearTimeout(timer); timer = setTimeout(scheduleWelcome, 0); });
  addEventListener('scroll', activity, { passive: true });
  addEventListener('resize', () => { retreat(); scheduleWelcome(); });
  document.addEventListener('visibilitychange', () => { syncScreenAwake(); retreat(); if (!document.hidden) scheduleWelcome(); });
  reduce.addEventListener('change', () => { silence(); rest(); scheduleWelcome(); });
  const observer = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (!inView) { silence(); rest(); } else scheduleWelcome();
  });
  observer.observe(rail);
  // Programmatic dialogs can appear without a click. Observe visibility changes only.
  const modals = new MutationObserver(() => { if (blocked()) retreat(); else scheduleWelcome(); });
  // Observe dialog containers, not the companion's own animation styles.
  document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"], #loginOverlay, #helpModal, #editModal, #cancelModal, #successScreen, .qr-scan-prompt').forEach(el =>
    modals.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden'] }));
  addEventListener('pagehide', () => { destroyed = true; syncScreenAwake(); clearTimeout(timer); silence(); rest(); });
  addEventListener('pageshow', event => { if (event.persisted) { destroyed = false; syncScreenAwake(); scheduleWelcome(); } });
  updatePause(); rest();
  Promise.all(['idle', 'blink', 'wave'].map(name => load(name, `img/mascot/mascot-${name}.png`)).concat(load('walk', 'img/mascot/mascot-walk-v2.webp'))).then(() => {
    ready = !!poses.idle; if (ready) scheduleWelcome();
    else { call.disabled = true; pause.disabled = true; }
  });
})();
