/* Native MEMs inspections: atomic batches and printable PDFs, without a Google bridge. */
(() => {
  'use strict';
  const {fields,today,esc,requestId,resolveInspectionMachine,machineKey,validateInspection}=MemsPM;
  const $=id=>document.getElementById(id);
  let copyResultsSource=null,brandModels=[],brandModelTarget=null,wards=[],toolTypes=[],toolTypeTarget=null,operators=[],assets=[],profile,rows=[],page=0,historyRows=[],savedRows=[],reviewed=null,pending=null,busy=false;
  const notice=(text,error=false)=>{$('pmNotice').textContent=text;$('pmNotice').className='notice'+(error?' error':'');};
  const guard=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message||String(error),true);}};
  function invalidate(){reviewed=null;$('reviewPanel').hidden=true;$('confirmed').checked=false;}
  function newMachine(type='',mode='no',identifier='') {
    return {equipment_type:type,identity_mode:mode,identifier,brand:'',model:'',tool_type:'',section:'',note:'',replacement:'',results:{}};
  }
  async function loadOperators(selectedId='') {
    operators=await fetchAllPages(()=>supabase.from('mems_report_operators').select('id,name,position').order('name').order('id'));
    $('savedOperator').innerHTML='<option value="">— เพิ่มชื่อใหม่ หรือกรอกชื่อด้านล่าง —</option>'+operators.map(person=>'<option value="'+esc(person.id)+'">'+esc(person.name+' — '+person.position)+'</option>').join('');
    $('savedOperator').value=selectedId;
  }
  async function saveOperator() {
    const name=$('operator').value.trim(),position=$('operatorPosition').value.trim();
    if(!name||!position)throw new Error('กรอกชื่อผู้ปฏิบัติงานและตำแหน่งก่อนบันทึกรายชื่อ');
    $('saveOperator').disabled=true;
    try {
      const {data,error}=await supabase.rpc('save_mems_report_operator',{operator_name:name,operator_position:position});
      if(error)throw error;
      await loadOperators(data.id);
      $('operatorStatus').textContent='บันทึก '+name+' · '+position+' แล้ว เลือกใช้ครั้งต่อไปได้';
    } finally { $('saveOperator').disabled=false; }
  }
  async function loadBrandModels(){
    brandModels=await fetchAllPages(()=>supabase.from('mems_report_brand_models').select('id,brand,model').order('brand').order('model').order('id'));
    $('pmSavedBrands').innerHTML=[...new Set(brandModels.map(item=>item.brand))].map(brand=>'<option value="'+esc(brand)+'"></option>').join('');
  }
  function brandModelFields(row,i){
    const brands=[...new Set(brandModels.map(item=>item.brand))];if(row.brand&&!brands.includes(row.brand))brands.push(row.brand);
    const models=[...new Set(brandModels.filter(item=>item.brand.toLowerCase()===row.brand.toLowerCase()).map(item=>item.model).filter(Boolean))];if(row.model&&!models.includes(row.model))models.push(row.model);
    const options=(values,current)=>values.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value)}</option>`).join('');
    return `<label>ยี่ห้อ<select data-row="${i}" data-key="brand"><option value="">— เลือกยี่ห้อ —</option>${options(brands,row.brand)}</select><button type="button" data-add-brand-model="${i}" data-catalog-mode="brand">＋ เพิ่มยี่ห้อไว้ใช้ครั้งต่อไป</button></label><label>รุ่น<select data-row="${i}" data-key="model"><option value="">${row.brand?'— เลือกรุ่น —':'— เลือกยี่ห้อก่อน —'}</option>${options(models,row.model)}</select><button type="button" data-add-brand-model="${i}" data-catalog-mode="model">＋ เพิ่มรุ่นของยี่ห้อนี้</button></label>`;
  }
  async function loadToolTypes(){
    toolTypes=await fetchAllPages(()=>supabase.from('mems_report_tool_types').select('id,name,source').order('name').order('id'));
  }
  const registryTypes=()=>[...new Set(assets.map(a=>a.type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
  const manualMachine=row=>row.registry_manual||Boolean(row.equipment_type&&!registryTypes().includes(row.equipment_type));
  function machineNameField(row,i){
    const manual=manualMachine(row);
    return `<label>ชื่อเครื่องจากทะเบียน MEMs<select data-row="${i}" data-key="equipment_type" data-registry="true"><option value="">— เลือกชื่อเครื่อง —</option>${registryTypes().map(type=>`<option value="${esc(type)}" ${!manual&&row.equipment_type===type?'selected':''}>${esc(type)}</option>`).join('')}<option value="__manual__" ${manual?'selected':''}>＋ เครื่องใหม่ที่ยังไม่มีในทะเบียน</option></select></label>${manual?input(row,i,'equipment_type','ชื่อเครื่องใหม่'):''}`;
  }
  function identityField(row,i){
    if(manualMachine(row)||row.manual_identifier)return input(row,i,'identifier',row.identity_mode==='no'?'No. เครื่อง':'S/N');
    const values=[...new Set(assets.filter(a=>a.type===row.equipment_type).map(a=>row.identity_mode==='no'?(a.no==null?'':String(a.no)):String(a.serial_number||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th',{numeric:true}));
    if(row.identifier&&!values.includes(row.identifier))values.push(row.identifier);
    return `<label>${row.identity_mode==='no'?'No. เครื่องจากทะเบียน':'S/N จากทะเบียน'}<select data-row="${i}" data-key="identifier"><option value="">— เลือก ${row.identity_mode==='no'?'No.':'S/N'} —</option>${values.map(value=>`<option value="${esc(value)}" ${row.identifier===value?'selected':''}>${esc(value)}</option>`).join('')}<option value="__manual__">＋ กรอกหมายเลขที่ยังไม่มีในทะเบียน</option></select></label>`;
  }
  function toolTypeField(row,i){
    const names=toolTypes.map(t=>t.name);if(row.tool_type&&!names.includes(row.tool_type))names.push(row.tool_type);
    return `<label>ประเภทเครื่องบนรายงาน<select data-row="${i}" data-key="tool_type"><option value="">— เลือกประเภทเครื่อง —</option>${names.map(name=>`<option value="${esc(name)}" ${row.tool_type===name?'selected':''}>${esc(name)}</option>`).join('')}</select><button type="button" data-add-tool-type="${i}">＋ เพิ่มประเภทไว้เลือกครั้งต่อไป</button></label>`;
  }
  async function loadSettings(){
    const {data,error}=await supabase.from('mems_report_settings').select('enabled').eq('id',true).single();
    if(error)throw error;
    $('pmEnabled').checked=data.enabled;$('pmAdmin').hidden=profile.role!=='admin';$('pmWorkspace').hidden=!data.enabled;
    if(!data.enabled)notice('ฟังก์ชันยังปิดอยู่ แอดมินเปิดใช้งานได้จากการตั้งค่า');
    return data.enabled;
  }
  async function loadWards(){
    let saved=[];
    try { saved=await fetchPreparationWards();$('wardStatus').textContent='รายชื่อเดียวกับหน้าเตรียมเครื่อง รวมหน่วยงานที่เคยบันทึกในระบบ'; }
    catch(error){$('wardStatus').textContent='โหลดหน่วยงานเพิ่มเติมไม่สำเร็จ ใช้รายชื่อหลักของ MEMs ได้';console.warn(error);}
    wards=[...new Set(['ศูนย์เครื่องมือแพทย์',...MEMS_WARDS,...saved].map(name=>String(name).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
    const current=$('section').value||'ศูนย์เครื่องมือแพทย์';
    $('section').innerHTML=wards.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');$('section').value=wards.includes(current)?current:'ศูนย์เครื่องมือแพทย์';
  }
  function wardField(row,i){
    return `<label>หน่วยงานของเครื่อง<select data-row="${i}" data-key="section"><option value="">ใช้หน่วยงานเริ่มต้นของชุดงาน</option>${wards.map(name=>`<option value="${esc(name)}" ${row.section===name?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
  }
  async function loadAssets(){
    assets=await fetchAllPages(()=>supabase.from('assets').select('id,type,no,asset_code,asset_id,serial_number').order('id'));
    const oldBulkType=$('bulkType').value;
    $('bulkType').innerHTML='<option value="">— เลือกชื่อเครื่อง —</option>'+registryTypes().map(type=>'<option value="'+esc(type)+'">'+esc(type)+'</option>').join('')+'<option value="__manual__">＋ เครื่องใหม่ที่ยังไม่มีในทะเบียน</option>';
    $('bulkType').value=registryTypes().includes(oldBulkType)||oldBulkType==='__manual__'?oldBulkType:'';
    $('pmTypes').innerHTML=[...new Set(assets.map(a=>a.type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')).map(type=>'<option value="'+esc(type)+'"></option>').join('');
  }
  const input=(row,index,key,label,extra='')=>`<label>${label}<input data-row="${index}" data-key="${key}" value="${esc(row[key])}" maxlength="${key==='note'||key==='replacement'?2000:200}" ${extra}></label>`;
  function renderMachines(openIndex=rows.length-1){
    $('machineList').innerHTML=rows.map((row,i)=>`<details class="pm-machine" ${i===openIndex?'open':''}><summary id="machineTitle${i}"></summary><div class="pm-machine-content"><div class="form-grid">
      ${machineNameField(row,i)}
      <label>ระบุเครื่องด้วย<select data-row="${i}" data-key="identity_mode"><option value="no" ${row.identity_mode==='no'?'selected':''}>No. เครื่อง</option><option value="serial" ${row.identity_mode==='serial'?'selected':''}>S/N</option></select></label>
      ${identityField(row,i)}${toolTypeField(row,i)}${brandModelFields(row,i)}${wardField(row,i)}
      </div><div class="pm-status" id="machineStatus${i}"></div><div class="result-grid">${fields($('reportKind').value).map((field,j)=>`<label class="result-row"><span>${esc(field)}</span><select data-row="${i}" data-check="${j}" aria-label="เครื่องที่ ${i+1} ${esc(field)}"><option value="">เลือกผล</option>${['ผ่าน','ไม่ผ่าน','N/A'].map(value=>`<option ${row.results[field]===value?'selected':''}>${value}</option>`).join('')}</select></label>`).join('')}</div>
      <button type="button" class="pm-copy-results" data-copy-results="${i}" ${rows.length<2?'disabled':''}>คัดลอกผลตรวจเครื่องนี้ไปทุกเครื่อง</button>
      ${$('reportKind').value==='pm'?input(row,i,'replacement','เปลี่ยนวัสดุตามอายุงาน (ถ้ามี)'):''}
      <label>หมายเหตุเฉพาะเครื่องนี้<textarea data-row="${i}" data-key="note" rows="3" maxlength="2000" placeholder="ระบุรายละเอียดกรณีไม่ผ่าน หรือหมายเหตุเพิ่มเติม (N/A ไม่ต้องใส่เหตุผล)">${esc(row.note)}</textarea></label>
      <button type="button" data-copy-details="${i}">ใช้รายละเอียดนี้กับเครื่องประเภทเดียวกัน</button>
      <button type="button" class="pm-remove" data-remove="${i}">ลบเครื่องนี้จากชุดงาน</button></div></details>`).join('');
    rows.forEach((_,i)=>updateMachine(i));summary();
  }
  const centerSection='ศูนย์เครื่องมือแพทย์';
  const canRegisterAssets=()=>profile?.role==='admin'||(profile?.permissions||[]).includes('assets');
  const isCenterAcceptance=row=>$('reportKind').value==='acceptance'&&(row.section.trim()||$('section').value.trim())===centerSection;
  function updateMachine(i){
    const row=rows[i];$('machineTitle'+i).textContent=String(i+1).padStart(2,'0')+' · '+(row.equipment_type||'เลือกประเภทเครื่อง')+' · '+(row.identity_mode==='no'?'No.':'S/N ')+(row.identifier||'ยังไม่ระบุ');
    const status=$('machineStatus'+i);
    if(!row.identifier||!row.equipment_type){status.textContent='เลือกประเภทและกรอก No. หรือ S/N เพื่อค้นทะเบียน';return;}
    try{
      const a=resolveInspectionMachine(assets,row,$('reportKind').value);
      status.textContent=a?'เชื่อมทะเบียน: '+a.type+' '+(a.no?'No.'+a.no:'')+' · ID '+(a.asset_id||'—')+' · เลขครุภัณฑ์ '+(a.asset_code||'—')+(a.serial_number?' · S/N '+a.serial_number:''):'ยังไม่พบในทะเบียน · กรอกรายละเอียดเพื่อบันทึกรายงานได้โดยไม่สร้างทะเบียนอัตโนมัติ';
      status.className=a&&$('reportKind').value==='acceptance'?'pm-status pm-duplicate':'pm-status';
      if(a&&$('reportKind').value==='acceptance')status.textContent='ซ้ำกับเครื่องที่ลงทะเบียนไว้: '+a.type+(a.no?' No.'+a.no:'')+(a.serial_number?' · S/N '+a.serial_number:'')+' · เลือกเก็บข้อมูลตรวจรับโดยไม่เพิ่มทะเบียนซ้ำได้ในขั้นตรวจทาน';
      if(!a&&isCenterAcceptance(row))status.textContent=canRegisterAssets()?'เมื่อบันทึกตรวจรับ จะเพิ่มเครื่องนี้ในจัดการเครื่องมือพร้อมกัน · S/N อย่างเดียวจะรอระบุ No. · ผลไม่ผ่านจะเป็นสถานะยังไม่พร้อมใช้งาน':'ยังไม่พบในทะเบียน · บันทึกรายงานได้ แต่การเพิ่มทะเบียนต้องมีสิทธิ์จัดการเครื่องมือ';
    }catch(error){status.textContent=error.message;status.className='pm-status error-text';}
  }
  function summary(){
    $('machineCount').textContent=rows.length+' เครื่อง';
    $('batchSummary').innerHTML=[['เครื่องทั้งหมด',rows.length],['ระบุด้วย No.',rows.filter(r=>r.identity_mode==='no').length],['ระบุด้วย S/N',rows.filter(r=>r.identity_mode==='serial').length]].map(([label,n])=>'<div class="pm-summary-row"><span>'+label+'</span><strong>'+n+'</strong></div>').join('');
    $('addMachine').disabled=rows.length>=50;$('bulkAdd').disabled=rows.length>=50;
  }
  function lock(locked){$('pmForm').inert=locked;$('confirmed').disabled=locked;$('newTab').disabled=locked;$('historyTab').disabled=locked;}
  function makePayload(row){
    const asset=resolveInspectionMachine(assets,row,$('reportKind').value);
    const payload={form_version:2,register_asset:!asset&&isCenterAcceptance(row)&&canRegisterAssets(),kind:$('reportKind').value,date:$('reportDate').value,operator:$('operator').value.trim(),operator_position:$('operatorPosition').value.trim(),section:row.section.trim()||$('section').value.trim(),
      equipment_type:asset&&$('reportKind').value==='acceptance'?asset.type:row.equipment_type.trim(),requested_equipment_type:row.equipment_type.trim(),duplicate_policy:$('reportKind').value==='acceptance'?'confirm_existing':null,existing_asset_id:asset?String(asset.id):null,identity_mode:row.identity_mode,no:row.identity_mode==='no'?String(Number(row.identifier)):null,
      serial_number:row.identity_mode==='serial'?row.identifier.trim():(asset?.serial_number||''),
      tool_type:row.tool_type.trim(),brand:row.brand.trim(),model:row.model.trim(),note:row.note.trim(),replacement:row.replacement.trim(),results:row.results,confirmed:true};
    validateInspection(payload);
    return {payload,asset,key:machineKey(row,asset)};
  }
  function confirmExistingAcceptance(duplicates){
    return new Promise(resolve=>{
      const dialog=$('duplicateAssetModal');
      $('duplicateAssetList').textContent=duplicates.map(({index,asset})=>'เครื่องที่ '+(index+1)+': '+asset.type+(asset.no?' No.'+asset.no:'')+(asset.serial_number?' · S/N '+asset.serial_number:'')).join('\n');
      const finish=accepted=>{dialog.close();dialog.oncancel=null;resolve(accepted);};
      $('cancelDuplicateAsset').onclick=()=>finish(false);
      $('recordExistingAsset').onclick=()=>finish(true);
      dialog.oncancel=event=>{event.preventDefault();finish(false);};
      dialog.showModal();
    });
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
      const seen=new Set(),items=[],duplicates=[];
      for(let i=0;i<rows.length;i++){
        try{const item=makePayload(rows[i]);if(seen.has(item.key))throw new Error('เครื่องซ้ำในชุดงาน');seen.add(item.key);items.push({id:requestId(),payload:item.payload});if(item.asset&&item.payload.kind==='acceptance')duplicates.push({index:i,asset:item.asset});}
        catch(error){$('machineList').children[i].open=true;$('machineList').children[i].scrollIntoView({behavior:'smooth',block:'center'});throw new Error('เครื่องที่ '+(i+1)+': '+error.message);}
      }
      if(duplicates.length){if(!await confirmExistingAcceptance(duplicates))return;for(const duplicate of duplicates){items[duplicate.index].payload.register_asset=false;items[duplicate.index].payload.existing_registration_confirmed=true;}}
      reviewed=items;notice('ตรวจข้อมูลครบแล้ว กรุณาตรวจทานและยืนยันผลจริงก่อนบันทึก');
      $('reviewSummary').innerHTML='<h2>ตรวจทาน '+items.length+' เครื่องก่อนบันทึก</h2>'+items.map(({payload:p},i)=>'<div class="pm-review-row"><strong>'+esc((i+1)+'. '+p.equipment_type+' '+(p.identity_mode==='no'?'No.'+p.no:'S/N '+p.serial_number))+'</strong>'+esc(p.brand+' · '+p.model+' · '+p.section)+'<p>'+esc(fields(p.kind).filter(f=>p.results[f]!=='ผ่าน').map(f=>f+': '+p.results[f]).join('\n')||'ผลตรวจผ่านครบทุกข้อ')+'</p>'+(p.register_asset?'<p>จะเพิ่มทะเบียนเครื่องมือพร้อมบันทึกตรวจรับ</p>':p.existing_registration_confirmed?'<p>เก็บข้อมูลตรวจรับเพิ่มเติม เชื่อมทะเบียนเดิม ไม่เพิ่มเครื่องซ้ำ</p>':'')+'<p>ผู้ตรวจ: '+esc(p.operator+(p.operator_position?' · '+p.operator_position:''))+'</p><p>หมายเหตุ: '+esc(p.note||'—')+'</p></div>').join('');
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
      $('savedSummary').textContent='บันทึกครบ '+data.length+' เครื่อง'+(data.some(r=>r.snapshot.asset_registered)?' · เพิ่มทะเบียนใหม่ '+data.filter(r=>r.snapshot.asset_registered).length+' เครื่อง':'')+' · สร้าง PDF หรือพิมพ์ได้ทันที';
      await loadAssets().catch(error=>console.warn('บันทึกแล้ว แต่โหลดทะเบียนล่าสุดไม่ได้',error));
      notice('บันทึกชุดงานสำเร็จครบ '+data.length+' เครื่อง');
      $('newTab').disabled=false;$('historyTab').disabled=false;$('savedPanel').scrollIntoView({behavior:'smooth',block:'center'});
    }catch(error){
      // SQL errors confirm rollback. Network/ambiguous errors keep the original request frozen for a safe retry.
      const registryConflict=error.code==='P0001'&&/พบเครื่องในทะเบียนแล้ว|ทะเบียนเครื่องที่ยืนยัน/.test(error.message||'');
      if(/^[0-9A-Z]{5}$/.test(error.code||'')&&(!pending.uncertain||registryConflict)){pending=null;lock(false);if(registryConflict)invalidate();}
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
    $('historyList').innerHTML=historyRows.map((r,i)=>{const s=r.snapshot,p=r.payload;return `<article class="history-item"><h3><label class="pm-check"><input type="checkbox" data-select="${i}">${esc((r.kind==='pm'?'PM':'ตรวจรับ')+' · '+s.equipment_type+' '+(s.no?'No.'+s.no:'S/N '+(s.serial_number||'—')))}</label></h3><p class="muted">${esc(r.report_date+' · '+p.operator+(p.operator_position?' · '+p.operator_position:'')+' · '+p.section)}<br>${esc(s.serial_number?'S/N '+s.serial_number:'')} · ${r.batch_id?'ชุดงาน '+esc(r.batch_id.slice(0,8)):'ประวัติเดิม'}</p><details><summary>ผลตรวจและหมายเหตุ</summary>${fields(r.kind).map(f=>'<div>'+esc(f)+' — '+esc(p.results?.[f]||'—')+'</div>').join('')}<p class="pm-note">หมายเหตุ: ${esc(p.note||'—')}</p></details><div class="history-actions"><button type="button" data-pdf="${i}">PDF / พิมพ์เครื่องนี้</button>${r.batch_id?'<button type="button" data-batch="'+esc(r.batch_id)+'">PDF / พิมพ์ทั้งชุด</button>':''}${r.slides_id?'<a target="_blank" rel="noopener" href="https://docs.google.com/presentation/d/'+encodeURIComponent(r.slides_id)+'/edit">Slides เดิม ↗</a>':''}${r.pdf_id?'<a target="_blank" rel="noopener" href="https://drive.google.com/file/d/'+encodeURIComponent(r.pdf_id)+'/view">PDF เดิม ↗</a>':''}</div></article>`;}).join('')||'<p class="empty">ไม่พบรายงานในช่วงที่เลือก</p>';
  }
  function tabs(isHistory){$('newPanel').hidden=isHistory;$('historyPanel').hidden=!isHistory;$('newTab').setAttribute('aria-pressed',String(!isHistory));$('historyTab').setAttribute('aria-pressed',String(isHistory));}
  window.addEventListener('DOMContentLoaded',guard(async()=>{
    profile=await memsGuard('pm_reports');if(!profile)return;
    $('reportDate').value=today();$('operator').value=profile.display_name||profile.username||'';
    const enabled=await loadSettings();await loadAssets();if(enabled){await loadOperators();await loadToolTypes();await loadBrandModels();}await loadWards();startNew();if(enabled)notice('พร้อมใช้งาน · บันทึกชุดงานและสร้าง PDF ใน MEMs ได้ทันที');
    $('saveSettings').onclick=guard(async()=>{const {error}=await supabase.from('mems_report_settings').update({enabled:$('pmEnabled').checked,updated_by:profile.id,updated_at:new Date().toISOString()}).eq('id',true);if(error)throw error;if(await loadSettings()){await loadOperators();await loadToolTypes();await loadBrandModels();renderMachines();}});
    $('savedOperator').onchange=()=>{const selected=operators.find(p=>p.id===$('savedOperator').value);if(selected){$('operator').value=selected.name;$('operatorPosition').value=selected.position;}else{$('operator').value='';$('operatorPosition').value='';}invalidate();};
    $('saveOperator').onclick=guard(saveOperator);
    $('operator').addEventListener('input',()=>{$('savedOperator').value='';});
    $('operatorPosition').addEventListener('input',()=>{$('savedOperator').value='';});
    $('pmForm').addEventListener('submit',guard(review));
    $('pmForm').addEventListener('input',event=>{if(pending)return;invalidate();const target=event.target;if(target.id==='section'){rows.forEach((_,i)=>updateMachine(i));}
      if(target.dataset.row!==undefined){const i=Number(target.dataset.row);if(target.dataset.registry){rows[i].registry_manual=target.value==='__manual__';rows[i].equipment_type=rows[i].registry_manual?'':target.value;rows[i].identifier='';rows[i].manual_identifier=false;renderMachines(i);return;}
      if(target.dataset.key==='brand'){rows[i].brand=target.value;rows[i].model='';renderMachines(i);return;}
      if(target.dataset.key==='identity_mode'){rows[i].identity_mode=target.value;rows[i].identifier='';rows[i].manual_identifier=false;renderMachines(i);return;}
      if(target.dataset.key==='identifier'&&target.tagName==='SELECT'&&target.value==='__manual__'){rows[i].identifier='';rows[i].manual_identifier=true;renderMachines(i);return;}
      if(target.dataset.key)rows[i][target.dataset.key]=target.value;else if(target.dataset.check!==undefined)rows[i].results[fields($('reportKind').value)[Number(target.dataset.check)]]=target.value;updateMachine(i);summary();}});
    $('reportKind').addEventListener('change',()=>{rows.forEach(r=>{r.results={};});invalidate();renderMachines();});
    $('machineList').addEventListener('click',event=>{
      const copyResults=event.target.closest('[data-copy-results]');
      if(copyResults&&!pending&&!busy){
        const index=Number(copyResults.dataset.copyResults),source=rows[index];
        if(rows.length<2)return;
        try{MemsPM.inspectionResults(source.results,$('reportKind').value);}catch(error){notice(error.message,true);return;}
        copyResultsSource=index;
        $('copyResultsMessage').textContent='คัดลอกผลตรวจ '+fields($('reportKind').value).length+' ข้อจาก '+source.equipment_type+' '+(source.identity_mode==='no'?'No.':'S/N ')+source.identifier+' ไปยังอีก '+(rows.length-1)+' เครื่องที่เพิ่มไว้ตอนนี้ โดยแทนที่ผลตรวจเดิมของเครื่องเหล่านั้น';
        $('copyResultsModal').showModal();return;
      }
      const addBrand=event.target.closest('[data-add-brand-model]');
      if(addBrand&&!pending&&!busy){const index=Number(addBrand.dataset.addBrandModel);brandModelTarget=index;$('brandModelBrand').value=addBrand.dataset.catalogMode==='model'?rows[index].brand:'';$('brandModelModel').value='';$('brandModelModel').required=addBrand.dataset.catalogMode==='model';$('brandModelModal').showModal();return;}
      const addType=event.target.closest('[data-add-tool-type]');
      if(addType&&!pending&&!busy){toolTypeTarget=Number(addType.dataset.addToolType);$('toolTypeName').value='';$('toolTypeModal').showModal();return;}
      const copy=event.target.closest('[data-copy-details]');
      if(copy&&!pending&&!busy){const index=Number(copy.dataset.copyDetails),source=rows[index];
        for(const target of rows)if(target!==source&&MemsPM.typeKey(target.equipment_type)===MemsPM.typeKey(source.equipment_type))for(const key of ['tool_type','brand','model','section'])target[key]=source[key];
        invalidate();renderMachines(index);notice('ใช้ยี่ห้อ รุ่น ชนิดเครื่อง และหน่วยงานกับเครื่องประเภทเดียวกันแล้ว · ผลตรวจ หมายเหตุ และ S/N ยังคงแยกรายเครื่อง');return;
      }
      const b=event.target.closest('[data-remove]');if(!b||pending||busy)return;rows.splice(Number(b.dataset.remove),1);invalidate();renderMachines();});
    $('addMachine').onclick=()=>{if(rows.length>=50)return;rows.push(newMachine());invalidate();renderMachines();};
    $('bulkType').onchange=()=>{$('bulkNewTypeLabel').hidden=$('bulkType').value!=='__manual__';};
    $('bulkAdd').onclick=()=>$('bulkModal').showModal();$('closeBulk').onclick=()=>$('bulkModal').close();
    $('bulkForm').onsubmit=guard(event=>{event.preventDefault();const mode=$('bulkMode').value,type=($('bulkType').value==='__manual__'?$('bulkNewType').value:$('bulkType').value).trim();const ids=mode==='no'?MemsPM.parseNumbers($('bulkValues').value).map(String):$('bulkValues').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!type||!ids.length)throw new Error('กรอกประเภทและหมายเลขเครื่อง');if(rows.length===1&&!rows[0].equipment_type&&!rows[0].identifier&&!rows[0].note&&!rows[0].brand&&!Object.keys(rows[0].results).length)rows=[];if(rows.length+ids.length>50)throw new Error('รวมทั้งชุดได้ไม่เกิน 50 เครื่อง');rows.push(...ids.map(id=>newMachine(type,mode,id)));invalidate();renderMachines();$('bulkModal').close();$('bulkValues').value='';});
    $('cancelCopyResults').onclick=()=>$('copyResultsModal').close();
    $('applyCopyResults').onclick=guard(()=>{
      if(pending||busy||copyResultsSource===null)return;
      const index=copyResultsSource,source=rows[index];
      const results=MemsPM.inspectionResults(source.results,$('reportKind').value);
      for(const target of rows)if(target!==source)target.results={...results};
      $('copyResultsModal').close();copyResultsSource=null;invalidate();renderMachines(index);
      $('machineList').querySelector('[data-copy-results="'+index+'"]').focus();
      notice('คัดลอกผลตรวจไปอีก '+(rows.length-1)+' เครื่องแล้ว · ตรวจผลจริงของทุกเครื่องก่อนยืนยันบันทึก · หมายเหตุและวัสดุที่เปลี่ยนยังแยกรายเครื่อง');
    });
    $('closeBrandModel').onclick=()=>$('brandModelModal').close();
    $('brandModelForm').onsubmit=guard(async event=>{event.preventDefault();const brand=$('brandModelBrand').value.trim(),model=$('brandModelModel').value.trim();if(!brand)throw new Error('กรอกยี่ห้อก่อนบันทึก');$('saveBrandModel').disabled=true;try{const {data,error}=await supabase.rpc('save_mems_report_brand_model',{brand_name:brand,model_name:model});if(error)throw error;await loadBrandModels();if(rows[brandModelTarget]){const row=rows[brandModelTarget];if(row.brand!==data.brand)row.model='';row.brand=data.brand;if(data.model)row.model=data.model;}invalidate();renderMachines(brandModelTarget);$('brandModelModal').close();notice('บันทึก '+data.brand+(data.model?' · '+data.model:'')+' ไว้เลือกใช้ครั้งต่อไปแล้ว');}finally{$('saveBrandModel').disabled=false;}});
    $('closeToolType').onclick=()=>$('toolTypeModal').close();
    $('toolTypeForm').onsubmit=guard(async event=>{event.preventDefault();const name=$('toolTypeName').value.trim();if(!name)throw new Error('กรอกชื่อประเภทเครื่อง');$('saveToolType').disabled=true;try{const {data,error}=await supabase.rpc('save_mems_report_tool_type',{type_name:name});if(error)throw error;await loadToolTypes();if(rows[toolTypeTarget])rows[toolTypeTarget].tool_type=data.name;invalidate();renderMachines(toolTypeTarget);$('toolTypeModal').close();notice('บันทึกประเภท '+data.name+' แล้ว เลือกใช้ได้ในชุดงานครั้งต่อไป');}finally{$('saveToolType').disabled=false;}});
    $('saveReports').onclick=guard(save);$('startNew').onclick=startNew;$('savedPdf').onclick=guard(()=>pdf(savedRows,$('savedPdf')));
    $('newTab').onclick=()=>tabs(false);$('historyTab').onclick=guard(async()=>{tabs(true);page=0;await history();});
    $('historyFilters').onsubmit=guard(async event=>{event.preventDefault();page=0;await history();});$('refreshHistory').onclick=guard(history);
    $('prevPage').onclick=guard(async()=>{if(page)page--;await history();});$('nextPage').onclick=guard(async()=>{page++;await history();});
    $('historyList').addEventListener('change',()=>{$('selectedPdf').disabled=!document.querySelector('[data-select]:checked');});
    $('selectedPdf').onclick=guard(()=>pdf([...document.querySelectorAll('[data-select]:checked')].map(input=>historyRows[Number(input.dataset.select)]),$('selectedPdf')));
    $('historyList').onclick=guard(async event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.pdf!==undefined)return pdf([historyRows[Number(button.dataset.pdf)]],button);if(button.dataset.batch){const reports=await fetchAllPages(()=>supabase.from('mems_reports').select('*').eq('batch_id',button.dataset.batch).order('batch_index'));await pdf(reports,button);}});
  }));
})();
