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
 assert.doesNotThrow(()=>pm.validateInspection(p({results:{...p().results,'Self Test':'N/A'}})));
 assert.throws(()=>pm.validateInspection(p({results:{...p().results,'Self Test':'ไม่ผ่าน'}})),/หมายเหตุ/);
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
 for(const [n,kind] of [[190,'pm'],[191,'acceptance']]){
  const na=(await save(db,n,[item(n,{kind,note:'',results:Object.fromEntries(pm.fields(kind).map(f=>[f,'N/A']))})])).rows[0].reports[0];
  assert.equal(na.payload.note,'');assert.ok(Object.values(na.payload.results).every(v=>v==='N/A'));
 }
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

test('saved operators persist with titles, deduplicate, enforce permissions and preserve inspection titles',async()=>{
 const db=await setup();try{
 const savePerson=(name=' ผู้ตรวจทดสอบ ',title=' นายช่างเทคนิค ')=>db.query('select save_mems_report_operator($1,$2) person',[name,title]);
 const person=(await savePerson()).rows[0].person;assert.equal(person.name,'ผู้ตรวจทดสอบ');assert.equal(person.position,'นายช่างเทคนิค');
 assert.equal((await savePerson()).rows[0].person.id,person.id);assert.equal((await db.query('select count(*)::int n from mems_report_operators')).rows[0].n,1);
 await assert.rejects(savePerson('','title'),/กรอกชื่อ/);await assert.rejects(savePerson('Name','x'.repeat(201)),/200/);
 const report=(await save(db,100,[item(1,{operator:person.name,operator_position:person.position})])).rows[0].reports[0];assert.equal(report.snapshot.operator_position,person.position);
 await savePerson(person.name,'ตำแหน่งใหม่');assert.equal((await db.query('select snapshot from mems_reports')).rows[0].snapshot.operator_position,'นายช่างเทคนิค');
 await assert.rejects(save(db,101,[item(2,{operator_position:'x'.repeat(201)})]),/ตำแหน่ง/);
 await db.exec(`set request.jwt.claim.sub='${other}'`);assert.equal((await db.query('select * from mems_report_operators')).rows.length,2);
 await assert.rejects(db.exec("update mems_report_operators set name='changed'"),/permission denied/);
 await db.exec(`reset role;update mems_report_settings set enabled=false;set role authenticated`);await assert.rejects(savePerson(),/ไม่มีสิทธิ์/);
 assert.equal((await db.query("select has_table_privilege('anon','mems_report_operators','SELECT') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('tool categories seed from observed Form names, persist new names, deduplicate and restrict access',async()=>{
 const db=await setup();try{
 assert.equal((await db.query("select count(*)::int n from mems_report_tool_types where name='Ventilator' and source='form_confirmed'")).rows[0].n,1);
 const add=name=>db.query('select save_mems_report_tool_type($1) item',[name]);
 const a=(await add(' ชนิดเครื่องใหม่ ')).rows[0].item;assert.equal(a.name,'ชนิดเครื่องใหม่');assert.equal(a.source,'custom');
 assert.equal((await add('ชนิดเครื่องใหม่')).rows[0].item.id,a.id);
 assert.equal((await add('ventilator')).rows[0].item.name,'Ventilator');
 await assert.rejects(add(''),/กรอกชื่อ/);await assert.rejects(add('x'.repeat(201)),/200/);
 await assert.rejects(db.exec('delete from mems_report_tool_types'),/permission denied/);
 await db.exec('reset role;update mems_report_settings set enabled=false;set role authenticated');await assert.rejects(add('Other'),/ไม่มีสิทธิ์/);
 assert.equal((await db.query("select has_table_privilege('anon','mems_report_tool_types','SELECT') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('confirmed seven Form types hide historical guesses, preserve custom names and allow explicitly re-adding retired names',async()=>{
 const db=await setup();try{
 const expected=['Defibrillator','Infusionpump','Syringpump','Vital sing Monitor','Electrosurgical','Anesthetic Machine','Ventilator'];
 const names=(await db.query('select name from mems_report_tool_types')).rows.map(r=>r.name);
 assert.deepEqual(names.sort(),expected.sort());
 const added=(await db.query("select save_mems_report_tool_type('Monitor') as item")).rows[0].item;
 assert.equal(added.name,'Monitor');assert.equal(added.active,true);assert.equal(added.source,'custom');
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from mems_report_tool_types where name='Monitor'")).rows[0].n,2);
 // Reapplying the data migration must keep user additions available.
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261104044405_pm_confirmed_form_types.sql'),'utf8').replace('alter table public.mems_report_tool_types add column active boolean not null default true;',''));
 await db.exec('set role authenticated');assert.equal((await db.query("select count(*)::int n from mems_report_tool_types where name='Monitor'")).rows[0].n,1);
 }finally{await db.close();}
});

test('saved brands and models support brand-only entries, canonical casing, model pairs and permissions',async()=>{
 const db=await setup();try{
 const add=(b,m='')=>db.query('select save_mems_report_brand_model($1,$2) item',[b,m]);
 const brand=(await add(' Hamilton ')).rows[0].item;assert.equal(brand.brand,'Hamilton');assert.equal(brand.model,'');
 const model=(await add('hamilton',' C2 ')).rows[0].item;assert.equal(model.brand,'Hamilton');assert.equal(model.model,'C2');
 assert.equal((await add('HAMILTON','c2')).rows[0].item.id,model.id);
 const otherBrand=(await add('Other','C2')).rows[0].item;assert.notEqual(otherBrand.id,model.id);
 await assert.rejects(add(''),/กรอกยี่ห้อ/);await assert.rejects(add('x'.repeat(201),'model'),/200/);await assert.rejects(add('Brand','x'.repeat(201)),/200/);
 await assert.rejects(db.exec("update mems_report_brand_models set model='changed'"),/permission denied/);
 const report=(await save(db,100,[item(1,{brand:'Hamilton',model:'C2'})])).rows[0].reports[0];assert.equal(report.snapshot.brand,'Hamilton');assert.equal(report.snapshot.model,'C2');
 await add('Hamilton','New Model');assert.equal((await db.query('select snapshot from mems_reports')).rows[0].snapshot.model,'C2');
 await db.exec(`set request.jwt.claim.sub='${other}'`);assert.ok((await db.query('select * from mems_report_brand_models')).rows.length>=3);
 await db.exec('reset role;update mems_report_settings set enabled=false;set role authenticated');await assert.rejects(add('Next'),/ไม่มีสิทธิ์/);
 assert.equal((await db.query("select has_table_privilege('anon','mems_report_brand_models','SELECT') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('copy inspection results supports PM and acceptance, mixed outcomes and independent copies',()=>{
 for(const kind of ['pm','acceptance']) {
  const names=pm.fields(kind),source=Object.fromEntries(names.map((f,i)=>[f,['ผ่าน','ไม่ผ่าน','N/A'][i%3]]));
  const result=pm.inspectionResults(source,kind);assert.deepEqual(result,source);
  result[names[0]]='ไม่ผ่าน';assert.equal(source[names[0]],'ผ่าน');
  delete source[names[1]];assert.throws(()=>pm.inspectionResults(source,kind),/ครบทุกข้อ/);
 }
});

test('center acceptance registers new assets atomically, reuses existing machines and preserves original asset permissions',async()=>{
 const db=await setup();try{
 const acceptance=(overrides={})=>({kind:'acceptance',section:'ศูนย์เครื่องมือแพทย์',register_asset:true,results:Object.fromEntries(pm.fields('acceptance').map(f=>[f,'ผ่าน'])),...overrides});
 await db.exec("reset role;update user_profiles set permissions=array['pm_reports','assets'] where role='user';set role authenticated");
 const fresh=[item(1,acceptance({no:'99'}))];const first=(await save(db,100,fresh)).rows[0].reports[0];assert.equal(first.snapshot.asset_registered,true);assert.ok(first.snapshot.asset_pk);
 const registered=(await db.query('select * from assets where no=99')).rows[0];assert.equal(registered.status,'ใช้งานได้');assert.match(registered.note,/Hamilton/);assert.match(registered.note,/C2/);
 await save(db,100,fresh);assert.equal((await db.query('select count(*)::int n from assets where no=99')).rows[0].n,1);
 const again=(await save(db,101,[item(2,acceptance({no:'99'}))])).rows[0].reports[0];assert.equal(again.snapshot.asset_pk,first.snapshot.asset_pk);assert.equal(again.snapshot.asset_registered,undefined);
 const serial=(await save(db,102,[item(3,acceptance({equipment_type:'New',identity_mode:'serial',no:null,serial_number:'NEW-ONLY-SN'}))])).rows[0].reports[0];assert.equal(serial.snapshot.no,null);assert.equal(serial.snapshot.asset_status,'รอเลขครุภัณฑ์');
 const failed=(await save(db,103,[item(4,acceptance({no:'100',note:'Self Test ไม่ผ่าน',results:{...acceptance().results,'Self Test':'ไม่ผ่าน'}}))])).rows[0].reports[0];assert.equal(failed.snapshot.asset_status,'เครื่องยังไม่พร้อมใช้งาน');
 const before=(await db.query('select count(*)::int n from assets')).rows[0].n;
 await assert.rejects(save(db,104,[item(5,acceptance({no:'101'})),item(6,acceptance({no:'102',results:{}}))]),/ผลตรวจไม่ครบ/);
 assert.equal((await db.query('select count(*)::int n from assets')).rows[0].n,before);assert.equal((await db.query('select count(*)::int n from assets where no=101')).rows[0].n,0);
 await assert.rejects(save(db,105,[item(7,acceptance({no:'103',section:'PICU'}))]),/เฉพาะตรวจรับ/);
 await assert.rejects(save(db,106,[item(8,{no:'104',section:'ศูนย์เครื่องมือแพทย์',register_asset:true})]),/เฉพาะตรวจรับ/);
 await assert.rejects(save(db,107,[item(9,acceptance({no:'105',serial_number:'SN41'}))]),/S\/N นี้/);
 await assert.rejects(save(db,108,[item(10,acceptance({no:'41',serial_number:'other'}))]),/ไม่ตรง/);
 await assert.rejects(save(db,109,[item(11,acceptance({equipment_type:'Duplicate',identity_mode:'serial',no:null,serial_number:'DUP'})),item(12,acceptance({equipment_type:'Duplicate',identity_mode:'serial',no:null,serial_number:'DUP'}))]),/ซ้ำ/);
 assert.equal((await db.query("select count(*)::int n from assets where serial_number='DUP'")).rows[0].n,0);
 await db.exec("reset role;update user_profiles set permissions=array['pm_reports'] where role='user';set role authenticated");
 await assert.rejects(save(db,110,[item(13,acceptance({no:'106'}))]),/ไม่มีสิทธิ์เพิ่มทะเบียน/);
 await save(db,111,[item(14,acceptance({no:'106',register_asset:false}))]);assert.equal((await db.query('select count(*)::int n from assets where no=106')).rows[0].n,0);
 }finally{await db.close();}
});

test('acceptance duplicate lookup checks serial across names without merging shared numbers across types',()=>{
 const rows=[{id:1,type:'C2',no:41,serial_number:'SN41'}];
 const serial={equipment_type:'Different Name',identity_mode:'serial',identifier:'SN41'};
 assert.equal(pm.resolveInspectionMachine(rows,serial,'acceptance').id,1);
 assert.equal(pm.resolveInspectionMachine(rows,serial,'pm'),null);
 assert.equal(pm.resolveInspectionMachine(rows,{equipment_type:'Other',identity_mode:'no',identifier:'41'},'acceptance'),null);
 assert.throws(()=>pm.resolveInspectionMachine([...rows,{id:2,type:'Pump',serial_number:'SN41'}],serial,'acceptance'),/หลายเครื่อง/);
});
test('duplicate acceptance requires acknowledgement, records inspection only and detects registry races',async()=>{
 const db=await setup();try{
 const acceptance={kind:'acceptance',section:'ศูนย์เครื่องมือแพทย์',register_asset:false,duplicate_policy:'confirm_existing',results:Object.fromEntries(pm.fields('acceptance').map(f=>[f,'ผ่าน']))};
 await assert.rejects(save(db,100,[item(1,acceptance)]),/พบเครื่องในทะเบียนแล้ว/);
 assert.equal((await db.query('select count(*)::int n from mems_reports')).rows[0].n,0);
 const before=(await db.query('select * from assets order by id')).rows;
 const acknowledged={...acceptance,existing_registration_confirmed:true,existing_asset_id:'1'};
 const report=(await save(db,101,[item(2,acknowledged)])).rows[0].reports[0];
 assert.equal(report.snapshot.asset_pk,1);assert.equal(report.snapshot.acceptance_existing_asset,true);assert.equal(report.snapshot.asset_registered,undefined);
 await save(db,101,[item(2,acknowledged)]);assert.deepEqual((await db.query('select * from assets order by id')).rows,before);
 await assert.rejects(save(db,102,[item(3,{...acknowledged,existing_asset_id:'2'})]),/เปลี่ยนแล้ว/);
 await assert.rejects(save(db,103,[item(4,{...acknowledged,no:'99'})]),/ไม่พบทะเบียน/);
 await assert.rejects(save(db,104,[item(5,{...acknowledged,register_asset:true})]),/ต้องไม่เพิ่มทะเบียนซ้ำ/);
 await db.exec("reset role;update user_profiles set permissions=array['pm_reports','assets'] where role='user';set role authenticated");
 // The request expected a new device, but another writer registered it before this save.
 await assert.rejects(save(db,105,[item(6,{...acceptance,register_asset:true})]),/พบเครื่องในทะเบียนแล้ว/);
 await assert.rejects(save(db,106,[item(7,{...acceptance,register_asset:true,equipment_type:'Different Name',identity_mode:'serial',no:null,serial_number:'SN41'})]),/S\/N ตรงกัน/);
 assert.deepEqual((await db.query('select * from assets order by id')).rows,before);
 }finally{await db.close();}
});
