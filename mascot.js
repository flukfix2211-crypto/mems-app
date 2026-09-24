/* MEMs animated guide. It never intercepts clicks or reads form data. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches || document.getElementById('mems-mascot')) return;

  const scriptUrl = document.currentScript?.src || document.baseURI;
  const images = {};
  Promise.all(['idle', 'blink', 'wave', 'welcome'].map(name => new Promise(resolve => {
    const image = new Image();
    image.onload = () => { images[name] = image; resolve(); };
    image.onerror = resolve;
    image.src = new URL(`img/mascot/mascot-${name}.png`, scriptUrl).href;
  }))).then(() => {
    if (!images.idle) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  });

  function init() {
    if (reduce.matches || document.getElementById('mems-mascot')) return;

    const tips = {
      index: ['เริ่มยืม–คืนเครื่องมือได้จากเมนูแรกเลยครับ', 'เลือกเมนูที่ต้องการได้เลย ผมอยู่ช่วยตรงนี้ครับ'],
      dashboard: ['ดูสถานะเครื่องและงานที่ต้องติดตามได้ในหน้านี้ครับ', 'กดอัปเดตข้อมูล เพื่อดูสถานะล่าสุดก่อนเริ่มงานนะครับ'],
      borrow: ['ตรวจหมายเลขเครื่องและหน่วยงานก่อนบันทึกทุกครั้งนะครับ', 'ถ้าเป็นการคืนเครื่อง อย่าลืมตรวจสภาพก่อนรับคืนครับ'],
      prepare: ['เตรียมหลายเครื่องได้ โดยคั่นหมายเลขด้วยจุลภาคครับ', 'ตรวจรายการให้ครบ แล้วค่อยเปลี่ยนเป็น “พร้อมส่ง” นะครับ'],
      assets: ['ค้นหาได้จาก No. เลขครุภัณฑ์ หรือ S/N ครับ', 'ตรวจสถานะเครื่องก่อนแก้ไขข้อมูล เพื่อป้องกันรายการซ้ำครับ'],
      fixjob: ['ระบุอาการและวิธีแก้ไขให้ครบ จะค้นประวัติย้อนหลังง่ายขึ้นครับ', 'บันทึกวันที่และผู้รับผิดชอบให้ครบก่อนปิดงานนะครับ'],
      round: ['เลือก Ward ก่อน แล้วตรวจเครื่องทีละรายการได้เลยครับ', 'พบความผิดปกติ บันทึกรายละเอียดไว้ได้ทันทีครับ'],
      admin_report: ['ตรวจรายงานในหน้าพรีวิว ก่อนดาวน์โหลดหรือพิมพ์นะครับ', 'เลือกช่วงวันที่ให้ครบ เพื่อให้รายงานตรงกับงานที่ต้องการครับ'],
      settings: ['ตรวจสิทธิ์ผู้ใช้ก่อนบันทึกการเปลี่ยนแปลงนะครับ', 'บัญชีผู้ใช้และสิทธิ์เข้าถึง จัดการได้จากหน้านี้ครับ']
    };
    const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
    const pageTips = tips[page] || tips.index;

    const stage = document.createElement('div');
    stage.id = 'mems-mascot';
    stage.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:340;overflow:hidden;font-family:inherit';
    const bubble = document.createElement('div');
    bubble.className = 'mems-mascot-bubble';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.style.cssText = 'position:absolute;box-sizing:border-box;max-width:calc(100vw - 32px);padding:11px 14px;border:1px solid rgba(8,111,123,.22);border-radius:14px;background:#fff;box-shadow:0 12px 34px rgba(8,45,57,.16);color:#123342;font-size:14px;line-height:1.55;font-weight:600;opacity:0;visibility:hidden;transform:translateY(8px) scale(.97);transition:opacity .22s ease,transform .22s ease,visibility .22s;text-align:left';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;width:130px;height:139px;pointer-events:none;will-change:transform';
    stage.append(bubble, canvas);
    document.body.appendChild(stage);

    const ctx = canvas.getContext('2d');
    if (!ctx) { stage.remove(); return; }
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = 300 * ratio;
    canvas.height = 320 * ratio;

    let state = 'hidden', since = 0, lastActivity = performance.now(), cooldown = 0;
    let x = 0, y = 0, from = 0, to = 0, direction = 1, speechUntil = 0;
    let welcomed = false, tipIndex = Math.floor(Math.random() * pageTips.length);
    let nextBlink = performance.now() + 2300, blinkUntil = 0, frame = 0;
    const duration = { enter: 2100, welcome: 4800, wave: 2500, leave: 2200, patrol: 6800 };
    const width = () => innerWidth < 540 ? 96 : 130;
    const height = () => width() * 320 / 300;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const smooth = t => t * t * (3 - 2 * t);
    const lerp = (a, b, t) => a + (b - a) * t;

    function blocked() {
      const active = document.activeElement?.tagName || '';
      const namedModal = ['loginOverlay', 'helpModal', 'editModal'].some(id => {
        const el = document.getElementById(id);
        return el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      });
      return document.hidden || reduce.matches || /^(INPUT|SELECT|TEXTAREA)$/.test(active) ||
        !!document.querySelector('dialog[open], [role="dialog"][aria-hidden="false"]') || namedModal;
    }

    function safeBottom() {
      const bar = document.querySelector('.submit-bar');
      if (!bar) return 14;
      const rect = bar.getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0 ? rect.height + 16 : 14;
    }

    function setState(next, now) { state = next; since = now; }
    function greeting() {
      const hour = new Date().getHours();
      if (hour < 12) return 'สวัสดีตอนเช้าครับ 👋 พร้อมเริ่มงานกันไหมครับ';
      if (hour < 17) return 'สวัสดีตอนบ่ายครับ 👋 มีอะไรให้ MEMs ช่วยไหมครับ';
      return 'สวัสดีตอนเย็นครับ 👋 วันนี้เหนื่อยไหมครับ';
    }

    function positionBubble() {
      if (bubble.style.visibility === 'hidden') return;
      const bw = Math.min(innerWidth < 540 ? 190 : 250, innerWidth - 32);
      const left = direction > 0
        ? clamp(x + width() * .62, 16, innerWidth - bw - 16)
        : clamp(x - bw + width() * .35, 16, innerWidth - bw - 16);
      bubble.style.width = `${bw}px`;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${clamp(y - 58, 16, innerHeight - 120)}px`;
      bubble.style.transformOrigin = direction > 0 ? 'bottom left' : 'bottom right';
    }

    function speak(text, ms = 4200) {
      bubble.textContent = text;
      bubble.style.visibility = 'visible';
      bubble.style.opacity = '1';
      bubble.style.transform = 'translateY(0) scale(1)';
      speechUntil = performance.now() + ms;
      positionBubble();
    }

    function silence() {
      speechUntil = 0;
      bubble.style.opacity = '0';
      bubble.style.transform = 'translateY(8px) scale(.97)';
      bubble.style.visibility = 'hidden';
    }

    function hide() {
      state = 'hidden';
      canvas.style.visibility = 'hidden';
      silence();
    }

    function startWelcome(now) {
      direction = 1;
      from = -width() - 18;
      to = innerWidth < 540 ? 14 : 32;
      x = from;
      y = Math.max(10, innerHeight - height() - safeBottom());
      setState('enter', now);
    }

    function startPatrol(now) {
      const left = Math.random() > .5;
      direction = left ? 1 : -1;
      from = left ? -width() - 18 : innerWidth + 18;
      to = left ? innerWidth + 18 : -width() - 18;
      x = from;
      y = Math.max(10, innerHeight - height() - safeBottom());
      setState('patrol', now);
    }

    function part(sx, sy, sw, sh, px, py, angle) {
      ctx.save(); ctx.translate(px, py); ctx.rotate(angle);
      ctx.drawImage(images.idle, sx, sy, sw, sh, sx - px, sy - py, sw, sh);
      ctx.restore();
    }

    function arm(left, angle, elbow) {
      ctx.save();
      const px = left ? 92 : 185, py = 120;
      ctx.translate(px, py); ctx.rotate(angle); ctx.translate(-px, -py);
      if (left) {
        part(62, 112, 39, 51, 92, 120, 0); part(51, 160, 43, 66, 77, 160, elbow);
      } else {
        part(179, 112, 36, 52, 185, 120, 0); part(185, 162, 40, 67, 199, 162, elbow);
      }
      ctx.restore();
    }

    function drawWalking(now) {
      const cycle = ((now - since) % 560) / 560 * Math.PI * 2;
      const stride = Math.sin(cycle), bob = -Math.abs(stride) * 5, sway = stride * .035;
      ctx.save(); ctx.translate(150, 0); ctx.scale(direction, 1); ctx.translate(-140, 5 + bob);
      ctx.fillStyle = 'rgba(7,50,60,.13)'; ctx.beginPath();
      ctx.ellipse(139, 300 - bob, 54 - Math.abs(stride) * 4, 7, 0, 0, Math.PI * 2); ctx.fill();
      part(88, 187, 52, 108, 120, 191, stride * .27);
      part(140, 187, 53, 108, 158, 191, -stride * .27);
      arm(false, stride * .30, -stride * .08);
      part(99, 109, 82, 84, 140, 151, -sway * .55);
      arm(true, -stride * .30, stride * .08);
      part(68, 0, 141, 111, 140, 107, sway);
      ctx.restore();
    }

    function drawPose(now) {
      let pose = state === 'welcome' ? 'welcome' : state === 'wave' ? 'wave' : 'idle';
      if (pose === 'idle' && now >= nextBlink) {
        blinkUntil = now + 170;
        nextBlink = now + 2600 + Math.random() * 2600;
      }
      if (pose === 'idle' && now < blinkUntil && images.blink) pose = 'blink';
      const image = images[pose] || images.idle;
      const breath = Math.sin(now / 620), bob = state === 'wave' ? Math.sin(now / 170) * 1.2 : breath * 1.4;
      ctx.save(); ctx.translate(150, 0); ctx.scale(direction, 1); ctx.translate(-150, bob);
      ctx.fillStyle = 'rgba(7,50,60,.12)'; ctx.beginPath();
      ctx.ellipse(150, 302 - bob, 54 + breath * 2, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(image, 0, 0, 300, 320); ctx.restore();
    }

    function draw(now) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, 300, 320);
      if (['enter', 'leave', 'patrol'].includes(state)) drawWalking(now); else drawPose(now);
      canvas.style.width = `${width()}px`; canvas.style.height = `${height()}px`;
      canvas.style.transform = `translate3d(${x}px,${y}px,0)`;
      canvas.style.visibility = 'visible'; positionBubble();
    }

    function tick(now) {
      if (blocked()) {
        if (state !== 'hidden') hide();
        lastActivity = now;
      } else if (state === 'hidden') {
        if (!welcomed && now - lastActivity > 1400) {
          welcomed = true; startWelcome(now);
        } else if (welcomed && now - lastActivity > 32000 && now > cooldown) startPatrol(now);
      }

      if (state !== 'hidden') {
        const phase = clamp((now - since) / (duration[state] || 3000), 0, 1);
        if (state === 'enter') x = lerp(from, to, smooth(phase));
        if (state === 'leave') x = lerp(from, -width() - 20, smooth(phase));
        if (state === 'patrol') x = lerp(from, to, smooth(phase));
        if (state === 'enter' && phase > .7 && !speechUntil) speak(greeting(), 4300);
        if (state === 'patrol' && phase > .3 && phase < .72 && !speechUntil) {
          speak(pageTips[tipIndex++ % pageTips.length], 4200);
        }
        if (speechUntil && now >= speechUntil) silence();
        draw(now);

        if (phase >= 1) {
          if (state === 'enter') setState('welcome', now);
          else if (state === 'welcome') {
            speak(pageTips[tipIndex++ % pageTips.length], 3900); setState('wave', now);
          } else if (state === 'wave') {
            silence(); from = x; direction = -1; setState('leave', now);
          } else {
            const finishedPatrol = state === 'patrol';
            hide(); cooldown = now + (finishedPatrol ? 85000 : 65000); lastActivity = now;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    }

    function activity() {
      lastActivity = performance.now();
      if (state !== 'hidden') { hide(); cooldown = lastActivity + 25000; }
    }
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(name => document.addEventListener(name, activity, { passive: true }));
    addEventListener('resize', activity);
    addEventListener('scroll', activity, { passive: true });
    document.addEventListener('visibilitychange', activity);
    reduce.addEventListener('change', activity);
    addEventListener('pagehide', () => { cancelAnimationFrame(frame); hide(); });
    addEventListener('pageshow', event => {
      if (event.persisted) { lastActivity = performance.now(); frame = requestAnimationFrame(tick); }
    });
    hide(); frame = requestAnimationFrame(tick);
  }
})();

