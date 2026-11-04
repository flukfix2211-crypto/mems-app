const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const pm=require('../pm-common');
const root=path.join(__dirname,'..');
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const uuid=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const {setup}=require('./fixtures/pm-native-db.cjs');

const p=(overrides={})=>({form_version:2,kind:'pm',date:'2026-11-04',equipment_type:'C2',identity_mode:'no',no:'41',serial_number:'',tool_type:'Ventilator',brand:'Hamilton',model:'C2',operator:'Tester',section:'PICU',note:'',replacement:'',confirmed:true,results:Object.fromEntries(pm.fields('pm').map(f=>[f,'ผ่าน'])),...overrides});
const item=(n,overrides)=>({id:uuid(n),payload:p(overrides)});
const save=(db,n,items)=>db.query('select public.save_mems_report_batch($1,$2::jsonb) as reports',[uuid(n),JSON.stringify(items)]);
test('resolve No/SN and duplicate aliases using registry IDs, without requiring asset codes',()=>{
 const rows=[{id:1,type:'C2',no:41,serial_number:'SN41'},{id:2,type:'Pump',no:41}];
 const a={equipment_type:'C2',identity_mode:'no',identifier:'041'},b={equipment_type:' C2 ',identity_mode:'serial',identifier:' SN41 '};
 assert.equal(pm.resolveMachine(rows,a).id,1);assert.equal(pm.machineKey(a,pm.resolveMachine(rows,a)),pm.machineKey(b,pm.resolveMachine(rows,b)));
 assert.equal(pm.resolveMachine(rows,{...a,equipment_type:'Other'}),null);
 assert.throws(()=>pm.resolveMachine([...rows,rows[0]],a),/ซ้ำ/);
 assert.throws(()=>pm.validateInspection(p({results:{}})),/ผลตรวจ/);
 assert.throws(()=>pm.validateInspection(p({results:{...p().results,'Self Test':'N/A'}})),/หมายเหตุ/);
});
test('native batch is atomic, snapshots registry identity, supports serial/manual/mixed types, and retries safely',async()=>{
 const db=await setup();try{
 const reports=[item(1),item(2,{equipment_type:'Pump',identity_mode:'serial',no:null,serial_number:'P41',brand:'A',model:'P'})];
 let result=(await save(db,100,reports)).rows[0].reports;assert.equal(result.length,2);assert.equal(result[0].snapshot.asset_id,'real-id');assert.equal(result[0].snapshot.serial_number,'SN41');assert.equal(result[1].snapshot.asset_pk,2);
 await save(db,100,reports);assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,2);
 await assert.rejects(save(db,100,[item(1,{note:'edited'})]),/ข้อมูลอื่น/);
 const invalid=[item(3),item(4,{results:{}})];await assert.rejects(save(db,101,invalid),/ผลตรวจไม่ครบ/);
 assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from mems_report_batches')).rows[0].n,1);
 await assert.rejects(save(db,102,[item(5),item(6,{identity_mode:'serial',no:null,serial_number:'SN41'})]),/ซ้ำ/);
 assert.equal((await db.query('select count(*)::int n from mems_report_batches')).rows[0].n,1);
 const manual=await save(db,103,[item(7,{identity_mode:'serial',no:null,serial_number:'NEW-SN',asset_pk:1})]);
 assert.equal(manual.rows[0].reports[0].snapshot.source,'manual');assert.equal(manual.rows[0].reports[0].snapshot.no,null);
 const acceptance={kind:'acceptance',equipment_type:'New',identity_mode:'serial',no:null,serial_number:'NEW2',results:Object.fromEntries(pm.fields('acceptance').map(f=>[f,'ผ่าน']))};
 assert.equal((await save(db,104,[item(8,acceptance)])).rows[0].reports[0].kind,'acceptance');
 await assert.rejects(save(db,105,[item(9,{results:{...p().results,'Self Test':'ไม่ผ่าน'}})]),/หมายเหตุ/);
 const note=await save(db,106,[item(10,{note:'ไม่มีอุปกรณ์นี้',results:{...p().results,'Self Test':'N/A'}})]);assert.equal(note.rows[0].reports[0].payload.note,'ไม่มีอุปกรณ์นี้');
 await assert.rejects(save(db,107,[item(11),item(12,{date:'2026-11-03'})]),/วันที่เดียวกัน/);
 await assert.rejects(save(db,108,Array.from({length:51},(_,i)=>item(200+i))),/50/);
 await db.exec(`reset role;update assets set asset_id='changed';set role authenticated`);
 assert.equal((await save(db,100,reports)).rows[0].reports[0].snapshot.asset_id,'real-id');
 }finally{await db.close();}
});
test('batch permissions, direct writes and deferred completeness cannot bypass validation',async()=>{
 const db=await setup();try{
 await assert.rejects(db.query('insert into mems_report_batches(id,payload) values($1,$2)',[uuid(100),JSON.stringify([item(1)])]),/ไม่ครบ/);
 await assert.rejects(db.query("insert into mems_reports(id,kind,report_date,payload,snapshot) values($1,'pm','2026-11-04',$2,'{}')",[uuid(1),JSON.stringify(p())]),/ชุดงาน/);
 await save(db,100,[item(1)]);
 await assert.rejects(db.exec('update mems_report_batches set payload=\'[]\''),/permission denied/);
 await assert.rejects(db.exec('delete from mems_reports'),/permission denied/);
 await db.exec(`set request.jwt.claim.sub='${other}'`);await assert.rejects(save(db,100,[item(1)]),/ข้อมูลอื่น/);
 await db.exec(`reset role;update user_profiles set active=false where id='${actor}';set role authenticated;set request.jwt.claim.sub='${actor}'`);
 await assert.rejects(save(db,101,[item(2)]),/ไม่มีสิทธิ์/);assert.equal((await db.query('select * from mems_report_batches')).rows.length,0);
 await db.exec(`reset role;update user_profiles set active=true where id='${actor}';update mems_report_settings set enabled=false;set role authenticated`);
 await assert.rejects(save(db,101,[item(2)]),/ไม่มีสิทธิ์/);
 assert.equal((await db.query("select has_table_privilege('anon','mems_report_batches','SELECT') permitted")).rows[0].permitted,false);
 }finally{await db.close();}
});

test('legacy single reports remain readable and writable with the upgraded trigger',async()=>{
 const db=await setup();try{
 const legacy=p({asset_pk:1});delete legacy.form_version;delete legacy.identity_mode;
 const result=await db.query('select save_mems_report($1,$2::jsonb) report',[uuid(1),JSON.stringify(legacy)]);
 assert.equal(result.rows[0].report.snapshot.asset_id,'real-id');assert.equal(result.rows[0].report.batch_id,null);
 }finally{await db.close();}
});
