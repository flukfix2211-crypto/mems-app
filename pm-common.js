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
  const api={fields,parseNumbers,matchAssets,today,esc,requestId};
  if(typeof module!=='undefined') module.exports=api;
  else root.MemsPM=api;
})(typeof window!=='undefined'?window:this);
