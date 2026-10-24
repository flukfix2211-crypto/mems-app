const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const borrowPage = fs.readFileSync(new URL('../borrow.html', `file://${__filename}`), 'utf8');
const helperStart = borrowPage.indexOf('function showC2Cards()');
const helperEnd = borrowPage.indexOf('function onC2BorrowInput()', helperStart);

test('return number grid labels the currently selected equipment type', () => {
  assert.match(borrowPage, /id="returnGridLabel"/);
  assert.doesNotMatch(borrowPage, />เลือกหมายเลข C2 ที่ต้องการคืน</);

  const elements = {
    returnGridLabel: { textContent: '' },
    c2BorrowCard: { style: {} },
    c2GridCard: { style: {} },
    c2BorrowInput: { value: '12' },
  };
  const context = {
    S: { action: 'return', equip: 'High Flow' },
    c2SelectedNums: new Set(),
    document: { getElementById: id => elements[id] },
  };

  vm.createContext(context);
  vm.runInContext(borrowPage.slice(helperStart, helperEnd), context);
  context.showC2Cards();

  assert.equal(elements.returnGridLabel.textContent, 'เลือกหมายเลข High Flow ที่ต้องการคืน');
  assert.equal(elements.c2GridCard.style.display, '');
});


const client = fs.readFileSync(new URL('../supabase-client.js', `file://${__filename}`), 'utf8');
const policy = client.slice(client.indexOf('function memsTypeKey'), client.indexOf('function memsMachineKey'));
test('only borrowed ER High Flow can be returned across wards', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(policy, context);
  const canReturn = context.memsCanReturnEquipment;
  for (const equipment of ['High Flow', 'HighFlow', ' high flow ']) {
    assert.equal(canReturn({ equipment, ward: 'ER', isBorrowed: true }, 'ศัลยกรรมชาย'), true);
  }
  for (const ward of ['ICU 100 ปี', 'Semi ICU', 'ศัลยกรรมชาย']) {
    assert.equal(canReturn({ equipment: 'High Flow', ward, isBorrowed: true }, 'ER'), false);
    assert.equal(canReturn({ equipment: 'High Flow', ward, isBorrowed: true }, ward), true);
  }
  for (const equipment of ['C2', 'High Flow Plus', 'Infusion Pump']) {
    assert.equal(canReturn({ equipment, ward: 'ER', isBorrowed: true }, 'ICU'), false);
  }
  assert.equal(canReturn({ equipment: 'High Flow', ward: 'ER', isBorrowed: false }, 'ICU'), false);
  assert.equal(canReturn({ equipment: 'High Flow', ward: 'ER', isBorrowed: true }, ''), false);
});

test('QR return keeps selected destination for ER High Flow and selects holder for other loans', async () => {
  const qr = fs.readFileSync(new URL('../borrow-qr.js', `file://${__filename}`), 'utf8');
  const start = qr.indexOf('async function memsApplyQrBatchItems(');
  const end = qr.indexOf('async function memsApplyQrBorrowBatchItems(', start);
  const ward = { value: 'ศัลยกรรมชาย' };
  const noop = () => {};
  const ctx = {
    S: { action: 'return' },
    document: {
      querySelectorAll: () => [{ dataset: { e: 'High Flow' } }, { dataset: { e: 'C2' } }],
      getElementById: id => id === 'wardSel' ? ward : { focus: noop },
    },
    memsSelectBorrowedWard: value => { ward.value = value; },
    memsSyncQrScanCard: noop, memsSetQrDevice: noop, pickEquip: noop,
    memsSetQrBatchDevice: noop, memsRenderConfirmedQrItems: noop,
    memsSetQrBanner: noop, memsQrScannedItemLabel: item => item.equipment,
  };
  vm.createContext(ctx);
  vm.runInContext(policy + qr.slice(start, end), ctx);
  for (const [equipment, holder, expected] of [
    ['High Flow', 'ER', 'ศัลยกรรมชาย'],
    ['High Flow', 'ICU 100 ปี', 'ICU 100 ปี'],
    ['C2', 'ER', 'ER'],
  ]) {
    ward.value = 'ศัลยกรรมชาย';
    await ctx.memsApplyQrBatchItems([{ equipment, number: '1', asset: {},
      borrowedStatus: { ward: holder, isBorrowed: true } }], 'return');
    assert.equal(ward.value, expected);
  }
});
