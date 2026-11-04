begin;
create or replace function private.prepare_mems_report() returns trigger language plpgsql security invoker set search_path='' as $$
declare p jsonb; a public.assets; checks text[]; k text; base jsonb; matches int; identifier text; register_asset boolean:=false; lock_key text; machine_no integer; machine_sn text; new_status text;
begin
 if not private.can_use_mems_reports() then raise exception 'ฟังก์ชันปิดอยู่หรือไม่มีสิทธิ์ใช้งาน' using errcode='42501'; end if;
 p:=new.payload;
 if jsonb_typeof(p)<>'object' or octet_length(p::text)>24000 then raise exception 'ข้อมูลไม่ถูกต้อง'; end if;
 if p->>'kind' not in ('pm','acceptance') or p->>'kind' is null then raise exception 'เลือกชนิดรายงาน'; end if;
 if coalesce(p->>'operator','')='' or coalesce(p->>'section','')='' then raise exception 'กรอกผู้ปฏิบัติงานและหน่วยงาน'; end if;
 if coalesce(btrim(p->>'brand'),'')='' or coalesce(btrim(p->>'model'),'')='' or coalesce(btrim(p->>'tool_type'),'')='' then raise exception 'กรอกชนิดเครื่อง ยี่ห้อ และรุ่น'; end if;
 if length(p->>'operator')>200 or length(p->>'section')>200 or length(coalesce(p->>'note',''))>2000 then raise exception 'ข้อความยาวเกินกำหนด'; end if;
 new.report_date:=(p->>'date')::date;
 if new.report_date is null or new.report_date<date '2000-01-01' or new.report_date>date '2100-12-31' then raise exception 'วันที่ไม่ถูกต้อง'; end if;
 checks:=array['สภาพภายนอกโครงสร้าง','ข้อต่อ/จุดต่างๆ','ล้อ/การเคลื่อนที่','ฉลาก/เครื่องหมาย','สายปลั๊กไฟ AC / Adepter DC','แบตเตอรี่ / การชาร์จเก็บประจุ','หน้าจอแสดงผล','สัญญาณเตือน','สายสัญญาณต่างๆ','ฟิลเตอรกรองอากาศ','ความสะอาดเครื่อง','Self Test'];
 checks:=checks || case when p->>'kind'='pm' then array['มอเตอร์ (ปั้ม/พัดลม/คอมเพรสเซอร์)','ปรับเทียบค่ามาตรฐาน / ปรับจูนแก้ไข','การหล่อลื่นจุดหมุนกลไกต่างๆ'] else array['คู่มือเครื่อง','ใบรับรอง'] end;
 if jsonb_typeof(p->'results') is distinct from 'object' then raise exception 'กรอกผลตรวจ'; end if;
 foreach k in array checks loop
   if coalesce(p->'results'->>k,'') not in ('ผ่าน','ไม่ผ่าน','N/A') then raise exception 'ผลตรวจไม่ครบ: %',k; end if;
 end loop;
 if p->'confirmed' is distinct from 'true'::jsonb then raise exception 'ยืนยันผลตรวจจริงก่อนบันทึก'; end if;
 if p->>'form_version'='2' then
   if new.batch_id is null then raise exception 'กรุณาบันทึกผ่านชุดงาน'; end if;
   if length(p->>'equipment_type')>200 then raise exception 'ประเภทเครื่องยาวเกินกำหนด'; end if;
   if nullif(btrim(p->>'operator'),'') is null or nullif(btrim(p->>'section'),'') is null then raise exception 'กรอกผู้ตรวจและหน่วยงาน'; end if;
   if nullif(btrim(p->>'equipment_type'),'') is null then raise exception 'กรอกประเภทเครื่อง'; end if;
   if p->>'identity_mode' not in ('no','serial') or p->>'identity_mode' is null then raise exception 'เลือก No. หรือ S/N'; end if;
   identifier:=btrim(case when p->>'identity_mode'='no' then p->>'no' else p->>'serial_number' end);
   if nullif(identifier,'') is null or length(identifier)>200 then raise exception 'กรอก No. หรือ S/N ให้ถูกต้อง'; end if;
   if p->>'identity_mode'='no' and (identifier !~ '^[0-9]{1,6}$' or identifier::numeric<1) then raise exception 'No. ต้องเป็นจำนวนเต็มบวก'; end if;
   if p ? 'register_asset' and jsonb_typeof(p->'register_asset') is distinct from 'boolean' then raise exception 'ข้อมูลลงทะเบียนไม่ถูกต้อง'; end if;
   register_asset:=coalesce(p->'register_asset'='true'::jsonb,false);
   if p->'existing_registration_confirmed'='true'::jsonb and (register_asset or p->>'kind'<>'acceptance') then raise exception 'การเก็บข้อมูลตรวจรับเดิมต้องไม่เพิ่มทะเบียนซ้ำ'; end if;
   if register_asset then
     if p->>'kind'<>'acceptance' or btrim(p->>'section')<>'ศูนย์เครื่องมือแพทย์' then raise exception 'ลงทะเบียนอัตโนมัติได้เฉพาะตรวจรับของศูนย์เครื่องมือแพทย์'; end if;
     if not private.has_permission('assets') then raise exception 'ไม่มีสิทธิ์เพิ่มทะเบียนเครื่องมือ' using errcode='42501'; end if;
     machine_no:=case when p->>'identity_mode'='no' then identifier::integer end;
     machine_sn:=nullif(btrim(p->>'serial_number'),'');
     for lock_key in select keys.k from (values
       (case when machine_sn is not null then '::mems-sn::'||machine_sn end),
       (case when machine_no is not null then public.mems_type_key(p->>'equipment_type')||'::'||machine_no::text end),
       (case when machine_sn is not null then public.mems_type_key(p->>'equipment_type')||'::sn:'||machine_sn end)
     ) keys(k) where keys.k is not null order by keys.k loop
       perform pg_advisory_xact_lock(hashtextextended(lock_key,0));
     end loop;
     if machine_sn is not null and machine_no is not null and exists(select 1 from public.assets x
       where public.mems_type_key(x.type)=public.mems_type_key(p->>'equipment_type') and btrim(x.serial_number)=machine_sn and x.no is distinct from machine_no) then
       raise exception 'S/N นี้อยู่ในทะเบียนหมายเลขอื่น กรุณาตรวจสอบ';
     end if;
   end if;
   select count(*) into matches from public.assets x where public.mems_type_key(x.type)=public.mems_type_key(p->>'equipment_type')
     and case when p->>'identity_mode'='no' then x.no::text=(identifier::numeric)::text else btrim(x.serial_number)=identifier end;
   if matches=0 and (register_asset or p->>'duplicate_policy'='confirm_existing') and nullif(btrim(p->>'serial_number'),'') is not null
      and exists(select 1 from public.assets x where btrim(x.serial_number)=btrim(p->>'serial_number')) then
     raise exception 'พบเครื่องในทะเบียนแล้ว (S/N ตรงกัน) กรุณาตรวจทานอีกครั้งและเลือกเก็บข้อมูลตรวจรับโดยไม่เพิ่มทะเบียนซ้ำ';
   end if;
   if matches>1 then raise exception 'พบทะเบียนเครื่องซ้ำ กรุณาตรวจสอบ No. หรือ S/N'; end if;
   if matches=1 then
     select * into strict a from public.assets x where public.mems_type_key(x.type)=public.mems_type_key(p->>'equipment_type')
       and case when p->>'identity_mode'='no' then x.no::text=(identifier::numeric)::text else btrim(x.serial_number)=identifier end;
     if p->>'kind'='acceptance' and p->>'duplicate_policy'='confirm_existing' and p->'existing_registration_confirmed' is distinct from 'true'::jsonb then
       raise exception 'พบเครื่องในทะเบียนแล้ว กรุณาตรวจทานอีกครั้งและเลือกเก็บข้อมูลตรวจรับโดยไม่เพิ่มทะเบียนซ้ำ';
     end if;
     if p->'existing_registration_confirmed'='true'::jsonb and p->>'existing_asset_id' is distinct from a.id::text then
       raise exception 'ทะเบียนเครื่องที่ยืนยันเปลี่ยนแล้ว กรุณาตรวจทานใหม่';
     end if;
     if register_asset and machine_sn is not null and btrim(a.serial_number) is distinct from machine_sn then raise exception 'No. และ S/N ไม่ตรงกับทะเบียน กรุณาตรวจสอบ'; end if;
     base:=jsonb_build_object('asset_pk',a.id,'equipment_type',a.type,'no',a.no,'asset_code',a.asset_code,'asset_id',a.asset_id,'source','registry');
   elsif p->'existing_registration_confirmed'='true'::jsonb then
     raise exception 'ไม่พบทะเบียนเครื่องที่ยืนยัน กรุณาตรวจทานใหม่';
   elsif register_asset then
     new_status:=case when exists(select 1 from jsonb_each_text(p->'results') r where r.value='ไม่ผ่าน') then 'เครื่องยังไม่พร้อมใช้งาน'
       when machine_no is null then 'รอเลขครุภัณฑ์' else 'ใช้งานได้' end;
     insert into public.assets(type,no,serial_number,status,note)
     values(btrim(p->>'equipment_type'),machine_no,machine_sn,new_status,
       'ตรวจรับจาก MEMs รายงาน '||new.id::text||E'\nยี่ห้อ: '||(p->>'brand')||E'\nรุ่น: '||(p->>'model')||E'\nวันที่ตรวจรับ: '||(p->>'date')||E'\nหมายเหตุ: '||coalesce(p->>'note','')) returning * into a;
     base:=jsonb_build_object('asset_pk',a.id,'equipment_type',a.type,'no',a.no,'asset_code',a.asset_code,'asset_id',a.asset_id,'source','registry','asset_registered',true,'asset_status',a.status);
   else
     base:=jsonb_build_object('asset_pk',null,'equipment_type',btrim(p->>'equipment_type'),'no',case when p->>'identity_mode'='no' then (identifier::numeric)::text end,'source','manual');
   end if;
   if exists(select 1 from jsonb_each_text(p->'results') r where r.value in ('ไม่ผ่าน','N/A')) and nullif(btrim(p->>'note'),'') is null then
     raise exception 'กรอกหมายเหตุรายเครื่องสำหรับผลไม่ผ่านหรือ N/A';
   end if;
   if length(coalesce(p->>'replacement',''))>2000 or length(p->>'brand')>200 or length(p->>'model')>200 or length(p->>'tool_type')>200 then raise exception 'ข้อความยาวเกินกำหนด'; end if;
 elsif p->>'asset_pk' is not null and p->>'asset_pk'<>'' then
   select * into a from public.assets where id=(p->>'asset_pk')::bigint;
   if not found then raise exception 'ไม่พบเครื่องในทะเบียน'; end if;
   base:=jsonb_build_object('asset_pk',a.id,'equipment_type',a.type,'no',a.no,'asset_code',a.asset_code,'asset_id',a.asset_id);
 else
   if p->>'kind'='pm' then raise exception 'PM ต้องเลือกเครื่องจากทะเบียน'; end if;
   if coalesce(p->>'equipment_type','')='' or coalesce(p->>'model','')='' or coalesce(p->>'brand','')='' then raise exception 'กรอกประเภท ยี่ห้อ และรุ่นเครื่องใหม่'; end if;
   base:=jsonb_build_object('asset_pk',null,'equipment_type',p->>'equipment_type','no',p->>'no','asset_code',p->>'asset_code','asset_id',p->>'asset_id');
 end if;
 if p->'existing_registration_confirmed'='true'::jsonb then base:=base||jsonb_build_object('acceptance_existing_asset',true); end if;
 new.kind:=p->>'kind';
 new.actor_user_id:=auth.uid();
 new.snapshot:=base || jsonb_build_object('brand',p->>'brand','model',p->>'model','serial_number',case when p->>'form_version'='2' and a.id is not null then a.serial_number else p->>'serial_number' end,'tool_type',p->>'tool_type');
 new.created_at:=now(); new.status:='saved';
 new.slides_id:=null;new.pdf_id:=null;new.drive_folder_id:=null;new.export_error:=null;new.export_started_at:=null;new.exported_at:=null;
 return new;
