/* End-to-end local tests: real UI -> Supabase API adapter -> isolated Postgres -> PDF. */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const {setup}=require('./fixtures/pm-native-db.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const db=await setup();const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let calls=0,loseReply=false,errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  try{
   if(url.pathname.includes('/rest/v1/rpc/save_mems_report_batch')){
    calls++;const body=req.postDataJSON();const data=(await db.query('select save_mems_report_batch($1,$2::jsonb) r',[body.request_id,JSON.stringify(body.batch_payload)])).rows[0].r;
    if(loseReply){loseReply=false;return route.abort('failed');}
    return route.fulfill({json:data});
   }
   if(url.pathname.includes('/rest/v1/rpc/save_mems_report_operator')){
    const body=req.postDataJSON();const data=(await db.query('select save_mems_report_operator($1,$2) r',[body.operator_name,body.operator_position])).rows[0].r;
    return route.fulfill({json:data});
   }
   if(url.pathname.includes('/rest/v1/rpc/save_mems_report_tool_type')){
    const body=req.postDataJSON();const data=(await db.query('select save_mems_report_tool_type($1) r',[body.type_name])).rows[0].r;return route.fulfill({json:data});
   }
   if(url.pathname.includes('/rest/v1/')){
    const table=url.pathname.split('/').at(-1);assert.ok(['assets','mems_reports','mems_report_settings','mems_report_operators','mems_report_tool_types'].includes(table));
    const params=[],filters=[];
    for(const [key,val] of url.searchParams){
      if(['select','order','offset','limit'].includes(key))continue;
      const match=val.match(/^(eq|gte|lte)\.(.*)$/);if(!match)continue;
      const allowed=['batch_id','kind','report_date','id','snapshot->>no','snapshot->>serial_number','snapshot->>equipment_type'];assert.ok(allowed.includes(key));
      params.push(match[2]);const column=key.startsWith('snapshot->>')?"snapshot->>'"+key.split('->>')[1]+"'":key;
      filters.push(column+({eq:'=',gte:'>=',lte:'<='}[match[1]])+'$'+params.length);
    }
    const where=filters.length?' where '+filters.join(' and '):'';
    let order=table==='mems_reports'?' order by created_at desc,id':table==='assets'?' order by id':'';
    if(url.searchParams.get('order')?.includes('batch_index'))order=' order by batch_index';
    const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);
    assert.ok(Number.isInteger(limit)&&Number.isInteger(offset));
    const result=await db.query('select * from '+table+where+order+' limit '+limit+' offset '+offset,params);
    return route.fulfill({json:req.headers().accept?.includes('object+json')?result.rows[0]:result.rows});
   }
   if(url.hostname==='mems.test'){
    if(url.pathname==='/auth.js')return route.fulfill({contentType:'application/javascript',body:"window.memsGuard=async()=>({id:'10000000-0000-4000-8000-000000000001',display_name:'เจ้าหน้าที่ทดสอบ',role:'admin'});"});
    const file=path.join(root,decodeURIComponent(url.pathname));if(!file.startsWith(root+'/')||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const ext=path.extname(file),type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[ext]||'application/octet-stream';
    return route.fulfill({body:fs.readFileSync(file),contentType:type});
   }
   return route.abort();
  }catch(error){return route.fulfill({status:400,json:{message:error.message,code:error.code||'P0001'}});}
 });
 try{
  await page.goto('http://mems.test/pm-reports.html');await page.waitForFunction(()=>document.querySelectorAll('.pm-machine').length===1);
  await page.locator('#operator').fill('ผู้ตรวจทดสอบ');await page.locator('#operatorPosition').fill('นายช่างเทคนิค');await page.locator('#saveOperator').click();
  await page.waitForFunction(()=>document.getElementById('operatorStatus').textContent.includes('บันทึก ผู้ตรวจทดสอบ'));
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.pm-machine').length===1);
  const operatorId=(await db.query('select id from mems_report_operators')).rows[0].id;
  await page.locator('#savedOperator').selectOption(operatorId);assert.equal(await page.locator('#operator').inputValue(),'ผู้ตรวจทดสอบ');assert.equal(await page.locator('#operatorPosition').inputValue(),'นายช่างเทคนิค');
  await page.screenshot({path:'/tmp/mems-pm-themed-desktop.png',fullPage:true});
  const row=n=>page.locator('.pm-machine').nth(n);
  async function fill(n,type,mode,identifier){
   const typeSelect=row(n).locator('[data-registry]');
   if(await typeSelect.locator('option').evaluateAll((els,type)=>els.some(e=>e.value===type),type))await typeSelect.selectOption(type);
   else {await typeSelect.selectOption('__manual__');await row(n).locator('input[data-key="equipment_type"]').fill(type);}
   await row(n).locator('[data-key="identity_mode"]').selectOption(mode);
   const identity=row(n).locator('[data-key="identifier"]');
   if(await identity.evaluate(el=>el.tagName)==='SELECT')await identity.selectOption(identifier);else await identity.fill(identifier);
   for(const [key,value] of [['brand','Hamilton'],['model','C2']])await row(n).locator('[data-key="'+key+'"]').fill(value);
   await row(n).locator('[data-key="tool_type"]').selectOption('Ventilator');
   const choices=row(n).locator('[data-check]');for(let i=0;i<await choices.count();i++)await choices.nth(i).selectOption('ผ่าน');
  }
  assert.deepEqual(await row(0).locator('[data-registry] option').evaluateAll(els=>els.map(e=>e.value)),['','C2','Pump','__manual__']);
  await row(0).locator('[data-registry]').selectOption('C2');assert.deepEqual(await row(0).locator('select[data-key="identifier"] option').evaluateAll(els=>els.map(e=>e.value)),['','41','__manual__']);
  await row(0).locator('[data-add-tool-type]').click();const popup=await page.locator('#toolTypeModal').boundingBox();assert.ok(Math.abs(popup.x+popup.width/2-720)<3&&Math.abs(popup.y+popup.height/2-500)<3);await page.locator('#toolTypeName').fill('เครื่องทดสอบใหม่');await page.locator('#saveToolType').click();await page.locator('#toolTypeModal').waitFor({state:'hidden'});
  assert.equal(await row(0).locator('[data-key="tool_type"]').inputValue(),'เครื่องทดสอบใหม่');
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.pm-machine').length===1);assert.equal(await row(0).locator('[data-key="tool_type"] option').filter({hasText:'เครื่องทดสอบใหม่'}).count(),1);
  await page.locator('#savedOperator').selectOption(operatorId);
  await fill(0,'C2','no','41');await row(0).locator('[data-key="note"]').fill('หมายเหตุเครื่องแรก');
  await page.locator('#addMachine').click();await fill(1,'C2','serial','SN41');await row(1).locator('[data-key="note"]').fill('หมายเหตุเครื่องสอง');
  await page.locator('#reviewBtn').click();await page.waitForFunction(()=>document.getElementById('pmNotice').textContent.includes('ซ้ำ'));assert.equal(calls,0);
  await row(0).locator('summary').click();await row(0).locator('[data-key="brand"]').fill('Copied Brand');await row(0).locator('[data-copy-details]').click();
  await row(1).locator('summary').click();assert.equal(await row(1).locator('[data-key="brand"]').inputValue(),'Copied Brand');assert.equal(await row(1).locator('[data-key="identifier"]').inputValue(),'SN41');assert.equal(await row(1).locator('[data-key="note"]').inputValue(),'หมายเหตุเครื่องสอง');
  await fill(1,'Pump','serial','P41');
  await page.locator('#reviewBtn').click();await page.locator('#confirmed').check();loseReply=true;await page.locator('#saveReports').click();
  await page.waitForFunction(()=>document.getElementById('pmNotice').textContent.includes('ข้อมูลถูกล็อก'));
  assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,2);
  await db.exec('reset role;update mems_report_settings set enabled=false;set role authenticated');
  await page.locator('#saveReports').click();await page.waitForFunction(()=>document.getElementById('pmNotice').textContent.includes('ข้อมูลถูกล็อก'));
  assert.equal(await page.locator('#pmForm').evaluate(el=>el.inert),true);
  await db.exec('reset role;update mems_report_settings set enabled=true;set role authenticated');
  await page.locator('#saveReports').click();await page.locator('#savedPanel').waitFor({state:'visible'});
  assert.equal(calls,3);assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,2);
  const saved=(await db.query('select * from mems_reports order by batch_index')).rows;assert.equal(saved[1].snapshot.serial_number,'P41');assert.equal(saved[1].payload.note,'หมายเหตุเครื่องสอง');assert.equal(saved[0].snapshot.operator_position,'นายช่างเทคนิค');
  await page.locator('#savedPdf').click();await page.locator('#memsPrintablePdf').waitFor({state:'visible'});
  const url=await page.locator('#memsPrintablePdf a[download]').getAttribute('href');
  const bytes=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),url);
  fs.writeFileSync('/tmp/mems-native-pm.pdf',Buffer.from(bytes));assert.ok(bytes.length>100000);
  await page.getByRole('button',{name:'ปิด',exact:true}).click();await page.locator('#historyTab').click();await page.locator('[data-select]').first().waitFor();
  assert.equal(await page.locator('.history-item').count(),2);await page.locator('[data-select]').first().check();assert.equal(await page.locator('#selectedPdf').isEnabled(),true);
  await page.locator('#filterSerial').fill('P41');await page.locator('#historyFilters button').click();await page.waitForFunction(()=>document.querySelectorAll('.history-item').length===1);
  await page.locator('#newTab').click();await page.locator('#startNew').click();await page.locator('#reportKind').selectOption('acceptance');await fill(0,'New Device','serial','NEW-SN-01');
  await row(0).locator('[data-check]').first().selectOption('N/A');await page.locator('#reviewBtn').click();await page.waitForFunction(()=>document.getElementById('pmNotice').textContent.includes('หมายเหตุ'));
  await row(0).locator('[data-key="note"]').fill('ไม่มีส่วนนี้ในเครื่องรับใหม่');await page.locator('#reviewBtn').click();await page.locator('#confirmed').check();await page.locator('#saveReports').click();await page.locator('#savedPanel').waitFor({state:'visible'});
  assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,3);
  await page.locator('#savedPdf').click();await page.locator('#memsPrintablePdf').waitFor({state:'visible'});
  const accUrl=await page.locator('#memsPrintablePdf a[download]').getAttribute('href');const acc=await page.evaluate(async u=>Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())),accUrl);fs.writeFileSync('/tmp/mems-native-acceptance.pdf',Buffer.from(acc));
  await page.getByRole('button',{name:'ปิด',exact:true}).click();await page.locator('#startNew').click();
  await page.locator('#bulkAdd').click();await page.locator('#bulkType').selectOption('C2');await page.locator('#bulkValues').fill('41');await page.locator('#bulkForm button[type=submit]').click();assert.equal(await page.locator('.pm-machine').count(),1);assert.equal(await row(0).locator('[data-key="identifier"]').inputValue(),'41');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'/tmp/mems-native-mobile.png',fullPage:true});
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow at '+width);}
  await page.setViewportSize({width:390,height:844});
  // Long notes must flow across pages rather than truncate; use stored snapshot shapes.
  await page.evaluate(async saved=>{saved[0].payload.note=('หมายเหตุทดสอบข้อความยาว '.repeat(80))+' จบหมายเหตุ ENDNOTE';await memsExportInspectionPdf([saved[0]]);},saved);
  const longUrl=await page.locator('#memsPrintablePdf a[download]').getAttribute('href');const long=await page.evaluate(async u=>Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())),longUrl);fs.writeFileSync('/tmp/mems-native-long.pdf',Buffer.from(long));
  assert.deepEqual(errors,[]);console.log('PM native browser passed: UI → SQL batch, lost-response retry, No/SN, notes, history filter, both real PDFs, long notes, mobile');
 }finally{await browser.close();await db.close();}
})().catch(error=>{console.error(error);process.exit(1)});
