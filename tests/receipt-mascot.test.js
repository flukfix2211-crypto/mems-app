const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../receipt-mascot.js'), 'utf8');

function harness({ reduced = false, unsupported = false, denied = false, deferred = false } = {}) {
  let shown = false, observe, now = 0, requests = 0, releases = 0, resolve;
  const frames = new Map(), events = {}, screenEvents = {}, mediaEvents = {};
  let sequence = 0;
  const sentinel = { addEventListener() {}, async release() { releases++; } };
  const canvas = { width: 840, height: 144, clientWidth: 300, getContext: () => new Proxy({}, { get: () => () => {} }) };
  const screen = { classList: { contains: () => shown }, addEventListener: (n, f) => screenEvents[n] = f };
  const document = { hidden: false, baseURI: 'https://example.test/', getElementById: id => id === 'successScreen' ? screen : canvas,
    addEventListener: (n, f) => events[n] = f };
  const sandbox = { document, URL, navigator: unsupported ? {} : { wakeLock: { request: async () => {
    requests++;
    if (denied) throw Error('denied');
    return deferred ? new Promise(r => { resolve = r; }) : sentinel;
  } } }, matchMedia: () => ({ matches: reduced, addEventListener: (n, f) => mediaEvents[n] = f }),
    Image: class { constructor() { this.width = 1536; this.height = 1024; } set src(v) { this.onload(); } },
    performance: { now: () => now }, requestAnimationFrame: f => { frames.set(++sequence, f); return sequence; },
    cancelAnimationFrame: id => frames.delete(id), MutationObserver: class { constructor(f) { observe = f; } observe() {} },
    addEventListener: (n, f) => events[n] = f };
  vm.runInNewContext(code, sandbox);
  return { frames, document, events, screenEvents, show(value) { shown = value; observe(); },
    advance(ms) { for (let i = 0; i < ms; i += 40) { now += 40; for (const [id, f] of [...frames]) { frames.delete(id); f(now); } } },
    get requests() { return requests; }, get releases() { return releases; }, resolve: () => resolve(sentinel) };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('receipt keeps walking for multiple cycles and releases screen lock on close', async () => {
  const h = harness(); assert.equal(h.frames.size, 0); assert.equal(h.requests, 0);
  h.show(true); await flush(); h.advance(120000);
  assert.equal(h.frames.size, 1); assert.equal(h.requests, 1);
  h.show(false); await flush(); assert.equal(h.frames.size, 0); assert.equal(h.releases, 1);
});
test('background and page lifecycle stop work and reacquire on return', async () => {
  const h = harness(); h.show(true); await flush();
  h.document.hidden = true; h.events.visibilitychange(); await flush();
  assert.equal(h.frames.size, 0); assert.equal(h.releases, 1);
  h.document.hidden = false; h.events.visibilitychange(); await flush();
  assert.equal(h.requests, 2); assert.equal(h.frames.size, 1);
  h.events.pagehide(); await flush(); assert.equal(h.releases, 2);
  h.events.pageshow(); await flush(); assert.equal(h.requests, 3);
});
test('pending lock acquired after closing is immediately released', async () => {
  const h = harness({ deferred: true }); h.show(true); h.show(false);
  h.resolve(); await flush(); assert.equal(h.releases, 1); assert.equal(h.frames.size, 0);
});
test('reduced motion retains wake lock; unsupported and denied locks allow animation', async () => {
  const reduced = harness({ reduced: true }); reduced.show(true); await flush();
  assert.equal(reduced.requests, 1); assert.equal(reduced.frames.size, 0);
  for (const option of [{ unsupported: true }, { denied: true }]) {
    const h = harness(option); h.show(true); await flush(); h.advance(20000);
    assert.equal(h.frames.size, 1);
    h.show(false); await flush(); assert.equal(h.frames.size, 0);
  }
});
