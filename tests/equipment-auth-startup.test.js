const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

function bootEquipmentPage(page, search, profile, scannerEnabled = true) {
  const events = [];
  const calls = [];
  let finishGuard;
  const guardResult = new Promise(resolve => { finishGuard = () => resolve(profile); });
  const element = {
    appendChild() {},
    closest() { return this; },
    replaceChildren() {},
    options: [],
    style: {},
    dataset: {},
  };
  const register = (event, listener) => {
    if (event === 'DOMContentLoaded') events.push(listener);
    if (event === 'keydown') calls.push(['scanner']);
  };
  const context = vm.createContext({
    document: {
      body: element,
      getElementById: id => (id === 'equipGrid' && page === 'borrow' ? null : element),
      querySelector: () => element,
      querySelectorAll: () => [],
      addEventListener: register,
    },
    addEventListener: register,
    alert: message => calls.push(['alert', message]),
    async memsGuard(pageKey) { calls.push(['guard', pageKey]); return guardResult; },
    async fetchEquipmentStatus() { calls.push(['status']); return []; },
    async fetchRegistryEquipment() { return []; },
    async fetchPreparedList() { return []; },
    async fetchPreparationWards() { return []; },
    renderSetChangeDate() {},
    memsSelectStaffName() {},
    onByChange() {},
    doCancel() {},
    memsLoadReturnChecks() { calls.push(['return checks']); },
    loadList() {},
    loadPreparedList() {},
    setAction(action) { context.S.action = action; },
    onWardChange() {},
    pickEquip() {},
    submitTransfer() {},
    renderPreparedBanner() {},
    filterEquipButtons() {},
    memsIsAdmin: () => false,
    detectShift() {},
    setShift() {},
    URLSearchParams,
    location: { search },
    S: { action: 'borrow' },
    selectedPrepared: new Map(),
  });
  context.window = context;
  const startup = read(page + '.html').match(/window\.addEventListener\('DOMContentLoaded', async \(\) => \{[\s\S]*?^\s*\}\);/m);
  assert.ok(startup, 'page has a startup handler');
  vm.runInContext(startup[0], context);
  if (page === 'borrow') {
    const client = read('supabase-client.js');
    vm.runInContext(client.slice(client.indexOf('function memsAssetQrReference'), client.indexOf('async function fetchRegistryEquipment')), context);
    vm.runInContext(read('borrow-qr.js'), context);
    context.memsLoadQrScannerSetting = async () => {};
    if (!scannerEnabled) vm.runInContext('memsQrScannerEnabled = false', context);
    context.memsUseQrAssetId = async (assetId, { action }) => calls.push(['qr', structuredClone(assetId), action]);
  }
  vm.runInContext(read('equipment-lifecycle.js'), context);
  return { calls, finishGuard, run: () => Promise.all(events.map(listener => listener())) };
}

for (const page of ['borrow', 'prepare']) {
  test(page + ' waits for page authorization before requesting equipment status', async () => {
    const boot = bootEquipmentPage(page, '?mode=return&asset=337', null);
    const started = boot.run();
    assert.deepEqual(boot.calls, [['guard', page]]);
    boot.finishGuard();
    await started;
    assert.deepEqual(boot.calls, [['guard', page]]);
  });
}

for (const search of ['?mode=return&asset=337', '?m=r&a=337', '?mode=return&type=infusion+pump&no=346']) {
  for (const scannerEnabled of [true, false]) {
    test('existing return QR resumes with scanner ' + (scannerEnabled ? 'on ' : 'off ') + search, async () => {
      const boot = bootEquipmentPage('borrow', search, { active: true }, scannerEnabled);
      const started = boot.run();
      assert.deepEqual(boot.calls, [['guard', 'borrow']]);
      boot.finishGuard();
      await started;
      const expected = [['guard', 'borrow'], ['status']];
      if (scannerEnabled) expected.push(['scanner']);
      const reference = search.includes('no=') ? { type: 'infusion pump', no: 346 } : '337';
      expected.push(['qr', reference, 'return']);
      assert.deepEqual(boot.calls, expected);
    });
  }
}
