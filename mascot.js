/* MEMs articulated bitmap mascot. Decorative only: no app data or input interception. */
(function () {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || document.getElementById('mems-mascot')) return;
  const source = new URL('img/mascot/mascot-idle.png', document.currentScript.src).href;
  const image = new Image();
  image.src = source;
  image.onload = function () {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
    else init();
  };
  function init() {
    if (motion.matches) return;
    const stage = document.createElement('div');
    stage.id = 'mems-mascot';
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:340;overflow:hidden;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;width:150px;height:160px;pointer-events:none;';
    stage.appendChild(canvas);
    document.body.appendChild(stage);
    const ctx = canvas.getContext('2d');
    if (!ctx) {stage.remove();return;}
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 300 * ratio; canvas.height = 320 * ratio;
    let frame = 0, state = 'hidden', since = 0, lastInput = performance.now();
    let x = 0, y = 0, from = 0, to = 0, direction = 1, greeting = true;
    let logoRect = null, greetingAnchor = null, cooldown = 0;
    const width = () => window.innerWidth < 500 ? 106 : 130;
    const height = () => width() * 320 / 300;
    const ease = t => t*t*(3-2*t);
    const lerp = (a,b,t) => a+(b-a)*t;
    const duration = {enter:2200,wave:2300,retreat:2200,coffeeEnter:3500,sip:6500,coffeeExit:3500};
    function anchor() {
      return document.querySelector('.mems-logo') || document.querySelector('.header h1') || document.querySelector('img[alt*="โลโก้"]');
    }
    function blocked() {
      return document.hidden || motion.matches || !!document.querySelector('dialog[open]') ||
        ['loginOverlay','helpModal','editModal'].some(id => {const el=document.getElementById(id);return el && getComputedStyle(el).display!=='none';}) ||
        /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    }
    function change(next, now) { state=next;since=now; }
    function hide() { state='hidden';canvas.style.visibility='hidden';stage.style.clipPath='none';logoRect=null; }
    function greet(now) {
      greetingAnchor=anchor();if(!greetingAnchor)return false;
      logoRect=greetingAnchor.getBoundingClientRect();
      if(!logoRect.width || logoRect.bottom<0 || logoRect.top>innerHeight)return false;
      // The logo's right edge is an occlusion plane: the robot walks out from behind it.
      const edge=Math.min(logoRect.right-12,innerWidth-width()-18);
      if(edge<10)return false;
      from=edge-width();to=Math.min(innerWidth-width()-12,edge+12);
      x=from;y=Math.max(6,Math.min(innerHeight-height()-12,logoRect.bottom-height()+20));
      stage.style.clipPath='inset(0 0 0 '+edge+'px)';
      direction=1;change('enter',now);return true;
    }
    function coffee(now) {
      stage.style.clipPath='none';logoRect=null;direction=1;
      from=-width()-15;to=Math.min(innerWidth*.22,innerWidth-width()-20);
      x=from;
      const submit=document.querySelector('.submit-bar');
      const safe=submit?submit.getBoundingClientRect().height:20;
      y=Math.max(8,innerHeight-height()-safe-16);
      change('coffeeEnter',now);
    }
    // Each body part retains the original MEMs bitmap; joints move independently.
    function part(sx,sy,sw,sh,px,py,angle) {
      ctx.save();ctx.translate(px,py);ctx.rotate(angle);
      ctx.drawImage(image,sx,sy,sw,sh,sx-px,sy-py,sw,sh);ctx.restore();
    }
    function arm(left, angle, elbow) {
      ctx.save();const px=left?92:185,py=120;
      ctx.translate(px,py);ctx.rotate(angle);ctx.translate(-px,-py);
      if(left) {
        part(62,112,39,51,92,120,0);
        part(51,160,43,66,77,160,elbow);
      } else {
        part(179,112,36,52,185,120,0);
        part(185,162,40,67,199,162,elbow);
      }
      ctx.restore();
    }
    function mug(t) {
      const lift=(1-Math.cos(t*Math.PI*2))/2;
      ctx.save();ctx.translate(185-27*lift,171-61*lift);ctx.rotate(-.18-.32*lift);
      ctx.fillStyle='#fff';ctx.strokeStyle='#075763';ctx.lineWidth=3;
      ctx.beginPath();ctx.roundRect(0,0,29,29,5);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.arc(32,13,8,-Math.PI/2,Math.PI/2);ctx.stroke();
      ctx.fillStyle='#764b31';ctx.fillRect(4,3,21,4);
      ctx.strokeStyle='#9ebdc4';ctx.lineWidth=2;
      for(let i=0;i<2;i++){ctx.beginPath();ctx.moveTo(8+i*12,-6);ctx.quadraticCurveTo(1+i*12,-14,10+i*12,-22);ctx.stroke();}
      ctx.restore();return lift;
    }
    function draw(now, phase) {
      const walking=['enter','retreat','coffeeEnter','coffeeExit'].includes(state);
      const cycle=(now-since)/150;
      const stride=walking?Math.sin(cycle):0;
      const sipping=state==='sip';
      const lift=sipping?(1-Math.cos(phase*Math.PI*4))/2:0;
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,300,320);
      ctx.save();ctx.translate(150,0);ctx.scale(direction,1);ctx.translate(-140,5);
      ctx.fillStyle='rgba(7,50,60,.12)';ctx.beginPath();ctx.ellipse(139,295,55,6,0,0,Math.PI*2);ctx.fill();
      ctx.translate(0,walking?-Math.abs(stride)*3:Math.sin(now/700)*1.1);
      part(88,187,52,108,120,191,stride*.24);
      part(140,187,53,108,158,191,-stride*.24);
      arm(false,sipping?.4+lift*.7:stride*.28,sipping?-1.5-lift*.6:0);
      part(99,109,82,84,140,151,walking?stride*.025:0);
      let wave=state==='wave'?2.25+Math.sin(phase*Math.PI*10)*.2:-stride*.28;
      arm(true,wave,state==='wave'?.2+Math.sin(phase*Math.PI*10)*.12:0);
      part(68,0,141,111,140,107,state==='wave'?-.06:stride*.035);
      if(sipping)mug(phase*2);
      ctx.restore();
      canvas.style.width=width()+'px';canvas.style.height=height()+'px';
      canvas.style.transform='translate3d('+x+'px,'+y+'px,0)';canvas.style.visibility='visible';
    }
    function tick(now) {
      if(blocked()) {hide();lastInput=now;}
      else if(state==='hidden') {
        if(greeting && now-lastInput>1800){greeting=false;greet(now);}
        else if(now-lastInput>45000 && now>cooldown)coffee(now);
      }
      if(state!=='hidden') {
        const phase=Math.min(1,(now-since)/duration[state]);
        if(state==='enter'||state==='coffeeEnter')x=lerp(from,to,phase);
        if(state==='retreat')x=lerp(to,from,phase);
        if(state==='coffeeExit')x=lerp(from,-width()-20,phase);
        draw(now,phase);
        if(phase>=1){
          if(state==='enter')change('wave',now);
          else if(state==='wave'){direction=-1;change('retreat',now);}
          else if(state==='coffeeEnter')change('sip',now);
          else if(state==='sip'){from=x;direction=-1;change('coffeeExit',now);}
          else {hide();cooldown=now+90000;}
        }
      }
      frame=requestAnimationFrame(tick);
    }
    function activity(){
      const now=performance.now();lastInput=now;
      if(state==='sip'||state==='coffeeEnter'){from=x;direction=-1;change('coffeeExit',now);}
      else if(state==='wave'||state==='enter')hide();
    }
    ['pointerdown','keydown','wheel','touchstart'].forEach(name=>document.addEventListener(name,activity,{passive:true}));
    document.addEventListener('pointermove',activity,{passive:true});
    window.addEventListener('resize',()=>{hide();lastInput=performance.now();});
    window.addEventListener('scroll',()=>{if(logoRect)hide();lastInput=performance.now();},{passive:true});
    document.addEventListener('visibilitychange',()=>{hide();lastInput=performance.now();});
    motion.addEventListener('change',()=>{hide();lastInput=performance.now();});
    window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);hide();});
    window.addEventListener('pageshow',event=>{if(event.persisted){lastInput=performance.now();frame=requestAnimationFrame(tick);}});
    hide();frame=requestAnimationFrame(tick);
  }
})();

