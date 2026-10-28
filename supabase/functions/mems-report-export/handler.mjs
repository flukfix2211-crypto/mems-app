export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fileId = /^[A-Za-z0-9_-]{10,200}$/;
const bridgeUrl = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
export function createExportHandler({ createClient, env, fetchImpl = fetch, now = () => new Date() }) {
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  return async req=>{
    if(req.method==='OPTIONS')return new Response('ok',{headers});
    if(req.method!=='POST')return reply({ok:false,error:'ใช้ POST เท่านั้น'},405);
    let admin,reportId,claimed=false;
    try{
      const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
      if(!token)return reply({ok:false,error:'กรุณาเข้าสู่ระบบ'},401);
      const body=await req.json();reportId=body.report_id;
      if(!UUID.test(reportId||''))return reply({ok:false,error:'รหัสรายงานไม่ถูกต้อง'},400);
      admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
      const {data:{user},error:authError}=await admin.auth.getUser(token);
      if(authError||!user)return reply({ok:false,error:'กรุณาเข้าสู่ระบบใหม่'},401);
      const {data:profile,error:profileError}=await admin.from('user_profiles').select('id,role,active,permissions').eq('id',user.id).single();
      if(profileError||!profile?.active||!(profile.role==='admin'||profile.permissions?.includes('pm_reports')))return reply({ok:false,error:'ไม่มีสิทธิ์ใช้งานรายงาน'},403);
      const {data:settings,error:settingsError}=await admin.from('mems_report_settings').select('*').eq('id',true).single();
      if(settingsError)throw new Error('โหลดการตั้งค่าไม่สำเร็จ');
      if(!settings.enabled)return reply({ok:false,error:'แอดมินปิดฟังก์ชันนี้อยู่'},403);
      const {data:report,error:readError}=await admin.from('mems_reports').select('*').eq('id',reportId).single();
      if(readError||!report)return reply({ok:false,error:'ไม่พบรายงาน'},404);
      if(report.actor_user_id!==user.id&&profile.role!=='admin')return reply({ok:false,error:'สร้างไฟล์ได้เฉพาะรายงานของตนเองหรือแอดมิน'},403);
      if(report.status==='exported')return reply({ok:true,report});
      if(!bridgeUrl.test(settings.bridge_url||''))return reply({ok:false,error:'บันทึกประวัติแล้ว กรุณาให้แอดมินเชื่อมต่อ Apps Script ก่อนสร้างไฟล์'},412);
      const cutoff=new Date(now().getTime()-10*60*1000).toISOString();
      const {data:claim,error:claimError}=await admin.from('mems_reports').update({status:'generating',export_started_at:now().toISOString(),export_error:null}).eq('id',reportId).neq('status','exported').or('status.neq.generating,export_started_at.lt.'+cutoff).select('id').maybeSingle();
      if(claimError)throw new Error('เริ่มสร้างรายงานไม่สำเร็จ');
      if(!claim)return reply({ok:false,error:'รายงานนี้กำลังสร้างอยู่ กรุณารีเฟรชประวัติ หากค้างเกิน 10 นาทีจึงลองสร้างต่อ'},409);
      claimed=true;
      const response=await fetchImpl(settings.bridge_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report_id:reportId,token}),signal:AbortSignal.timeout(90000)});
      if(!response.ok)throw new Error('Google ตอบกลับไม่สำเร็จ กรุณาตรวจสถานะก่อนลองรายการเดิมอีกครั้ง');
      const receipt=await response.json();
      if(!receipt.ok)throw new Error(typeof receipt.error==='string'?receipt.error.slice(0,250):'สร้างไฟล์ใน Drive ไม่สำเร็จ');
      if(receipt.report_id!==reportId||![receipt.slides_id,receipt.pdf_id,receipt.folder_id].every(v=>typeof v==='string'&&fileId.test(v)))throw new Error('Google ส่งผลยืนยันไม่ครบ กรุณาตรวจรายงานเดิมก่อนลองใหม่');
      const {data:result,error:updateError}=await admin.from('mems_reports').update({status:'exported',slides_id:receipt.slides_id,pdf_id:receipt.pdf_id,drive_folder_id:receipt.folder_id,exported_at:now().toISOString(),export_error:null}).eq('id',reportId).select('*').single();
      if(updateError)throw new Error('สร้างไฟล์แล้วแต่บันทึกลิงก์ไม่สำเร็จ ลองรายการเดิมเพื่อกู้ลิงก์โดยไม่สร้างไฟล์ซ้ำ');
      return reply({ok:true,report:result});
    }catch(error){
      const message=error?.name==='TimeoutError'?'Google ยังไม่ยืนยันผลในเวลาที่กำหนด กรุณาตรวจประวัติก่อนลองรายการเดิม':(error instanceof SyntaxError?'ข้อมูลหรือคำตอบจาก Google ไม่ถูกต้อง':error?.message||'สร้างรายงานไม่สำเร็จ');
      if(claimed&&admin){await admin.from('mems_reports').update({status:'export_error',export_error:message.slice(0,500)}).eq('id',reportId).eq('status','generating');}
      return reply({ok:false,error:message},400);
    }
  };
}
