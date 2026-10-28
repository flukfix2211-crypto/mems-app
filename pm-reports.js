/* Uses the existing MEMS session and RLS. No Google credentials in the browser. */
(function () {
  'use strict';
  const {fields,parseNumbers,matchAssets,today,esc}=MemsPM;
  const $=id=>document.getElementById(id);
  let assets=[],settings=null,profile=null,drafts=[],saving=false,page=0;
  const notice=(message,error=false)=>{ $('pmNotice').textContent=message;$('pmNotice').className='notice'+(error?' error':''); };
  const guarded=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message||'เกิดข้อผิดพลาด กรุณาลองใหม่',true);}};
  const statusLabel={saved:'บันทึกประวัติแล้ว · ยังไม่สร้างไฟล์',generating:'กำลังสร้างไฟล์',exported:'เก็บรายงานใน Drive แล้ว',export_error:'บันทึกแล้ว · สร้างไฟล์ไม่สำเร็จ'};
  function clearReview(){if(saving)return;drafts=[];$('reviewPanel').hidden=true;$('confirmed').checked=false;}
  async function loadSettings(){
    const {data,error}=await supabase.from('mems_report_settings').select('*').eq('id',true).single();
    if(error)throw new Error('โหลดการตั้งค่า PM ไม่สำเร็จ กรุณาตรวจการติดตั้งฐานข้อมูล');
    settings=data;
    $('pmAdmin').hidden=profile.role!=='admin';$('pmEnabled').checked=data.enabled;$('pmBridge').value=data.bridge_url;
    $('pmWorkspace').hidden=!data.enabled;
    notice(!data.enabled?'ฟังก์ชันยังปิดอยู่ แอดมินเปิดใช้งานได้จากการตั้งค่าด้านบน':data.bridge_url?'พร้อมใช้งาน · ดึงทะเบียน MEMS ล่าสุดก่อนบันทึก':'บันทึกประวัติใน MEMS ได้แล้ว · รอแอดมินเชื่อมต่อ Apps Script เพื่อสร้างไฟล์ใน Drive');
  }
  async function loadAssets(){
    const rows=[];
    for(let start=0;;start+=1000){
      const {data,error}=await supabase.from('assets').select('id,type,no,asset_code,asset_id,serial_number,status').order('id').range(start,start+999);
      if(error)throw new Error('อ่านทะเบียนเครื่องมือไม่ได้: '+error.message);
      rows.push(...data);if(data.length<1000)break;
    }
    assets=rows;
    const old=$('equipmentType').value;
    const types=[...new Set(rows.map(a=>a.type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
    $('equipmentType').innerHTML='<option value="">เลือกประเภทเครื่อง</option>'+types.map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('');
    if(types.includes(old))$('equipmentType').value=old;else if(types.includes('C2'))$('equipmentType').value='C2';
  }
  function changeKind(){
    const acceptance=$('reportKind').value==='acceptance';$('manualLabel').hidden=!acceptance;
    if(!acceptance)$('manualMode').checked=false;
    changeManual();
  }
  function changeManual(){
    const manual=$('manualMode').checked && $('reportKind').value==='acceptance';
    $('manualFields').hidden=!manual;$('equipmentType').disabled=manual;$('equipmentType').required=!manual;$('machineNos').disabled=manual;
    if(manual){$('brand').value='';$('model').value='';$('toolType').value='';}
    $('manualType').required=manual;clearReview();
  }
  function readCommon(){
    const v=id=>$(id).value.trim();
    return {kind:v('reportKind'),date:v('reportDate'),tool_type:v('toolType'),brand:v('brand'),model:v('model'),serial_number:v('serial'),section:v('section'),operator:v('operator'),replacement:v('replacement'),note:v('note')};
  }
  async function prepare(event){
    event.preventDefault();if(saving)return;
    $('prepareReports').disabled=true;
    try{
      await loadSettings();if(!settings.enabled)throw new Error('แอดมินปิดฟังก์ชันนี้อยู่');
      const p=readCommon();let selected;
      if($('manualMode').checked && p.kind==='acceptance'){
        selected=[{id:null,no:$('manualNo').value,type:$('manualType').value.trim(),asset_id:$('manualId').value.trim(),asset_code:$('manualCode').value.trim()}];
      }else{
        const type=$('equipmentType').value;const nos=parseNumbers($('machineNos').value);
        await loadAssets();selected=matchAssets(assets,type,nos);
      }
      drafts=selected.map(a=>({requestId:MemsPM.requestId(),asset:a,payload:{...p,asset_pk:a.id,equipment_type:a.type,no:a.no,asset_id:a.asset_id,asset_code:a.asset_code,results:{}},saved:null}));
      $('confirmed').checked=false;$('reviewTitle').textContent='ตรวจทาน '+drafts.length+' เครื่อง';$('applyC2').hidden=p.kind!=='pm'||selected.some(a=>a.type!=='C2');
      $('reviewCards').innerHTML=drafts.map((d,i)=>`<details class="review-machine" ${i===0?'open':''}><summary>${esc(d.asset.type)} ${d.asset.no?'No.'+esc(d.asset.no):'เครื่องใหม่'}<small>ID ${esc(d.asset.asset_id||'ยังไม่มี')} · ${esc(d.asset.asset_code||'ยังไม่มีเลขครุภัณฑ์')}</small></summary><div class="form-grid" style="margin-top:16px"><label>S/N เครื่องนี้ (เว้นว่างได้)<input data-serial="${i}" value="${esc(p.serial_number)}" maxlength="200"></label><label>หมายเหตุเครื่องนี้<input data-note="${i}" value="${esc(p.note)}" maxlength="2000"></label></div><div class="result-grid">${fields(p.kind).map((field,j)=>`<label class="result-row"><span>${esc(field)}</span><select data-machine="${i}" data-field="${j}" aria-label="${esc(d.asset.type+' No.'+(d.asset.no||'ใหม่')+' '+field)}"><option value="">เลือกผล</option><option>ผ่าน</option><option>ไม่ผ่าน</option><option>N/A</option></select></label>`).join('')}</div><div class="machine-status" id="draftStatus${i}"></div></details>`).join('');
      $('reviewPanel').hidden=false;$('batchProgress').textContent='';$('saveReports').disabled=false;
      $('reviewPanel').scrollIntoView({behavior:'smooth',block:'start'});
    }finally{$('prepareReports').disabled=false;}
  }
  function applyC2(){
    if(!drafts.length || drafts.some(d=>d.payload.kind!=='pm'||d.asset.type!=='C2'))return;
    document.querySelectorAll('[data-machine]').forEach(select=>{if(select.disabled)return;const d=drafts[Number(select.dataset.machine)];select.value=fields(d.payload.kind)[Number(select.dataset.field)]==='สายสัญญาณต่างๆ'?'N/A':'ผ่าน';});
    $('confirmed').checked=false;
  }
  async function exportReport(id){
    const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('กรุณาเข้าสู่ระบบใหม่');
    const res=await fetch(SUPABASE_URL+'/functions/v1/mems-report-export',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({report_id:id})});
    const json=await res.json();if(!res.ok || !json.ok)throw new Error(json.error||'สร้างไฟล์ยังไม่สำเร็จ กรุณาตรวจสถานะจากประวัติ');return json.report;
  }
  async function save(){
    if(saving || !drafts.length)return;
    if(!$('confirmed').checked)throw new Error('กรุณายืนยันผลตรวจจริงก่อนบันทึก');
    for(let i=0;i<drafts.length;i++){
      const d=drafts[i];if(d.saved)continue;
      const results={};document.querySelectorAll('[data-machine="'+i+'"]').forEach(s=>{results[fields(d.payload.kind)[Number(s.dataset.field)]]=s.value;});
      if(fields(d.payload.kind).some(f=>!['ผ่าน','ไม่ผ่าน','N/A'].includes(results[f])))throw new Error('เลือกผลตรวจให้ครบทุกข้อของเครื่องที่ '+(i+1));
      d.payload={...d.payload,results,serial_number:document.querySelector('[data-serial="'+i+'"]').value.trim(),note:document.querySelector('[data-note="'+i+'"]').value.trim(),confirmed:true};
    }
    saving=true;$('saveReports').disabled=true;$('pmForm').inert=true;$('reviewCards').inert=true;$('applyC2').disabled=true;$('confirmed').disabled=true;
    let failures=0;
    try{
      await loadSettings();if(!settings.enabled)throw new Error('แอดมินปิดฟังก์ชันนี้อยู่');
      for(let i=0;i<drafts.length;i++){
        const d=drafts[i];const el=$('draftStatus'+i);
        $('batchProgress').textContent='กำลังบันทึกเครื่องที่ '+(i+1)+' / '+drafts.length;
        try{
          if(!d.saved){const {data,error}=await supabase.rpc('save_mems_report',{request_id:d.requestId,report_payload:d.payload});if(error)throw error;d.saved=data;}
          document.querySelectorAll('[data-machine="'+i+'"], [data-serial="'+i+'"], [data-note="'+i+'"]').forEach(input=>{input.disabled=true;});
          if(settings.bridge_url && d.saved.status!=='exported')d.saved=await exportReport(d.saved.id);
          el.textContent=statusLabel[d.saved.status];el.className='machine-status';
        }catch(error){failures++;el.textContent=(d.saved?'บันทึกประวัติแล้ว · ':'')+(error.message||'ยังยืนยันการบันทึกไม่ได้')+' · ลองรายการเดิมได้โดยไม่สร้างประวัติซ้ำ';el.className='machine-status error-text';}
      }
      $('batchProgress').textContent=failures?'มี '+failures+' รายการที่ต้องตรวจสอบ กดลองรายการเดิมอีกครั้ง หรือไปที่ประวัติ':'บันทึกประวัติครบ '+drafts.length+' เครื่อง'+(settings.bridge_url?' และสร้างไฟล์ใน Drive แล้ว':' · รอเชื่อมต่อ Drive ก่อนสร้างไฟล์');
      $('saveReports').textContent=failures?'ลองรายการที่ยังไม่สำเร็จอีกครั้ง':'บันทึกครบแล้ว';$('saveReports').disabled=!failures;
      notice($('batchProgress').textContent,!!failures);
    }finally{saving=false;$('pmForm').inert=false;$('reviewCards').inert=false;$('applyC2').disabled=false;$('confirmed').disabled=false;if(failures||drafts.some(d=>!d.saved))$('saveReports').disabled=false;}
  }
  async function history(){
    $('historyList').innerHTML='<p class="empty">กำลังโหลดประวัติ…</p>';
    let q=supabase.from('mems_reports').select('*').order('created_at',{ascending:false}).order('id').range(page*20,page*20+20);
    if($('filterKind').value)q=q.eq('kind',$('filterKind').value);
    if($('filterFrom').value)q=q.gte('report_date',$('filterFrom').value);
    if($('filterTo').value)q=q.lte('report_date',$('filterTo').value);
    if($('filterNo').value)q=q.eq('snapshot->>no',String(Number($('filterNo').value)));
    const {data,error}=await q;if(error){$('historyList').innerHTML='';throw error;}
    $('prevPage').disabled=page===0;$('nextPage').disabled=data.length<=20;$('pageLabel').textContent='หน้า '+(page+1);
    $('historyList').innerHTML=data.slice(0,20).map(r=>{const s=r.snapshot,p=r.payload;return `<article class="history-item"><h3>${r.kind==='pm'?'PM':'ตรวจรับใหม่'} · ${esc(s.equipment_type)} ${s.no?'No.'+esc(s.no):'เครื่องใหม่'}</h3><div class="muted">${esc(r.report_date)} · ${esc(p.operator)} · ${esc(p.section)}<br>ID ${esc(s.asset_id||'—')} · ${esc(s.asset_code||'—')}</div><div class="machine-status">${esc(statusLabel[r.status]||r.status)}</div>${r.export_error?'<div class="error-text muted">'+esc(r.export_error)+'</div>':''}<details><summary>ดูผลตรวจที่บันทึก</summary>${fields(r.kind).map(f=>'<div>'+esc(f)+' — '+esc(p.results[f])+'</div>').join('')}<p>หมายเหตุ: ${esc(p.note||'—')}</p></details><div class="history-actions">${r.slides_id?'<a target="_blank" rel="noopener" href="https://docs.google.com/presentation/d/'+encodeURIComponent(r.slides_id)+'/edit">เปิด Google Slides ↗</a>':''}${r.pdf_id?'<a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+encodeURIComponent(r.pdf_id)+'/view">เปิด PDF ↗</a>':''}${r.status!=='exported'&&(r.actor_user_id===profile.id||profile.role==='admin')?'<button type="button" data-export="'+esc(r.id)+'">'+(r.status==='generating'?'ตรวจสถานะ / สร้างต่อ':'สร้างรายงานใน Drive')+'</button>':''}</div></article>`;}).join('')||'<p class="empty">ยังไม่มีรายงานในช่วงที่เลือก</p>';
  }
  function tabs(isHistory){$('newPanel').hidden=isHistory;$('historyPanel').hidden=!isHistory;$('newTab').setAttribute('aria-pressed',String(!isHistory));$('historyTab').setAttribute('aria-pressed',String(isHistory));}
  window.addEventListener('DOMContentLoaded',guarded(async()=>{
    profile=await memsGuard('pm_reports');if(!profile)return;
    $('reportDate').value=today();$('operator').value=profile.display_name||profile.username;
    await loadSettings();await loadAssets();
    $('saveSettings').addEventListener('click',guarded(async()=>{const button=$('saveSettings');button.disabled=true;try{const url=$('pmBridge').value.trim();if(url&&!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw new Error('ใช้ลิงก์ Apps Script ที่ลงท้าย /exec เท่านั้น');const {error}=await supabase.from('mems_report_settings').update({enabled:$('pmEnabled').checked,bridge_url:url,updated_by:profile.id,updated_at:new Date().toISOString()}).eq('id',true);if(error)throw error;clearReview();await loadSettings();}finally{button.disabled=false;}}));
    $('pmForm').addEventListener('submit',guarded(prepare));$('reportKind').addEventListener('change',changeKind);$('manualMode').addEventListener('change',changeManual);
    $('equipmentType').addEventListener('change',()=>{const type=$('equipmentType').value;const tool={'C2':'Ventilator','T1':'Ventilator','Monnal t60':'Ventilator','Brid เขียว':'Ventilator','Infusion Pump':'Infusionpump','Syringe Pump':'Syringpump'};$('toolType').value=tool[type]||type;$('brand').value=type==='C2'?'Hamilton':'';$('model').value=type==='C2'?'C2':type;});
    $('pmForm').addEventListener('input',clearReview);$('pmForm').addEventListener('change',clearReview);
    $('reviewCards').addEventListener('change',()=>{$('confirmed').checked=false;});
    $('applyC2').addEventListener('click',applyC2);$('saveReports').addEventListener('click',guarded(save));
    $('newTab').addEventListener('click',()=>tabs(false));$('historyTab').addEventListener('click',guarded(async()=>{tabs(true);page=0;await history();}));
    $('refreshHistory').addEventListener('click',guarded(history));$('filterHistory').addEventListener('click',guarded(async()=>{page=0;await history();}));
    $('prevPage').addEventListener('click',guarded(async()=>{if(page>0)page--;await history();}));$('nextPage').addEventListener('click',guarded(async()=>{page++;await history();}));
    $('historyList').addEventListener('click',guarded(async event=>{const button=event.target.closest('[data-export]');if(!button)return;button.disabled=true;try{await exportReport(button.dataset.export);await history();notice('เก็บรายงานใน Drive แล้ว');}finally{button.disabled=false;}}));
  }));
})();
