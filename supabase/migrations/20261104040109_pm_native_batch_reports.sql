begin;
create table public.mems_report_batches (
 id uuid primary key,
 actor_user_id uuid not null default auth.uid() references auth.users,
 payload jsonb not null check(jsonb_typeof(payload)='array' and jsonb_array_length(payload) between 1 and 50 and octet_length(payload::text)<=1500000),
 created_at timestamptz not null default now()
);
alter table public.mems_report_batches enable row level security;
revoke all on public.mems_report_batches from public,anon,authenticated;
grant select,insert on public.mems_report_batches to authenticated;
grant all on public.mems_report_batches to service_role;
create policy batch_read on public.mems_report_batches for select to authenticated using((select private.can_use_mems_reports()));
create policy batch_insert on public.mems_report_batches for insert to authenticated with check(actor_user_id=(select auth.uid()) and (select private.can_use_mems_reports()));
alter table public.mems_reports add column batch_id uuid references public.mems_report_batches(id), add column batch_index integer;
alter table public.mems_reports add constraint report_batch_position check((batch_id is null and batch_index is null) or (batch_id is not null and batch_index between 0 and 49));
create unique index mems_report_batch_position on public.mems_reports(batch_id,batch_index) where batch_id is not null;
create or replace function private.prepare_mems_report() returns trigger language plpgsql security invoker set search_path='' as $$
declare p jsonb; a public.assets; checks text[]; k text; base jsonb; matches int; identifier text;
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
   select count(*) into matches from public.assets x where public.mems_type_key(x.type)=public.mems_type_key(p->>'equipment_type')
     and case when p->>'identity_mode'='no' then x.no::text=(identifier::numeric)::text else btrim(x.serial_number)=identifier end;
   if matches>1 then raise exception 'พบทะเบียนเครื่องซ้ำ กรุณาตรวจสอบ No. หรือ S/N'; end if;
   if matches=1 then
     select * into strict a from public.assets x where public.mems_type_key(x.type)=public.mems_type_key(p->>'equipment_type')
       and case when p->>'identity_mode'='no' then x.no::text=(identifier::numeric)::text else btrim(x.serial_number)=identifier end;
     base:=jsonb_build_object('asset_pk',a.id,'equipment_type',a.type,'no',a.no,'asset_code',a.asset_code,'asset_id',a.asset_id,'source','registry');
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
 new.kind:=p->>'kind';
 new.actor_user_id:=auth.uid();
 new.snapshot:=base || jsonb_build_object('brand',p->>'brand','model',p->>'model','serial_number',case when p->>'form_version'='2' and a.id is not null then a.serial_number else p->>'serial_number' end,'tool_type',p->>'tool_type');
 new.created_at:=now(); new.status:='saved';
 new.slides_id:=null;new.pdf_id:=null;new.drive_folder_id:=null;new.export_error:=null;new.export_started_at:=null;new.exported_at:=null;
 return new;
end;
$$;
revoke all on function private.prepare_mems_report() from public;

create function private.mems_report_batch_link_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare batch public.mems_report_batches; item jsonb;
begin
 if new.batch_id is null then return new; end if;
 select * into batch from public.mems_report_batches where id=new.batch_id;
 item:=batch.payload->new.batch_index;
 if batch.actor_user_id is distinct from auth.uid() or item is null or (item->>'id')::uuid is distinct from new.id or item->'payload' is distinct from new.payload
    or new.payload->>'form_version' is distinct from '2' then raise exception 'เครื่องไม่ตรงกับชุดงาน'; end if;
 return new;
end $$;
revoke all on function private.mems_report_batch_link_guard() from public;
create trigger zz_mems_report_batch_link_guard before insert on public.mems_reports for each row execute function private.mems_report_batch_link_guard();

create function private.mems_report_batch_complete() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.actor_user_id is distinct from auth.uid() or not private.can_use_mems_reports() then raise exception 'ไม่มีสิทธิ์บันทึกชุดงาน' using errcode='42501'; end if;
 if (select count(*) from public.mems_reports where batch_id=new.id)<>jsonb_array_length(new.payload) then raise exception 'ชุดงานบันทึกไม่ครบ'; end if;
 if (select count(distinct (kind,report_date)) from public.mems_reports where batch_id=new.id)<>1 then raise exception 'ชุดงานต้องเป็นประเภทงานและวันที่เดียวกัน'; end if;
 if exists(select 1 from public.mems_reports where batch_id=new.id group by
   case when snapshot->>'asset_pk' is not null then 'asset:'||(snapshot->>'asset_pk')
   else public.mems_type_key(snapshot->>'equipment_type')||':'||case when payload->>'identity_mode'='no' then 'no:'||(snapshot->>'no') else 'sn:'||btrim(snapshot->>'serial_number') end end
   having count(*)>1) then raise exception 'เครื่องซ้ำในชุดงาน'; end if;
 return new;
end $$;
revoke all on function private.mems_report_batch_complete() from public;
create constraint trigger mems_report_batch_complete after insert on public.mems_report_batches deferrable initially deferred for each row execute function private.mems_report_batch_complete();

create function public.save_mems_report_batch(request_id uuid, batch_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cached public.mems_report_batches; item jsonb; pos int:=0; result jsonb;
begin
 if auth.uid() is null or not private.can_use_mems_reports() then raise exception 'ฟังก์ชันปิดอยู่หรือไม่มีสิทธิ์ใช้งาน' using errcode='42501'; end if;
 if request_id is null or jsonb_typeof(batch_payload) is distinct from 'array' or jsonb_array_length(batch_payload) not between 1 and 50 then raise exception 'เลือก 1 ถึง 50 เครื่อง'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,2));
 select * into cached from public.mems_report_batches where id=request_id;
 if found then
   if cached.actor_user_id is distinct from auth.uid() or cached.payload is distinct from batch_payload then raise exception 'รหัสชุดงานถูกใช้กับข้อมูลอื่น'; end if;
 else
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