end;
$$;
revoke all on function private.prepare_mems_report() from public;

create or replace function public.save_mems_report_batch(request_id uuid, batch_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cached public.mems_report_batches; item jsonb; pos int:=0; result jsonb; identity_key text;
begin
 if auth.uid() is null or not private.can_use_mems_reports() then raise exception 'ฟังก์ชันปิดอยู่หรือไม่มีสิทธิ์ใช้งาน' using errcode='42501'; end if;
 if request_id is null or jsonb_typeof(batch_payload) is distinct from 'array' or jsonb_array_length(batch_payload) not between 1 and 50 then raise exception 'เลือก 1 ถึง 50 เครื่อง'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,2));
 select * into cached from public.mems_report_batches where id=request_id;
 if found then
   if cached.actor_user_id is distinct from auth.uid() or cached.payload is distinct from batch_payload then raise exception 'รหัสชุดงานถูกใช้กับข้อมูลอื่น'; end if;
 else
   for identity_key in
     select distinct keys.k from jsonb_array_elements(batch_payload) x cross join lateral (values
       (case when nullif(btrim(x->'payload'->>'serial_number'),'') is not null then '::mems-sn::'||btrim(x->'payload'->>'serial_number') end),
       (case when x->'payload'->>'identity_mode'='no' and x->'payload'->>'no' ~ '^[0-9]{1,6}$' then public.mems_type_key(x->'payload'->>'equipment_type')||'::'||((x->'payload'->>'no')::integer)::text end),
       (case when nullif(btrim(x->'payload'->>'serial_number'),'') is not null then public.mems_type_key(x->'payload'->>'equipment_type')||'::sn:'||btrim(x->'payload'->>'serial_number') end)
     ) keys(k) where x->'payload'->'register_asset'='true'::jsonb and keys.k is not null order by keys.k
   loop perform pg_advisory_xact_lock(hashtextextended(identity_key,0)); end loop;
   insert into public.mems_report_batches(id,payload) values(request_id,batch_payload);
   for item in select value from jsonb_array_elements(batch_payload) loop
     if jsonb_typeof(item) is distinct from 'object' or item->'payload'->>'form_version' is distinct from '2' then raise exception 'ข้อมูลเครื่องไม่ถูกต้อง'; end if;
     insert into public.mems_reports(id,batch_id,batch_index,kind,report_date,payload,snapshot)
     values((item->>'id')::uuid,request_id,pos,item->'payload'->>'kind',(item->'payload'->>'date')::date,item->'payload','{}');
     pos:=pos+1;
   end loop;
 end if;
 select jsonb_agg(to_jsonb(r) order by batch_index) into result from public.mems_reports r where batch_id=request_id;
 if coalesce(jsonb_array_length(result),0)<>jsonb_array_length(batch_payload) then raise exception 'ชุดงานบันทึกไม่ครบ'; end if;
 return result;
end $$;
revoke all on function public.save_mems_report_batch(uuid,jsonb) from public,anon;
grant execute on function public.save_mems_report_batch(uuid,jsonb) to authenticated;

commit;
