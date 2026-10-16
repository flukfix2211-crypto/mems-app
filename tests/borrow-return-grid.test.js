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

