/* Deploy this standalone Apps Script as the Drive owner's Web App.
 * Every request must authenticate against MEMS and pass live RLS checks.
 * Never log request bodies or tokens. No Google tokens leave Apps Script.
 */
const MEMS_URL='https://pxmhmgdbuhmubviuxcxp.supabase.co';
const MEMS_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bWhtZ2RidWhtdWJ2aXV4Y3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzM1MDQsImV4cCI6MjEwMjUwOTUwNH0.MqQ660fj2ZnFRXXqeSVav0DVehRy3OAaXux69O6BJOY';
const REPORT_ROOT='1L3K9n7O1kVabVXxmFrQFAYF0KycMxsK8';
const REPORT_TEMPLATES={pm:'1jAI6-CXKjXVHTEYI-3hgMqNcIhjdjEwKznp6tUpM5EE',acceptance:'1IbSwjOJ-klgZbRA9EuCHvpctPQz4pYDIWswQpW62t_0'};
function doGet(){return json_({ok:false,error:'Use the MEMS report menu to create a report.'});}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function memsGet_(path,token){
 const response=UrlFetchApp.fetch(MEMS_URL+path,{headers:{apikey:MEMS_ANON_KEY,Authorization:'Bearer '+token},muteHttpExceptions:true});
 if(response.getResponseCode()!==200)throw new Error('ไม่มีสิทธิ์หรือหมดเวลาการเข้าสู่ระบบ MEMS');
 return JSON.parse(response.getContentText());
}
function childFolder_(parent,name){const found=parent.getFoldersByName(name);return found.hasNext()?found.next():parent.createFolder(name);}
function file_(folder,name){const found=folder.getFilesByName(name);return found.hasNext()?found.next():null;}
function reportValues_(report){
 const p=report.payload,s=report.snapshot;
 const date=report.report_date.split('-').reverse().join('/');
 const ids=[s.asset_id?'ID '+s.asset_id:'',s.asset_code||''].filter(Boolean).join(' / ');
 const values={'ชนิดของเครื่องมือ / TYPE':s.tool_type||s.equipment_type,'ยี่ห้อ / BAND':s.brand||'','รุ่น / MODEL':s.model||'','S/N':s.serial_number||'','ID / เลขครุภัณฑ์':ids,'หน่วยงาน / SECTION':p.section,'ผู้ปฏิบัติงาน':p.operator,'ผู้ตรวจรับเครื่องมือ':p.operator,'วันที่ปฎิบัติงาน':date,'วันที่ตรวจรับ':date,'หมายเหตุ':p.note||'','เปลี่ยนวัสดุตามอายุงาน':p.replacement||''};
 Object.keys(p.results||{}).forEach(key=>{values[key]=p.results[key];});
 return values;
}
function reportText_(deck){return deck.getSlides().map(slide=>slide.getShapes().map(shape=>shape.getText().asString()).join('\n')).join('\n');}
function doPost(e){
 let lock;
 try{
  if(!e.postData||e.postData.contents.length>12000)throw new Error('คำขอไม่ถูกต้อง');
  const input=JSON.parse(e.postData.contents);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.report_id||'')||typeof input.token!=='string'||input.token.length>8000)throw new Error('คำขอไม่ถูกต้อง');
  const user=memsGet_('/auth/v1/user',input.token);
  const rows=memsGet_('/rest/v1/mems_reports?id=eq.'+input.report_id+'&select=*',input.token);
  const profiles=memsGet_('/rest/v1/user_profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,active,role,permissions',input.token);
  const profile=profiles[0],report=rows[0];
  if(!profile||!profile.active||!report||!(profile.role==='admin'||(profile.permissions||[]).indexOf('pm_reports')>=0))throw new Error('ไม่มีสิทธิ์ใช้งานรายงาน');
  if(report.actor_user_id!==user.id&&profile.role!=='admin')throw new Error('ไม่มีสิทธิ์สร้างไฟล์รายงานของผู้อื่น');
  if(!REPORT_TEMPLATES[report.kind]||report.payload.confirmed!==true)throw new Error('รายงานไม่สมบูรณ์');
  lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))throw new Error('กำลังสร้างรายงานอื่น กรุณาลองรายการเดิมอีกครั้ง');
  // Live RLS is checked again after taking the lock, so revocation is immediate.
  if(!memsGet_('/rest/v1/mems_reports?id=eq.'+input.report_id+'&select=id',input.token).length)throw new Error('สิทธิ์ถูกยกเลิกหรือฟังก์ชันปิดอยู่');
  const root=DriveApp.getFolderById(REPORT_ROOT);
  const kind=childFolder_(root,report.kind==='pm'?'PM':'ตรวจรับเครื่องใหม่');
  const month=childFolder_(kind,report.report_date.slice(0,7));
  const folder=childFolder_(month,report.id);
  const s=report.snapshot;
  const name=(report.kind==='pm'?'PM':'ตรวจรับ')+'_'+String(s.equipment_type||'เครื่องใหม่').replace(/[\\/]/g,'-')+(s.no?'_No'+s.no:'')+'_'+report.report_date+'_'+report.id.slice(0,8);
  let slideFile=file_(folder,name),pdfFile=file_(folder,name+'.pdf');
  if(!slideFile)slideFile=DriveApp.getFileById(REPORT_TEMPLATES[report.kind]).makeCopy(name,folder);
  if(!pdfFile){
   const deck=SlidesApp.openById(slideFile.getId()),values=reportValues_(report);
   const before=reportText_(deck),placeholders=before.match(/<<[^>]+>>/g)||[];
   placeholders.forEach(key=>{if(!Object.prototype.hasOwnProperty.call(values,key.slice(2,-2)))throw new Error('ต้นแบบมีช่องที่ยังไม่ได้จับคู่: '+key);});
   Object.keys(values).forEach(key=>deck.replaceAllText('<<'+key+'>>',String(values[key]===null?'':values[key])));
   if(/<<[^>]+>>/.test(reportText_(deck)))throw new Error('ยังมีช่องต้นแบบที่กรอกไม่ครบ');
   deck.saveAndClose();
   pdfFile=folder.createFile(slideFile.getAs(MimeType.PDF).setName(name+'.pdf'));
  }
  return json_({ok:true,report_id:report.id,slides_id:slideFile.getId(),pdf_id:pdfFile.getId(),folder_id:folder.getId()});
 }catch(error){return json_({ok:false,error:String(error.message||'สร้างรายงานไม่สำเร็จ').slice(0,300)});}
 finally{if(lock&&lock.hasLock())lock.releaseLock();}
}

