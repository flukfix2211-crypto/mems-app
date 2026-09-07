/* MEMs mascot — small random walk-on gimmick, purely decorative. */
(function () {
  'use strict';

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var BASE = 'img/mascot/';
  var SPRITES = {
    idle: BASE + 'mascot-idle.png',
    blink: BASE + 'mascot-blink.png',
    wave: BASE + 'mascot-wave.png',
    welcome: BASE + 'mascot-welcome.png'
  };
  Object.keys(SPRITES).forEach(function (k) {
    var pre = new Image();
    pre.src = SPRITES[k];
  });

  var css =
    '#mems-mascot{position:fixed;width:64px;height:auto;pointer-events:none;' +
    'z-index:340;opacity:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.18));will-change:transform,opacity}' +
    '#mems-mascot img{display:block;width:100%;height:auto}' +
    '#mems-mascot.mems-mascot-visible{opacity:1}' +
    '#mems-mascot.mems-flip img{transform:scaleX(-1)}' +
    '@keyframes mems-walk-bob{0%,100%{margin-top:0}50%{margin-top:-4px}}' +
    '#mems-mascot.mems-walking img{animation:mems-walk-bob .5s ease-in-out infinite}' +
    '@media (max-width:480px){#mems-mascot{width:52px}}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var el = document.createElement('div');
    el.id = 'mems-mascot';
    var img = document.createElement('img');
    img.src = SPRITES.idle;
    img.alt = '';
    el.appendChild(img);
    document.body.appendChild(el);

    var menuBtn = document.getElementById('menuBtn');
    var busy = false;

    function rand(min, max) { return Math.random() * (max - min) + min; }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function resetInline() {
      el.style.cssText = '';
      el.classList.remove('mems-walking', 'mems-flip', 'mems-mascot-visible');
    }

    function walkAcross() {
      busy = true;
      resetInline();
      var vw = window.innerWidth;
      var fromLeft = Math.random() < 0.5;
      var bottomOffset = rand(14, Math.min(90, window.innerHeight * 0.12));
      el.style.bottom = bottomOffset + 'px';
      el.classList.toggle('mems-flip', !fromLeft);
      var startX = fromLeft ? -90 : vw + 90;
      var endX = fromLeft ? vw + 90 : -90;
      el.style.transform = 'translateX(' + startX + 'px)';
      el.classList.add('mems-walking');
      img.src = SPRITES.idle;

      requestAnimationFrame(function () {
        el.classList.add('mems-mascot-visible');
        requestAnimationFrame(function () {
          var duration = rand(7000, 11000);
          el.style.transition = 'transform ' + duration + 'ms linear, opacity .35s ease';
          el.style.transform = 'translateX(' + endX + 'px)';
          setTimeout(function () {
            img.src = SPRITES.blink;
            setTimeout(function () { img.src = SPRITES.idle; }, 220);
          }, duration * 0.5);
          setTimeout(function () {
            el.classList.remove('mems-mascot-visible');
            setTimeout(function () { resetInline(); busy = false; }, 400);
          }, duration);
        });
      });
    }

    function peekCorner() {
      busy = true;
      resetInline();
      var fromLeft = Math.random() < 0.5;
      el.classList.toggle('mems-flip', fromLeft);
      el.style.bottom = '-10px';
      el.style[fromLeft ? 'left' : 'right'] = rand(10, 40) + 'px';
      el.style.transform = 'translateY(90px)';
      img.src = SPRITES.wave;

      requestAnimationFrame(function () {
        el.classList.add('mems-mascot-visible');
        el.style.transition = 'transform .5s cubic-bezier(.34,1.56,.64,1)';
        requestAnimationFrame(function () { el.style.transform = 'translateY(0)'; });
      });
      setTimeout(function () {
        el.style.transform = 'translateY(90px)';
        setTimeout(function () {
          el.classList.remove('mems-mascot-visible');
          setTimeout(function () { resetInline(); busy = false; }, 400);
        }, 550);
      }, rand(2400, 3200));
    }

    function peekMenu() {
      if (!menuBtn || !menuBtn.getBoundingClientRect) return peekCorner();
      var rect = menuBtn.getBoundingClientRect();
      if (!rect.width) return peekCorner();
      busy = true;
      resetInline();
      el.style.width = '46px';
      el.style.top = (rect.bottom - 6) + 'px';
      el.style.left = (rect.left - 6) + 'px';
      el.style.transformOrigin = 'top left';
      el.style.transform = 'translateY(-40px) scale(.6)';
      img.src = SPRITES.welcome;

      requestAnimationFrame(function () {
        el.classList.add('mems-mascot-visible');
        el.style.transition = 'transform .45s cubic-bezier(.34,1.56,.64,1)';
        requestAnimationFrame(function () { el.style.transform = 'translateY(0) scale(1)'; });
      });
      setTimeout(function () { img.src = SPRITES.wave; }, 500);
      setTimeout(function () {
        el.style.transform = 'translateY(-40px) scale(.6)';
        setTimeout(function () {
          el.classList.remove('mems-mascot-visible');
          setTimeout(function () { resetInline(); busy = false; }, 400);
        }, 500);
      }, rand(1800, 2400));
    }

    function schedule() {
      setTimeout(triggerEvent, rand(35000, 75000));
    }

    function triggerEvent() {
      if (busy || document.hidden) { schedule(); return; }
      var events = [walkAcross, walkAcross, peekCorner];
      if (menuBtn) events.push(peekMenu);
      pick(events)();
      schedule();
    }

    setTimeout(triggerEvent, rand(6000, 14000));
  });
})();
