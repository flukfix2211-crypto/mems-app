const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../reports.js'),'utf8');
test('PDF preview routes to page preview or shared printable preview without downloading',()=>{
 const calls=[];const context=vm.createContext({window:{},rptOpenPrintablePdf:(...args)=>calls.push(args)});
 vm.runInContext(source.slice(source.indexOf('function rptDeliverPdf('),source.indexOf('/* ============================================================ THAI HOLIDAYS')),context);
 const blob={}; const doc={output:type=>{assert.equal(type,'blob');return blob},save:()=>assert.fail('Preview must not auto-download')};
 context.rptDeliverPdf(doc,'report.pdf',{preview:true});assert.deepEqual(calls,[[blob,'report.pdf']]);
 context.window.memsOpenPdfPreview=(...args)=>calls.push(args);
 context.rptDeliverPdf(doc,'monthly.pdf',{preview:true});assert.deepEqual(calls[1],[blob,'monthly.pdf']);
});
