const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../mascot.js'), 'utf8');
async function harness({ reduced = false, paused = false } = {}) {
  let now = 0, next = 1;
  const timers = new Map(), frames = new Map(), elements = new Map();
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.textContent = ''; this.hidden = false; this.disabled = false; }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    append(el) { if (el.id) elements.set(el.id, el); }
    contains(el) { return el === this || Object.values(this.children || {}).includes(el); }
    getClientRects() { return this.style.display === 'none' ? [] : [{}]; }
    querySelector(s) { return (this.children ||= {})[s] ||= new Element(); }
    getContext() { return new Proxy({}, { get: () => () => {} }); }
    remove() {}
  }
  const header = new Element(), modal = new Element(); modal.style.display = 'none';
  const doc = new Element(); doc.head = new Element(); doc.body = new Element(); doc.hidden = false;
  doc.currentScript = { src: 'https://example.test/mascot.js' }; doc.activeElement = { tagName: 'BODY' };
  doc.querySelector = s => s.startsWith('header') ? header : null;
  doc.getElementById = id => elements.get(id);
  doc.querySelectorAll = () => [modal]; doc.createElement = () => new Element();
  const makeStore = initial => ({ values: { ...initial }, getItem(k) { return this.values[k] || null; }, setItem(k,v) { this.values[k] = v; } });
  const sessionStorage = makeStore({}), localStorage = makeStore(paused ? { 'mems-guide-paused': '1' } : {});
  let mutation;
  const media = { matches: reduced, addEventListener() {} };
  const sandbox = { document: doc, location: { pathname: '/prepare.html' }, URL, localStorage, sessionStorage,
    matchMedia: () => media, getComputedStyle: el => ({ display: el.style.display || 'block', visibility: 'visible' }),
    performance: { now: () => now }, addEventListener() {},
    setTimeout(fn, delay) { const id = next++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), requestAnimationFrame(fn) { const id = next++; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    Image: class { constructor() { this.width=1536;this.height=1024; } set src(v) { this.onload(); } },
    IntersectionObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn([{isIntersecting:true}]); } },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} }
  };
  vm.runInNewContext(code, sandbox); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const dock = elements.get('mems-mascot');
  function advance(ms) { for (let elapsed = 0; elapsed < ms; elapsed += 40) { now += 40; for (const [id,t] of [...timers]) if(t.at<=now){timers.delete(id);t.fn();} for(const [id,fn] of [...frames]){frames.delete(id);fn(now);} } }
  const click = s => dock.querySelector(s).listeners.click();
  return { dock, doc, modal, mutation: () => mutation(), advance, click, frames, sessionStorage, localStorage };
}
test('welcome runs once per session, retreats, and has no idle animation loop', async () => {
  const h = await harness(); h.advance(8000);
  assert.match(h.dock.querySelector('p').textContent, /เลือกประเภทเครื่อง/);
  assert.equal(h.sessionStorage.getItem('mems-guide-welcomed'), '1');
  h.advance(10000); assert.equal(h.dock.dataset.state, 'rest'); assert.equal(h.frames.size, 0);
  h.advance(120000); assert.equal(h.dock.dataset.state, 'rest');
});
test('input focus and programmatic dialogs hide guidance immediately', async () => {
  const h = await harness(); h.advance(8000);
  h.modal.style.display = 'flex'; h.mutation();
  assert.equal(h.dock.querySelector('p').textContent, '');
  h.advance(500); assert.equal(h.dock.dataset.state, 'rest');
  h.modal.style.display = 'none'; h.click('.mems-guide-call'); h.advance(4000);
  h.doc.activeElement = { tagName: 'INPUT' }; h.doc.listeners.focusin({target:h.doc.activeElement});
  assert.equal(h.dock.querySelector('p').textContent, '');
});
test('pause persists and reduced motion keeps manual advice without animation', async () => {
  const h = await harness({reduced:true}); h.advance(8000);
  assert.equal(h.dock.querySelector('p').textContent, '');
  h.click('.mems-guide-call'); assert.match(h.dock.querySelector('p').textContent, /เลือกประเภทเครื่อง/);
  assert.equal(h.frames.size, 0);
  h.click('.mems-guide-pause'); assert.equal(h.localStorage.getItem('mems-guide-paused'), '1');
  assert.equal(h.dock.querySelector('p').textContent, ''); assert.equal(h.dock.querySelector('.mems-guide-call').disabled, true);
  const paused = await harness({paused:true}); paused.advance(9000); assert.equal(paused.frames.size, 0);
});
