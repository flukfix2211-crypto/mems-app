const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../unkeyed-statistics.js'),'utf8'), context);
const summarize = (a,b) => JSON.parse(JSON.stringify(context.memsSummarizeUnkeyed(a,b)));
test('counts legacy and current missing-borrow reasons, excludes other cancellations and normal returns', () => {
  const stats = summarize([
    {ward:'ICU',status:'ยกเลิก: หน่วยงานไม่คีย์ยืมเครื่องมือ'},
    {ward:'ICU',status:'ยกเลิก: หน่วยงานนำเครื่องไปไม่คีย์ยืมเครื่อง'},
    {ward:'ER',status:'ยกเลิก: หน่วยงานไม่มารับเครื่อง'},
    {ward:'ER',status:'เตรียม'},
  ],[
    {ward:'ER',action:'🟥 คืน',note:'หน่วยงาน ER ไม่คีย์คืนเครื่อง'},
    {ward:'ICU',action:'🟥 คืน',note:null},
    {ward:'ER',action:'🟩 ยืม',note:'หน่วยงาน ER ไม่คีย์คืนเครื่อง'},
    {ward:'ICU',action:'🟥 คืน',note:'หน่วยงาน ER ไม่คีย์คืนเครื่อง'},
  ]);
  assert.equal(stats.borrow,2);
  assert.equal(stats.return,1);
  assert.deepEqual(stats.wards,[{ward:'ICU',borrow:2,return:0,total:2},{ward:'ER',borrow:0,return:1,total:1}]);
});
test('ward names cannot collide with object properties and empty results are valid', () => {
  const stats = summarize([{ward:'__proto__',status:'ยกเลิก: หน่วยงานไม่คีย์ยืมเครื่องมือ'}],[]);
  assert.equal(stats.wards[0].borrow,1);
  assert.deepEqual(summarize([],[]),{borrow:0,return:0,wards:[],incidents:[]});
});
test('month boundaries use Bangkok and include December rollover', () => {
  assert.deepEqual(Array.from(context.memsUnkeyedMonthRange('2026-12')),['2026-12-01T00:00:00+07:00','2027-01-01T00:00:00+07:00']);
  assert.equal(context.memsUnkeyedMonthRange(''),null);
  assert.throws(()=>context.memsUnkeyedMonthRange('2026-13'));
});
