/* Chromium → local adapter → isolated PostgreSQL WASM. Never calls production. */
const { chromium } = require('playwright');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const user = '10000000-0000-4000-8000-000000000001';
const fake = `window.supabase={createClient(){return {from(table){const q={table,filters:[]}; const b={select(){return this},eq(k,v){q.filters.push([k,v]);return this},is(k,v){q.filters.push([k,v]);return this},in(){return this},order(){return this},range(){return this},limit(){return this},then(a,b){return fetch('/api',{method:'POST',body:JSON.stringify(q)}).then(r=>r.json()).then(a,b)}};return b},rpc(name,args){return fetch('/api',{method:'POST',body:JSON.stringify({rpc:name,args})}).then(r=>r.json())}}}}`;
(async()=>{
  const db = new PGlite(); let browser, server;
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/lifecycle-baseline.sql'),'utf8'));
    const catalog = require('./fixtures/production-triggers.json');
    for (const sql of [...catalog.functions,...catalog.triggers]) await db.exec(sql);
    await db.exec(`insert into auth.users values('${user}');insert into user_profiles(id,active,role)values('${user}',true,'admin')`);
    for (const file of ['20261022031655_registry_equipment_lifecycle.sql','20261022042356_registry_lock_rls.sql','20261104000000_prepare_unreturned_equipment.sql','20261104033354_picu_lower_pediatrics_cross_ward_return.sql','20261117140000_return_receipt_confirmation.sql']) await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);insert into assets(type,no)values('C2',1),('C2',2)`);
    const items=[{equipment:'C2',number:'1'}];
    for (const mode of ['deliver','return']) await db.query('select mems_equipment_batch($1,$2::jsonb)',[crypto.randomUUID(),JSON.stringify({mode,items,ward:'ER',name:'Ward Staff'})]);
    server=http.createServer(async(req,res)=>{
      if (req.url==='/api') {
        let body='';for await(const chunk of req)body+=chunk;
        const q=JSON.parse(body);try{
          let data=[];
          if(q.rpc){assert.equal(q.rpc,'mems_confirm_equipment_return');await db.query('select mems_confirm_equipment_return($1,$2)',[q.args.p_return_id,q.args.p_name]);data=null;}
          else if(q.table==='equipment_return_checks')data=(await db.query(`select c.return_id,row_to_json(r) record from equipment_return_checks c join borrow_records r on r.id=c.return_id where c.confirmed_at is null`)).rows;
          else if(q.table!=='app_settings'){
            assert.ok(['assets','equipment_status','prepare_records'].includes(q.table));
            const params=[];const where=q.filters.map(([k,v])=>{assert.match(k,/^[a-z_]+$/);params.push(v);return '"'+k+'"=$'+params.length;});
            data=(await db.query('select * from '+q.table+(where.length?' where '+where.join(' and '):''),params)).rows;
          }
          res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}));
        }catch(e){res.end(JSON.stringify({data:null,error:{message:e.message}}));}return;
      }
      const pathname=new URL(req.url,'http://localhost').pathname;
      const file=path.join(root,pathname==='/'?'prepare.html':pathname);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith(base+'/vendor/supabase.js'))return route.fulfill({contentType:'application/javascript',body:fake});
      if(url.startsWith(base+'/auth.js'))return route.fulfill({contentType:'application/javascript',body:'async function memsGuard(){return {role:"admin"}}'});
      if(url.startsWith(base+'/site-footer.js')||url.startsWith(base+'/mascot.js'))return route.fulfill({contentType:'application/javascript',body:''});
      if(!url.startsWith(base))return route.abort();return route.continue();
    });
    await page.goto(base+'/prepare.html');
    await page.waitForFunction(()=>document.getElementById('returnChecksCount').textContent==='(1 เครื่อง)');
    await page.locator('#equipGrid button').filter({hasText:'C2'}).click();
    assert.equal(await page.locator('#readyEquipmentList .lifecycle-number').count(),1);
    await page.locator('#returnChecksList button').click();
    await page.locator('#returnCheckName').fill('   ');
    await page.locator('.return-check-attestation input').check();
    await page.locator('dialog button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('.return-check-error').textContent.includes('ลงชื่อ'));
    assert.equal((await db.query('select confirmed_at from equipment_return_checks')).rows[0].confirmed_at,null);
    await page.locator('#returnCheckName').fill('เจ้าหน้าที่ ทดสอบ');
    // Cancel does not confirm receipt.
    await page.locator('dialog button[type=button]').click();
    assert.equal((await db.query('select confirmed_at from equipment_return_checks')).rows[0].confirmed_at,null);
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'page overflow at '+width);
    }
    await page.locator('#returnChecksList button').click();
    await page.locator('#returnCheckName').fill('เจ้าหน้าที่ ทดสอบ');
    await page.locator('.return-check-attestation input').check();
    await page.locator('dialog button[type=submit]').dblclick();
    await page.waitForFunction(()=>document.getElementById('returnChecksCount').textContent==='(0 เครื่อง)');
    await page.waitForFunction(()=>document.querySelectorAll('#readyEquipmentList .lifecycle-number').length===2);
    const receipt=(await db.query('select * from equipment_return_checks')).rows[0];
    assert.equal(receipt.confirmed_by,'เจ้าหน้าที่ ทดสอบ');assert.equal(receipt.confirmed_user_id,user);assert.ok(receipt.confirmed_at);
    assert.deepEqual(errors,[]);
    // Ordinary borrow/return notifications continue through the existing shared save API.
    await page.evaluate(async()=>{
      window.testNotifications=[];notifyTelegram=record=>window.testNotifications.push(record);
      supabase.rpc=async()=>({data:[{id:99}],error:null});
      await saveEquipmentBatch('borrow',[{equipment:'C2',number:'2'}],'ER','Staff');
      await saveEquipmentBatch('return',[{equipment:'C2',number:'2'}],'ER','Staff');
    });
    assert.deepEqual(await page.evaluate(()=>window.testNotifications.map(n=>n.record.action)),['🟩 ยืม','🟥 คืน']);
    console.log('PASS: pending queue, required signature, cancellation, signed receipt, double click, ready list, 3 viewport widths, borrow/return notification calls');
  } finally {if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
