// Supabase Edge Function: mems-user-admin
// จัดการบัญชีผู้ใช้ (settings.html) — เรียกได้เฉพาะแอดมินหลัก (is_super_admin) ยกเว้น bootstrap
// actions: bootstrap, list, activity, create, update, reset_password, set_active, delete
//
// ไฟล์นี้คือซอร์สของฟังก์ชันที่ deploy อยู่บน Supabase — แก้แล้วต้อง deploy ใหม่

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:cors});
const usernameOk = (v: unknown) => /^[a-z0-9._-]{3,32}$/.test(String(v||""));
const emailFor = (username: string) => `${username.toLowerCase()}@mems.local`;
const PAGE_KEYS = ["borrow","prepare","dashboard","assets","round","fixjob"];
const permsOk = (v: unknown) => Array.isArray(v) && v.every(p => PAGE_KEYS.includes(p));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return reply({ok:false,error:"Method not allowed"},405);
  try {
    const url=Deno.env.get("SUPABASE_URL")!;
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const body=await req.json();

    if(body.action==="bootstrap"){
      const {count,error:countError}=await admin.from("user_profiles").select("id",{count:"exact",head:true});
      if(countError) throw countError;
      if((count||0)>0) return reply({ok:false,error:"ตั้งค่าแอดมินเริ่มต้นไปแล้ว"},403);
      if(!usernameOk(body.username)||String(body.password||"").length<10||!String(body.display_name||"").trim()) return reply({ok:false,error:"ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง"},400);
      const {data,error}=await admin.auth.admin.createUser({email:emailFor(body.username),password:body.password,email_confirm:true,user_metadata:{display_name:String(body.display_name).trim(),username:body.username},app_metadata:{role:"admin"}});
      if(error) throw error;
      const {error:profileError}=await admin.from("user_profiles").insert({id:data.user.id,username:body.username,display_name:String(body.display_name).trim(),role:"admin",active:true,permissions:PAGE_KEYS,is_super_admin:true});
      if(profileError){await admin.auth.admin.deleteUser(data.user.id);throw profileError;}
      return reply({ok:true});
    }

    const authHeader=req.headers.get("Authorization")||"";
    const token=authHeader.replace(/^Bearer\s+/i,"");
    const {data:{user},error:userError}=await admin.auth.getUser(token);
    if(userError||!user) return reply({ok:false,error:"กรุณาเข้าสู่ระบบ"},401);
    const {data:caller}=await admin.from("user_profiles").select("role,active,is_super_admin").eq("id",user.id).single();
    // เฉพาะ is_super_admin เท่านั้นที่จัดการบัญชีได้ — role='admin' อย่างเดียวให้แค่สิทธิ์เข้าทุกหน้า ไม่ใช่สิทธิ์จัดการบัญชี
    if(!caller?.active||!caller.is_super_admin) return reply({ok:false,error:"ไม่มีสิทธิ์ผู้ดูแลระบบ (เฉพาะแอดมินหลักเท่านั้น)"},403);

    // บันทึกการจัดการบัญชีลง audit_log (ผู้ทำ = แอดมินที่เรียก) — ถ้าบันทึกไม่ได้ ไม่ให้กระทบงานหลัก
    const logAccount = async (targetId: string, op: string, detail: Record<string, unknown> = {}) => {
      const {data:target}=await admin.from("user_profiles").select("username,display_name").eq("id",targetId).maybeSingle();
      const {error}=await admin.from("audit_log").insert({
        actor_user_id:user.id, table_name:"user_profiles", action:"account", row_id:targetId,
        new_data:{op, username:target?.username ?? detail.username ?? null, display_name:target?.display_name ?? detail.display_name ?? null, ...detail},
      });
      if(error) console.error("audit_log insert failed", error);
    };

    if(body.action==="list"){
      const {data,error}=await admin.from("user_profiles").select("id,username,display_name,role,active,permissions,is_super_admin,created_at").order("created_at");
      if(error) throw error; return reply({ok:true,users:data||[]});
    }
    if(body.action==="activity"){
      if(!body.user_id) return reply({ok:false,error:"ขาด user_id"},400);
      const limit = Math.min(Number(body.limit)||100, 200);
      const [authRes, borrowRes, prepareRes, fixjobRes, auditRes] = await Promise.all([
        admin.auth.admin.getUserById(body.user_id),
        admin.from("borrow_records").select("id,action,equipment_name,equipment_number,ward,staff_name,shift,note,record_date,record_time,recorded_at").eq("actor_user_id",body.user_id).order("recorded_at",{ascending:false}).limit(limit),
        admin.from("prepare_records").select("id,equipment_type,equipment_number,ward,prepared_by,status,record_date,record_time,recorded_at").eq("actor_user_id",body.user_id).order("recorded_at",{ascending:false}).limit(limit),
        admin.from("fixjob_records").select("id,ward,topic,detail,staff,record_date,record_time,recorded_at").eq("actor_user_id",body.user_id).order("recorded_at",{ascending:false}).limit(limit),
        // ทุกการเพิ่ม/แก้ไข/ลบ (ครุภัณฑ์, ยืม-คืน, เตรียม, แก้ไขหน้างาน) และการจัดการบัญชี
        admin.from("audit_log").select("id,at,table_name,action,row_id,old_data,new_data,changed").eq("actor_user_id",body.user_id).order("at",{ascending:false}).limit(limit)
      ]);
      if(borrowRes.error) throw borrowRes.error;
      if(prepareRes.error) throw prepareRes.error;
      if(fixjobRes.error) throw fixjobRes.error;
      if(auditRes.error) throw auditRes.error;
      return reply({
        ok:true,
        last_sign_in_at: authRes.data?.user?.last_sign_in_at || null,
        created_at: authRes.data?.user?.created_at || null,
        borrow: borrowRes.data||[],
        prepare: prepareRes.data||[],
        fixjob: fixjobRes.data||[],
        audit: auditRes.data||[]
      });
    }
    if(body.action==="create"){
      const role=body.role==="admin"?"admin":"user";
      const permissions=role==="admin"?PAGE_KEYS:(permsOk(body.permissions)?body.permissions:[]);
      if(!usernameOk(body.username)||String(body.password||"").length<10||!String(body.display_name||"").trim()) return reply({ok:false,error:"ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง"},400);
      const {data,error}=await admin.auth.admin.createUser({email:emailFor(body.username),password:body.password,email_confirm:true,user_metadata:{display_name:String(body.display_name).trim(),username:body.username},app_metadata:{role}});
      if(error) throw error;
      // is_super_admin ตั้งได้เฉพาะตอน bootstrap เท่านั้น — บัญชีที่สร้างทีหลังทั้งหมด (แม้ role=admin) ไม่ได้สิทธิ์จัดการบัญชี
      const {error:profileError}=await admin.from("user_profiles").insert({id:data.user.id,username:body.username,display_name:String(body.display_name).trim(),role,active:true,permissions,is_super_admin:false});
      if(profileError){await admin.auth.admin.deleteUser(data.user.id);throw profileError;}
      await logAccount(data.user.id,"create",{role,permissions});
      return reply({ok:true});
    }
    if(body.action==="update"){
      const {data:target,error:targetError}=await admin.from("user_profiles").select("role,display_name,permissions").eq("id",body.user_id).single();
      if(targetError) throw targetError;
      const patch: Record<string, unknown> = {};
      if(body.display_name!==undefined){
        if(!String(body.display_name).trim()) return reply({ok:false,error:"ชื่อที่แสดงห้ามว่าง"},400);
        patch.display_name=String(body.display_name).trim();
      }
      let nextRole=target.role;
      if(body.role!==undefined){
        nextRole=body.role==="admin"?"admin":"user";
        if(target.role==="admin"&&nextRole!=="admin"){
          const {count}=await admin.from("user_profiles").select("id",{count:"exact",head:true}).eq("role","admin").eq("active",true);
          if((count||0)<=1) return reply({ok:false,error:"ต้องมีแอดมินที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ"},400);
        }
        if(body.user_id===user.id&&nextRole!=="admin") return reply({ok:false,error:"ไม่สามารถถอดสิทธิ์แอดมินของตนเอง"},400);
        patch.role=nextRole;
      }
      if(body.permissions!==undefined){
        if(!permsOk(body.permissions)) return reply({ok:false,error:"รูปแบบสิทธิ์ไม่ถูกต้อง"},400);
        patch.permissions=nextRole==="admin"?PAGE_KEYS:body.permissions;
      } else if(patch.role==="admin"){
        patch.permissions=PAGE_KEYS;
      }
      if(Object.keys(patch).length===0) return reply({ok:false,error:"ไม่มีข้อมูลที่จะแก้ไข"},400);
      const {error}=await admin.from("user_profiles").update(patch).eq("id",body.user_id);
      if(error) throw error;
      if(patch.role!==undefined){
        const {error:authError}=await admin.auth.admin.updateUserById(body.user_id,{app_metadata:{role:patch.role}});
        if(authError) throw authError;
      }
      await logAccount(body.user_id,"update",{before:{role:target.role,display_name:target.display_name,permissions:target.permissions},after:patch});
      return reply({ok:true});
    }
    if(body.action==="reset_password"){
      if(String(body.password||"").length<10) return reply({ok:false,error:"รหัสผ่านต้องอย่างน้อย 10 ตัว"},400);
      const {error}=await admin.auth.admin.updateUserById(body.user_id,{password:body.password});if(error)throw error;
      await logAccount(body.user_id,"reset_password");
      return reply({ok:true});
    }
    if(body.action==="set_active"){
      if(body.user_id===user.id&&!body.active) return reply({ok:false,error:"ไม่สามารถปิดบัญชีของตนเอง"},400);
      const {data:target,error:targetError}=await admin.from("user_profiles").select("role").eq("id",body.user_id).single();if(targetError)throw targetError;
      if(target.role==="admin"&&!body.active){
        const {count}=await admin.from("user_profiles").select("id",{count:"exact",head:true}).eq("role","admin").eq("active",true);
        if((count||0)<=1) return reply({ok:false,error:"ต้องมีแอดมินที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ"},400);
      }
      const {error}=await admin.from("user_profiles").update({active:!!body.active}).eq("id",body.user_id);if(error)throw error;
      const {error:authError}=await admin.auth.admin.updateUserById(body.user_id,{ban_duration:body.active?"none":"876000h",app_metadata:{role:target.role}});if(authError)throw authError;
      await logAccount(body.user_id,body.active?"enable":"disable");
      return reply({ok:true});
    }
    if(body.action==="delete"){
      if(body.user_id===user.id) return reply({ok:false,error:"ไม่สามารถลบบัญชีของตนเอง"},400);
      const {data:target,error:targetError}=await admin.from("user_profiles").select("role,is_super_admin,username,display_name").eq("id",body.user_id).single();
      if(targetError) throw targetError;
      if(target.is_super_admin) return reply({ok:false,error:"ไม่สามารถลบบัญชีแอดมินหลักได้"},400);
      if(target.role==="admin"){
        const {count}=await admin.from("user_profiles").select("id",{count:"exact",head:true}).eq("role","admin").eq("active",true);
        if((count||0)<=1) return reply({ok:false,error:"ต้องมีแอดมินที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ"},400);
      }
      // บันทึกก่อนลบ (หลังลบจะหาชื่อบัญชีไม่ได้แล้ว)
      await logAccount(body.user_id,"delete",{username:target.username,display_name:target.display_name});
      const {error}=await admin.auth.admin.deleteUser(body.user_id); // cascades to user_profiles (FK on delete cascade)
      if(error) throw error;
      return reply({ok:true});
    }
    return reply({ok:false,error:"ไม่รู้จักคำสั่ง"},400);
  } catch (error) { return reply({ok:false,error:error instanceof Error?error.message:String(error)},400); }
});
