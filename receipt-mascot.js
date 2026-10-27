/* Continuous receipt companion and a screen-scoped wake lock. */
(() => {
  'use strict';
  const screen = document.getElementById('successScreen');
  const canvas = document.getElementById('receiptMascot');
  const ctx = canvas?.getContext('2d');
  if (!screen || !ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const sprite = new Image();
  let loaded = false, frame = 0, lastDraw = -Infinity, elapsed = 0, previous = null;
  let lock = null, pending = false, suspended = false;
  const active = () => !suspended && !document.hidden && screen.classList.contains('show');

  async function keepAwake() {
    if (!active() || lock || pending || !navigator.wakeLock) return;
    pending = true;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (!active()) { await acquired.release(); return; }
      lock = acquired;
      acquired.addEventListener('release', () => { if (lock === acquired) lock = null; });
    } catch { /* Unsupported or denied: leave the receipt usable. Retry on interaction. */ }
    finally { pending = false; }
  }
  function draw(now) {
    frame = 0;
    if (!active()) return;
    if (previous !== null) elapsed += Math.min(now - previous, 100);
    previous = now;
    if (loaded && now - lastDraw >= 40) {
      lastDraw = now;
      const width = canvas.clientWidth;
      // Travel across a reserved rail, turn, and continue without a resting timeout.
      const phase = (elapsed % 12000) / 6000;
      const left = phase >= 1;
      const progress = left ? 2 - phase : phase;
      const x = progress * Math.max(0, width - 56);
      const cell = Math.floor(elapsed / 125) % 8;
      const sw = sprite.width / 4, sh = sprite.height / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(canvas.width / Math.max(1, width), canvas.height / 72);
      ctx.translate(x + (left ? 56 : 0), 4);
      if (left) ctx.scale(-1, 1);
      ctx.drawImage(sprite, cell % 4 * sw, Math.floor(cell / 4) * sh, sw, sh, 4, 0, 48, 64);
      ctx.restore();
    }
    if (!reduced.matches) frame = requestAnimationFrame(draw);
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0; previous = null;
    if (active()) {
      keepAwake();
      if (loaded) draw(performance.now());
    } else {
      const old = lock; lock = null;
      if (old) old.release().catch(() => {});
    }
  }
  sprite.onload = () => { loaded = true; sync(); };
  sprite.src = new URL('img/mascot/mascot-walk-v2.webp', document.currentScript?.src || document.baseURI).href;
  new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  screen.addEventListener('pointerdown', keepAwake, { passive: true });
  screen.addEventListener('keydown', keepAwake);
  reduced.addEventListener('change', sync);
  addEventListener('resize', sync);
  addEventListener('pagehide', () => { suspended = true; sync(); });
  addEventListener('pageshow', () => { suspended = false; sync(); });
  sync();
})();
