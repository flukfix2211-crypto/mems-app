/* Native MEMs inspections: atomic batches and printable PDFs, without a Google bridge. */
(() => {
  'use strict';
  const {fields,today,esc,requestId,resolveMachine,machineKey,validateInspection}=MemsPM;
  const $=id=>document.getElementById(id);
  let assets=[],profile,rows=[],page=0,historyRows=[],savedRows=[],reviewed=null,pending=null,busy=false;
  const notice=(text,error=false)=>{$('pmNotice').textContent=text;$('pmNotice').className='notice'+(error?' error':'');};
  const guard=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message||String(error),true);}};
  function invalidate(){reviewed=null;$('reviewPanel').hidden=true;$('confirmed').checked=false;}
  function newMachine(type='',mode='no',identifier='') {
    return {equipment_type:type,identity_mode:mode,identifier,brand:'',model:'',tool_type:'',section:'',note:'',replacement:'',results:{}};
  }
  async function loadSettings(){
    const {data,error}=await supabase.from('mems_report_settings').select('enabled').eq('id',true).single();
    if(error)throw error;
    $('pmEnabled').checked=data.enabled;$('pmAdmin').hidden=profile.role!=='admin';$('pmWorkspace').hidden=!data.enabled;
    if(!data.enabled)notice('ฟังก์ชันยังปิดอยู่ แอดมินเปิดใช้งานได้จากการตั้งค่า');
    return data.enabled;
  }
  async function loadAssets(){
    assets=await fetchAllPages(()=>supabase.from('assets').select('id,type,no,asset_code,asset_id,serial_number').order('id'));
    $('pmTypes').innerHTML=[...new Set(assets.map(a=>a.type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')).map(type=>'<option value="'+esc(type)+'"></option>').join('');
  }
  const input=(row,index,key,label,extra='')=>`<label>${label}<input data-row="${index}" data-key="${key}" value="${esc(row[key])}" maxlength="${key==='note'||key==='replacement'?2000:200}" ${extra}></label>`;
  function renderMachines(openIndex=rows.length-1){
    $('machineList').innerHTML=rows.map((row,i)=>`<details class="pm-machine" ${i===openIndex?'open':''}><summary id="machineTitle${i}"></summary><div class="pm-machine-content"><div class="form-grid">
      ${input(row,i,'equipment_type','ประเภทเครื่อง','list="pmTypes"')}
      <label>ระบุเครื่องด้วย<select data-row="${i}" data-key="identity_mode"><option value="no" ${row.identity_mode==='no'?'selected':''}>No. เครื่อง</option><option value="serial" ${row.identity_mode==='serial'?'selected':''}>S/N</option></select></label>
      ${input(row,i,'identifier','No. หรือ S/N')}${input(row,i,'tool_type','ชนิดเครื่องมือบนรายงาน','placeholder="เช่น Ventilator"')}${input(row,i,'brand','ยี่ห้อ')}${input(row,i,'model','รุ่น')}${input(row,i,'section','หน่วยงานของเครื่อง','list="pmWards" placeholder="ใช้หน่วยงานเริ่มต้นของชุดงาน"')}
      </div><div class="pm-status" id="machineStatus${i}"></div><div class="result-grid">${fields($('reportKind').value).map((field,j)=>`<label class="result-row"><span>${esc(field)}</span><select data-row="${i}" data-check="${j}" aria-label="เครื่องที่ ${i+1} ${esc(field)}"><option value="">เลือกผล</option>${['ผ่าน','ไม่ผ่าน','N/A'].map(value=>`<option ${row.results[field]===value?'selected':''}>${value}</option>`).join('')}</select></label>`).join('')}</div>
      ${$('reportKind').value==='pm'?input(row,i,'replacement','เปลี่ยนวัสดุตามอายุงาน (ถ้ามี)'):''}
      <label>หมายเหตุเฉพาะเครื่องนี้<textarea data-row="${i}" data-key="note" rows="3" maxlength="2000" placeholder="ระบุรายละเอียดกรณีไม่ผ่านหรือ N/A และหมายเหตุของเครื่องนี้">${esc(row.note)}</textarea></label>
      <button type="button" data-copy-details="${i}">ใช้รายละเอียดนี้กับเครื่องประเภทเดียวกัน</button>
      <button type="button" class="pm-remove" data-remove="${i}">ลบเครื่องนี้จากชุดงาน</button></div></details>`).join('');
    rows.forEach((_,i)=>updateMachine(i));summary();
  }
  function updateMachine(i){
    const row=rows[i];$('machineTitle'+i).textContent=String(i+1).padStart(2,'0')+' · '+(row.equipment_type||'เลือกประเภทเครื่อง')+' · '+(row.identity_mode==='no'?'No.':'S/N ')+(row.identifier||'ยังไม่ระบุ');
    const status=$('machineStatus'+i);
    if(!row.identifier||!row.equipment_type){status.textContent='เลือกประเภทและกรอก No. หรือ S/N เพื่อค้นทะเบียน';return;}
    try{
      const a=resolveMachine(assets,row);
      status.textContent=a?'เชื่อมทะเบียน: '+a.type+' '+(a.no?'No.'+a.no:'')+' · ID '+(a.asset_id||'—')+' · เลขครุภัณฑ์ '+(a.asset_code||'—')+(a.serial_number?' · S/N '+a.serial_number:''):'ยังไม่พบในทะเบียน · กรอกรายละเอียดเพื่อบันทึกรายงานได้โดยไม่สร้างทะเบียนอัตโนมัติ';
      status.className='pm-status';
    }catch(error){status.textContent=error.message;status.className='pm-status error-text';}
  }
  function summary(){
    $('machineCount').textContent=rows.length+' เครื่อง';
    $('batchSummary').innerHTML=[['เครื่องทั้งหมด',rows.length],['ระบุด้วย No.',rows.filter(r=>r.identity_mode==='no').length],['ระบุด้วย S/N',rows.filter(r=>r.identity_mode==='serial').length]].map(([label,n])=>'<div class="pm-summary-row"><span>'+label+'</span><strong>'+n+'</strong></div>').join('');
    $('addMachine').disabled=rows.length>=50;$('bulkAdd').disabled=rows.length>=50;
  }
  function lock(locked){$('pmForm').inert=locked;$('confirmed').disabled=locked;$('newTab').disabled=locked;$('historyTab').disabled=locked;}
  function makePayload(row){
    const asset=resolveMachine(assets,row);
    const payload={form_version:2,kind:$('reportKind').value,date:$('reportDate').value,operator:$('operator').value.trim(),section:row.section.trim()||$('section').value.trim(),
      equipment_type:row.equipment_type.trim(),identity_mode:row.identity_mode,no:row.identity_mode==='no'?String(Number(row.identifier)):null,
      serial_number:row.identity_mode==='serial'?row.identifier.trim():(asset?.serial_number||''),
      tool_type:row.tool_type.trim(),brand:row.brand.trim(),model:row.model.trim(),note:row.note.trim(),replacement:row.replacement.trim(),results:row.results,confirmed:true};
    validateInspection(payload);
    return {payload,asset,key:machineKey(row,asset)};
  }
  async function review(event){
    event.preventDefault();if(busy||pending)return;
    invalidate();
    if(!rows.length)throw new Error('เพิ่มเครื่องอย่างน้อย 1 เครื่อง');
    if(!$('reportDate').checkValidity()||!$('reportDate').value)throw new Error('เลือกวันที่ให้ถูกต้อง');
    if(!$('operator').value.trim()||!$('section').value.trim())throw new Error('กรอกผู้ตรวจและหน่วยงานเริ่มต้น');
    $('reviewBtn').disabled=true;
    try{
      await loadAssets();
      const seen=new Set(),items=[];
      for(let i=0;i<rows.length;i++){
        try{const item=makePayload(rows[i]);if(seen.has(item.key))throw new Error('เครื่องซ้ำในชุดงาน');seen.add(item.key);items.push({id:requestId(),payload:item.payload});}
        catch(error){$('machineList').children[i].open=true;$('machineList').children[i].scrollIntoView({behavior:'smooth',block:'center'});throw new Error('เครื่องที่ '+(i+1)+': '+error.message);}
      }
      reviewed=items;notice('ตรวจข้อมูลครบแล้ว กรุณาตรวจทานและยืนยันผลจริงก่อนบันทึก');
      $('reviewSummary').innerHTML='<h2>ตรวจทาน '+items.length+' เครื่องก่อนบันทึก</h2>'+items.map(({payload:p},i)=>'<div class="pm-review-row"><strong>'+esc((i+1)+'. '+p.equipment_type+' '+(p.identity_mode==='no'?'No.'+p.no:'S/N '+p.serial_number))+'</strong>'+esc(p.brand+' · '+p.model+' · '+p.section)+'<p>'+esc(fields(p.kind).filter(f=>p.results[f]!=='ผ่าน').map(f=>f+': '+p.results[f]).join('\n')||'ผลตรวจผ่านครบทุกข้อ')+'</p><p>หมายเหตุ: '+esc(p.note||'—')+'</p></div>').join('');
      $('saveReports').textContent='บันทึกทั้งชุด '+items.length+' เครื่อง';$('saveReports').disabled=false;$('reviewPanel').hidden=false;
      $('reviewPanel').scrollIntoView({behavior:'smooth',block:'start'});
    }finally{$('reviewBtn').disabled=false;}
  }
  async function save(){
    if(busy||(!reviewed&&!pending))return;
    if(!pending&&!$('confirmed').checked)throw new Error('กรุณายืนยันผลตรวจจริงก่อนบันทึก');
    if(!pending)pending={id:requestId(),items:JSON.parse(JSON.stringify(reviewed))};
    busy=true;lock(true);$('saveReports').disabled=true;notice('กำลังบันทึกทั้งชุด…');
    try{
      const {data,error}=await supabase.rpc('save_mems_report_batch',{request_id:pending.id,batch_payload:pending.items});
      if(error)throw error;
      if(!Array.isArray(data)||data.length!==pending.items.length||data.some((r,i)=>r.id!==pending.items[i].id||r.batch_id!==pending.id))throw new Error('ยังยืนยันผลบันทึกไม่ได้');
      savedRows=data;pending=null;reviewed=null;$('reviewPanel').hidden=true;$('savedPanel').hidden=false;
      $('savedSummary').textContent='บันทึกครบ '+data.length+' เครื่อง · สร้าง PDF หรือพิมพ์ได้ทันที';
      notice('บันทึกชุดงานสำเร็จครบ '+data.length+' เครื่อง');
      $('newTab').disabled=false;$('historyTab').disabled=false;$('savedPanel').scrollIntoView({behavior:'smooth',block:'center'});
    }catch(error){
      // SQL errors confirm rollback. Network/ambiguous errors keep the original request frozen for a safe retry.
      if(/^[0-9A-Z]{5}$/.test(error.code||'')&&!pending.uncertain){pending=null;lock(false);}
      else pending.uncertain=true;
      $('saveReports').disabled=false;$('saveReports').textContent='ลองบันทึกชุดเดิมอีกครั้ง';
      notice((error.message||'เครือข่ายขัดข้อง')+(pending?' · ข้อมูลถูกล็อกไว้ กดลองบันทึกชุดเดิมเพื่อยืนยันผลโดยไม่สร้างรายการซ้ำ':' · ยังไม่บันทึกทั้งชุด กรุณาแก้ข้อมูลแล้วตรวจทานอีกครั้ง'),true);
    }finally{busy=false;}
  }
  function startNew(){pending=null;reviewed=null;savedRows=[];rows=[newMachine()];lock(false);$('savedPanel').hidden=true;invalidate();renderMachines();$('newTab').disabled=false;$('historyTab').disabled=false;if(!$('pmWorkspace').hidden)notice('พร้อมสร้างชุดงานใหม่ · เพิ่มเครื่องและกรอกผลตรวจรายเครื่อง');}
  async function pdf(reports,button){
    if(!reports.length)throw new Error('เลือกรายงานก่อน');
    if(button)button.disabled=true;
    try{await memsExportInspectionPdf(reports);}finally{if(button)button.disabled=false;}
  }
  async function history(){
    $('historyList').textContent='กำลังโหลดประวัติ…';$('selectedPdf').disabled=true;
    let q=supabase.from('mems_reports').select('*').order('created_at',{ascending:false}).order('id').range(page*20,page*20+20);
    for(const [id,column] of [['filterKind','kind'],['filterNo','snapshot->>no'],['filterSerial','snapshot->>serial_number'],['filterType','snapshot->>equipment_type']]){
      let value=$(id).value.trim();if(value)q=q.eq(column,id==='filterNo'?String(Number(value)):value);
    }
    if($('filterFrom').value)q=q.gte('report_date',$('filterFrom').value);
    if($('filterTo').value)q=q.lte('report_date',$('filterTo').value);
    const {data,error}=await q;if(error){$('historyList').textContent='โหลดประวัติไม่สำเร็จ กรุณากดรีเฟรช';throw error;}
    historyRows=data.slice(0,20);$('prevPage').disabled=page===0;$('nextPage').disabled=data.length<=20;$('pageLabel').textContent='หน้า '+(page+1);
    $('historyList').innerHTML=historyRows.map((r,i)=>{const s=r.snapshot,p=r.payload;return `<article class="history-item"><h3><label class="pm-check"><input type="checkbox" data-select="${i}">${esc((r.kind==='pm'?'PM':'ตรวจรับ')+' · '+s.equipment_type+' '+(s.no?'No.'+s.no:'S/N '+(s.serial_number||'—')))}</label></h3><p class="muted">${esc(r.report_date+' · '+p.operator+' · '+p.section)}<br>${esc(s.serial_number?'S/N '+s.serial_number:'')} · ${r.batch_id?'ชุดงาน '+esc(r.batch_id.slice(0,8)):'ประวัติเดิม'}</p><details><summary>ผลตรวจและหมายเหตุ</summary>${fields(r.kind).map(f=>'<div>'+esc(f)+' — '+esc(p.results?.[f]||'—')+'</div>').join('')}<p class="pm-note">หมายเหตุ: ${esc(p.note||'—')}</p></details><div class="history-actions"><button type="button" data-pdf="${i}">PDF / พิมพ์เครื่องนี้</button>${r.batch_id?'<button type="button" data-batch="'+esc(r.batch_id)+'">PDF / พิมพ์ทั้งชุด</button>':''}${r.slides_id?'<a target="_blank" rel="noopener" href="https://docs.google.com/presentation/d/'+encodeURIComponent(r.slides_id)+'/edit">Slides เดิม ↗</a>':''}${r.pdf_id?'<a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+encodeURIComponent(r.pdf_id)+'/view">PDF เดิม ↗</a>':''}</div></article>`;}).join('')||'<p class="empty">ไม่พบรายงานในช่วงที่เลือก</p>';
  }
  function tabs(isHistory){$('newPanel').hidden=isHistory;$('historyPanel').hidden=!isHistory;$('newTab').setAttribute('aria-pressed',String(!isHistory));$('historyTab').setAttribute('aria-pressed',String(isHistory));}
  window.addEventListener('DOMContentLoaded',guard(async()=>{
    profile=await memsGuard('pm_reports');if(!profile)return;
    $('reportDate').value=today();$('operator').value=profile.display_name||profile.username||'';
    const enabled=await loadSettings();await loadAssets();startNew();if(enabled)notice('พร้อมใช้งาน · บันทึกชุดงานและสร้าง PDF ใน MEMs ได้ทันที');
    if(typeof WARDS!=='undefined')$('pmWards').innerHTML=WARDS.map(w=>'<option value="'+esc(w)+'"></option>').join('');
    $('saveSettings').onclick=guard(async()=>{const {error}=await supabase.from('mems_report_settings').update({enabled:$('pmEnabled').checked,updated_by:profile.id,updated_at:new Date().toISOString()}).eq('id',true);if(error)throw error;await loadSettings();});
    $('pmForm').addEventListener('submit',guard(review));
    $('pmForm').addEventListener('input',event=>{if(pending)return;invalidate();const target=event.target;if(target.dataset.row!==undefined){const i=Number(target.dataset.row);if(target.dataset.key)rows[i][target.dataset.key]=target.value;else if(target.dataset.check!==undefined)rows[i].results[fields($('reportKind').value)[Number(target.dataset.check)]]=target.value;updateMachine(i);summary();}});
    $('reportKind').addEventListener('change',()=>{rows.forEach(r=>{r.results={};});invalidate();renderMachines();});
    $('machineList').addEventListener('click',event=>{
      const copy=event.target.closest('[data-copy-details]');
      if(copy&&!pending&&!busy){const index=Number(copy.dataset.copyDetails),source=rows[index];
        for(const target of rows)if(target!==source&&MemsPM.typeKey(target.equipment_type)===MemsPM.typeKey(source.equipment_type))for(const key of ['tool_type','brand','model','section'])target[key]=source[key];
        invalidate();renderMachines(index);notice('ใช้ยี่ห้อ รุ่น ชนิดเครื่อง และหน่วยงานกับเครื่องประเภทเดียวกันแล้ว · ผลตรวจ หมายเหตุ และ S/N ยังคงแยกรายเครื่อง');return;
      }
      const b=event.target.closest('[data-remove]');if(!b||pending||busy)return;rows.splice(Number(b.dataset.remove),1);invalidate();renderMachines();});
    $('addMachine').onclick=()=>{if(rows.length>=50)return;rows.push(newMachine());invalidate();renderMachines();};
    $('bulkAdd').onclick=()=>$('bulkModal').showModal();$('closeBulk').onclick=()=>$('bulkModal').close();
    $('bulkForm').onsubmit=guard(event=>{event.preventDefault();const mode=$('bulkMode').value,type=$('bulkType').value.trim();const ids=mode==='no'?MemsPM.parseNumbers($('bulkValues').value).map(String):$('bulkValues').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!type||!ids.length)throw new Error('กรอกประเภทและหมายเลขเครื่อง');if(rows.length===1&&!rows[0].equipment_type&&!rows[0].identifier&&!rows[0].note&&!rows[0].brand&&!Object.keys(rows[0].results).length)rows=[];if(rows.length+ids.length>50)throw new Error('รวมทั้งชุดได้ไม่เกิน 50 เครื่อง');rows.push(...ids.map(id=>newMachine(type,mode,id)));invalidate();renderMachines();$('bulkModal').close();$('bulkValues').value='';});
    $('saveReports').onclick=guard(save);$('startNew').onclick=startNew;$('savedPdf').onclick=guard(()=>pdf(savedRows,$('savedPdf')));
    $('newTab').onclick=()=>tabs(false);$('historyTab').onclick=guard(async()=>{tabs(true);page=0;await history();});
    $('historyFilters').onsubmit=guard(async event=>{event.preventDefault();page=0;await history();});$('refreshHistory').onclick=guard(history);
    $('prevPage').onclick=guard(async()=>{if(page)page--;await history();});$('nextPage').onclick=guard(async()=>{page++;await history();});
    $('historyList').addEventListener('change',()=>{$('selectedPdf').disabled=!document.querySelector('[data-select]:checked');});
    $('selectedPdf').onclick=guard(()=>pdf([...document.querySelectorAll('[data-select]:checked')].map(input=>historyRows[Number(input.dataset.select)]),$('selectedPdf')));
    $('historyList').onclick=guard(async event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.pdf!==undefined)return pdf([historyRows[Number(button.dataset.pdf)]],button);if(button.dataset.batch){const reports=await fetchAllPages(()=>supabase.from('mems_reports').select('*').eq('batch_id',button.dataset.batch).order('batch_index'));await pdf(reports,button);}});
  }));
})();
