const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const pm=require('../pm-common');
const root=path.join(__dirname,'..');
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const request='20000000-0000-4000-8000-000000000001';
const payload=(kind='pm')=>({kind,date:'2026-10-28',asset_pk:1,tool_type:'Ventilator',brand:'Hamilton',model:'C2',operator:'ผู้ทดสอบ',section:'ศม.',confirmed:true,results:Object.fromEntries(pm.fields(kind).map(f=>[f,f==='สายสัญญาณต่างๆ'?'N/A':'ผ่าน']))});
test('parses pasted No. values, deduplicates and refuses malformed / missing / duplicate registry entries',()=>{
 assert.deepEqual(pm.parseNumbers('No.41\nNo.62 034,15;39,9,28,041'),[41,62,34,15,39,9,28]);
 for(const input of ['','0','-1','1.5','1-7','abc'])assert.throws(()=>pm.parseNumbers(input));
 assert.throws(()=>pm.parseNumbers(Array.from({length:51},(_,i)=>i+1).join(',')));
 const rows=[{id:1,type:'C2',no:1,asset_id:'A'},{id:2,type:'T1',no:1,asset_id:'B'}];
 assert.equal(pm.matchAssets(rows,'T1',[1])[0].id,2);
 assert.throws(()=>pm.matchAssets(rows,'C2',[9]),/ไม่พบ/);
 assert.throws(()=>pm.matchAssets([...rows,rows[0]],'C2',[1]),/ซ้ำ/);
 assert.equal(pm.today(new Date('2026-10-27T18:00:00Z')),'2026-10-28');
});
test('database enforces feature / role / permission, immutable canonical registry snapshots, full checks, retries and history',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create schema auth;create schema private;create role authenticated;create role service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);create table user_profiles(id uuid primary key,active boolean,role text,permissions text[]);
 create table assets(id bigint primary key,no int,type text,asset_code text,asset_id text);
 insert into auth.users values('${actor}'),('${other}');
 insert into user_profiles values('${actor}',true,'user',array['borrow']),('${other}',true,'admin',array[]::text[]);
 insert into assets values(1,41,'C2','6515-real','138312');
 alter table user_profiles enable row level security;create policy own on user_profiles for select to authenticated using(id=auth.uid());
 grant usage on schema public,auth,private to authenticated;grant select on user_profiles,assets to authenticated;
 set request.jwt.claim.sub='${actor}';`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261028081412_pm_acceptance_reports.sql'),'utf8'));
 const save=(id=request,p=payload())=>db.query('select public.save_mems_report($1,$2::jsonb) report',[id,JSON.stringify(p)]);
 await db.exec('set role authenticated');
 await assert.rejects(save(),/ไม่มีสิทธิ์/);
 await db.exec("reset role;update mems_report_settings set enabled=true;set role authenticated");
 await assert.rejects(save(),/ไม่มีสิทธิ์/);
 assert.equal((await db.query(`update mems_report_settings set enabled=false,updated_by='${actor}' returning id`)).rows.length,0);
 assert.equal((await db.query('select enabled from mems_report_settings')).rows[0].enabled,true);
 await db.exec("reset role;update user_profiles set permissions=array['pm_reports'] where role='user';set role authenticated");
 const bad=payload();delete bad.results['Self Test'];await assert.rejects(save(request,bad),/ผลตรวจไม่ครบ/);
 await assert.rejects(save(request,{...payload(),confirmed:false}),/ยืนยัน/);
 const result=await save(request,{...payload(),asset_id:'forged',asset_code:'forged'});
 assert.equal(result.rows[0].report.snapshot.asset_id,'138312');assert.equal(result.rows[0].report.snapshot.asset_code,'6515-real');
 await save(request,{...payload(),asset_id:'forged',asset_code:'forged'});
 assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,1);
 await assert.rejects(save(request,{...payload(),note:'changed'}),/ข้อมูลอื่น/);
 await assert.rejects(db.exec("update mems_reports set status='exported'"),/permission denied/);
 await assert.rejects(db.exec('delete from mems_reports'),/permission denied/);
 await db.exec("reset role;update mems_report_settings set enabled=false;set role authenticated");
 assert.equal((await db.query('select * from mems_reports')).rows.length,0);
 await assert.rejects(save(),/ไม่มีสิทธิ์/);
 await db.exec(`reset role;update mems_report_settings set enabled=true;update user_profiles set active=false where id='${actor}';set role authenticated`);
 await assert.rejects(save(),/ไม่มีสิทธิ์/);
 await db.exec(`reset role;update user_profiles set active=true where id='${actor}';set role authenticated;set request.jwt.claim.sub='${other}'`);
 const settings=await db.query(`update mems_report_settings set enabled=true,updated_by='${other}' returning enabled`);assert.equal(settings.rows.length,1);
 await assert.rejects(save(request,{...payload(),asset_id:'forged',asset_code:'forged'}),/ข้อมูลอื่น/);
 const manual={...payload('acceptance'),asset_pk:null,equipment_type:'เครื่องใหม่',brand:'A',model:'B'};
 await save('20000000-0000-4000-8000-000000000002',manual);
 assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,2);
 await assert.rejects(save('20000000-0000-4000-8000-000000000003',{...payload(),asset_pk:null}),/ทะเบียน/);
 }finally{await db.close();}
});
test('Apps Script maps both real Slides template field sets and never logs auth tokens',()=>{
 const code=fs.readFileSync(path.join(root,'gas/pm-reports/Code.gs'),'utf8');
 const ctx=vm.createContext({});vm.runInContext(code,ctx);
 for(const kind of ['pm','acceptance']){
  const p=payload(kind),s={tool_type:'Ventilator',brand:'Hamilton',model:'C2',asset_id:'138312',asset_code:'6515-real'};
  const values=ctx.reportValues_({payload:p,snapshot:s,report_date:'2026-10-28'});
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pm-template-fields.json'),'utf8'))[kind];
  for(const key of fixture)assert.ok(Object.hasOwn(values,key.slice(2,-2)),key);
  assert.equal(values['วันที่ปฎิบัติงาน'],'28/10/2026');assert.equal(values['ID / เลขครุภัณฑ์'],'ID 138312 / 6515-real');
 }
 assert.doesNotMatch(code,/console\.log|Logger\.log/);
});
test('export API rejects anonymous, revoked and foreign reports; handles missing setup, concurrent work, receipts and retries',async()=>{
 const {createExportHandler}=await import('../supabase/functions/mems-report-export/handler.mjs');
 const make=(options={})=>{
  let updates=[];let calls=0;
  const report={id:request,actor_user_id:actor,status:'saved',...options.report};
  const tables={user_profiles:{id:actor,active:true,role:'user',permissions:['pm_reports'],...options.profile},mems_report_settings:{enabled:true,bridge_url:'https://script.google.com/macros/s/abcdefghijk/exec',...options.settings},mems_reports:report};
  const admin={auth:{getUser:async()=>({data:{user:{id:actor}}})},from:table=>{
   let update;
   const q={select(){return q},eq(){return q},neq(){return q},or(){return q},update(v){update=v;updates.push(v);return q},single:async()=>({data:table==='mems_reports'&&update?{...report,...update}:tables[table]}),maybeSingle:async()=>({data:options.busy?null:{id:request}}),then(resolve){return Promise.resolve({}).then(resolve)}};return q;
  }};
  const handler=createExportHandler({createClient:()=>admin,env:()=>'',fetchImpl:async()=>{calls++;if(options.timeout)throw new Error('timeout');return {ok:true,json:async()=>options.receipt||{ok:true,report_id:request,slides_id:'slides123456789',pdf_id:'pdf123456789',folder_id:'folder123456789'}};}});
  return {handler,updates,calls:()=>calls};
 };
 const req=auth=>new Request('https://example.com',{method:'POST',headers:auth?{Authorization:'Bearer test'}:{},body:JSON.stringify({report_id:request})});
 assert.equal((await make().handler(req(false))).status,401);
 assert.equal((await make({profile:{active:false}}).handler(req(true))).status,403);
 assert.equal((await make({profile:{permissions:[]}}).handler(req(true))).status,403);
 assert.equal((await make({settings:{enabled:false}}).handler(req(true))).status,403);
 assert.equal((await make({report:{actor_user_id:other}}).handler(req(true))).status,403);
 assert.equal((await make({settings:{bridge_url:''}}).handler(req(true))).status,412);
 const busy=make({busy:true});assert.equal((await busy.handler(req(true))).status,409);assert.equal(busy.calls(),0);
 const done=make({report:{status:'exported'}});assert.equal((await done.handler(req(true))).status,200);assert.equal(done.calls(),0);
 const ok=make();assert.equal((await ok.handler(req(true))).status,200);assert.equal(ok.updates.at(-1).status,'exported');
 const bad=make({receipt:{ok:true,report_id:other}});assert.equal((await bad.handler(req(true))).status,400);assert.equal(bad.updates.at(-1).status,'export_error');
 const timeout=make({timeout:true});await timeout.handler(req(true));assert.equal(timeout.updates.at(-1).status,'export_error');
});
