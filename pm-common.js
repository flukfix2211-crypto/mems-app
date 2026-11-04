(function (root) {
  'use strict';
  const common = ['สภาพภายนอกโครงสร้าง','ข้อต่อ/จุดต่างๆ','ล้อ/การเคลื่อนที่','ฉลาก/เครื่องหมาย','สายปลั๊กไฟ AC / Adepter DC','แบตเตอรี่ / การชาร์จเก็บประจุ','หน้าจอแสดงผล','สัญญาณเตือน','สายสัญญาณต่างๆ','ฟิลเตอรกรองอากาศ','ความสะอาดเครื่อง','Self Test'];
  const fields = kind => kind === 'acceptance' ? [...common,'คู่มือเครื่อง','ใบรับรอง'] : [...common,'มอเตอร์ (ปั้ม/พัดลม/คอมเพรสเซอร์)','ปรับเทียบค่ามาตรฐาน / ปรับจูนแก้ไข','การหล่อลื่นจุดหมุนกลไกต่างๆ'];
  function parseNumbers(input) {
    const cleaned = String(input).replace(/No\.?\s*/gi,'').trim();
    if (!cleaned) throw new Error('กรอก No. เครื่องอย่างน้อย 1 หมายเลข');
    const parts = cleaned.split(/[\s,;]+/).filter(Boolean);
    if (parts.some(v => !/^\d{1,6}$/.test(v) || Number(v)<1)) throw new Error('ใช้หมายเลขเต็มบวก คั่นด้วยเว้นวรรค จุลภาค หรือขึ้นบรรทัดใหม่');
    const numbers = [...new Set(parts.map(Number))];
    if (numbers.length>50) throw new Error('ครั้งละไม่เกิน 50 เครื่อง');
    return numbers;
  }
  function matchAssets(assets,type,numbers) {
    return numbers.map(no => {
      const rows=assets.filter(a=>a.type===type && Number(a.no)===no);
      if(rows.length!==1) throw new Error(type+' No.'+no+(rows.length?' มีทะเบียนซ้ำ':' ไม่พบในทะเบียน'));
      if (!rows[0].asset_id && !rows[0].asset_code) throw new Error(type+' No.'+no+' ยังไม่มี ID หรือเลขครุภัณฑ์');
      return rows[0];
    });
  }
  const today = (date=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function requestId() {
    if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }
  const typeKey = value => {
    const k=String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
    return ({bird:'brid เขียว','bird เขียว':'brid เขียว',brid:'brid เขียว',highflow:'high flow','monnal t60':'monnal t60'})[k]||k;
  };
  function resolveMachine(rows,machine) {
    const type=String(machine.equipment_type||'').trim(), value=String(machine.identifier||'').trim();
    if(!type || !value) throw new Error('กรอกประเภทเครื่องและ No. หรือ S/N');
    if(!['no','serial'].includes(machine.identity_mode))throw new Error('เลือก No. หรือ S/N');
    if(machine.identity_mode==='no' && (!/^\d{1,6}$/.test(value)||Number(value)<1)) throw new Error('No. ต้องเป็นจำนวนเต็มบวก');
    const matches=rows.filter(a=>typeKey(a.type)===typeKey(type) && (machine.identity_mode==='no'?Number(a.no)===Number(value):String(a.serial_number||'').trim()===value));
    if(matches.length>1)throw new Error('พบทะเบียนซ้ำ กรุณาตรวจสอบ No. หรือ S/N');
    return matches[0]||null;
  }
  function machineKey(machine,asset) {
    return asset ? 'asset:'+asset.id : JSON.stringify([typeKey(machine.equipment_type),machine.identity_mode,machine.identity_mode==='no'?String(Number(machine.identifier)):machine.identifier.trim()]);
  }
  function validateInspection(payload) {
    for(const k of ['equipment_type','tool_type','brand','model','operator','section'])if(!String(payload[k]||'').trim())throw new Error('กรอกประเภท ยี่ห้อ รุ่น หน่วยงาน และผู้ตรวจให้ครบ');
    if(fields(payload.kind).some(f=>!['ผ่าน','ไม่ผ่าน','N/A'].includes(payload.results[f])))throw new Error('เลือกผลตรวจให้ครบทุกข้อ');
    if(Object.values(payload.results).some(v=>v==='ไม่ผ่าน'||v==='N/A')&&!String(payload.note||'').trim())throw new Error('กรอกหมายเหตุรายเครื่องสำหรับผลไม่ผ่านหรือ N/A');
  }
  function inspectionResults(source,kind) {
    const result={};
    for(const field of fields(kind)) {
      const value=source?.[field];
      if(!['ผ่าน','ไม่ผ่าน','N/A'].includes(value))throw new Error('เลือกผลตรวจของเครื่องต้นทางให้ครบทุกข้อก่อนคัดลอก');
      result[field]=value;
    }
    return result;
  }
  const api={inspectionResults,fields,parseNumbers,matchAssets,today,esc,requestId,typeKey,resolveMachine,machineKey,validateInspection};
  if(typeof module!=='undefined') module.exports=api;
  else root.MemsPM=api;
})(typeof window!=='undefined'?window:this);
