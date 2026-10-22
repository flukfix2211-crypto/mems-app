-- Reviewed against production catalog 2026-10-22. Apply in a single transaction.
-- Generated with Supabase CLI; tested with the captured production trigger definitions.
begin;
create or replace function public.mems_type_key(value text) returns text
language sql immutable strict set search_path = '' as $$
 select case lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
 when 'bird' then 'brid เขียว' when 'bird เขียว' then 'brid เขียว' when 'brid' then 'brid เขียว'
 when 'highflow' then 'high flow'
 else lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) end
$$;
create or replace function public.mems_number_key(value text) returns text
language sql immutable set search_path = '' as $$
 select case when btrim(coalesce(value,'')) ~ '^[0-9]+(\.0+)?$'
 then trunc(btrim(value)::numeric)::text else btrim(coalesce(value,'')) end
$$;
alter table public.borrow_records add column request_id uuid;
alter table public.prepare_records add column request_id uuid;
alter table public.borrow_records add column loan_id bigint references public.borrow_records(id);
alter table public.prepare_records add column borrow_record_id bigint references public.borrow_records(id);
create index mems_borrow_identity_time on public.borrow_records
 (public.mems_type_key(equipment_name),public.mems_number_key(equipment_number),recorded_at desc,id desc);
create unique index mems_prepare_active_identity on public.prepare_records
 (public.mems_type_key(equipment_type),public.mems_number_key(equipment_number)) where status='เตรียม';
create unique index mems_assets_identity on public.assets (public.mems_type_key(type),no) where no is not null and type is not null;
create index mems_borrow_loan on public.borrow_records(loan_id);
create index mems_prepare_borrow on public.prepare_records(borrow_record_id);

-- Read actual transactions only; Round and Circuit observations cannot release a loan.
create or replace view public.equipment_status with (security_invoker=true) as
 select distinct on (public.mems_type_key(equipment_name),public.mems_number_key(equipment_number))
 equipment_name, public.mems_number_key(equipment_number) as equipment_number,
 ward,staff_name,action,recorded_at, action ~ '(ยืม|ย้าย)' as is_borrowed,
 (select min(r.recorded_at) from public.borrow_records r where r.action ~ 'ยืม'
 and public.mems_type_key(r.equipment_name)=public.mems_type_key(b.equipment_name)
 and public.mems_number_key(r.equipment_number)=public.mems_number_key(b.equipment_number)
 and (r.recorded_at,r.id)<=(b.recorded_at,b.id)
 and not exists(select 1 from public.borrow_records c where c.action ~ 'คืน'
 and public.mems_type_key(c.equipment_name)=public.mems_type_key(b.equipment_name)
 and public.mems_number_key(c.equipment_number)=public.mems_number_key(b.equipment_number)
 and (c.recorded_at,c.id)>(r.recorded_at,r.id) and (c.recorded_at,c.id)<=(b.recorded_at,b.id))
 having count(*)=1) as borrow_started_at
 from public.borrow_records b
 where equipment_name is not null and nullif(public.mems_number_key(equipment_number),'') is not null
 and action ~ '(ยืม|คืน|ย้าย)'
 order by public.mems_type_key(equipment_name),public.mems_number_key(equipment_number),recorded_at desc,id desc;

-- Invoker functions keep existing RLS and audit triggers. No new definer privilege.
create or replace function private.mems_prepare_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a public.assets; latest public.borrow_records; total int;
begin
 if tg_op='UPDATE' then
   if (new.equipment_type,new.equipment_number,new.ward,new.request_id) is distinct from (old.equipment_type,old.equipment_number,old.ward,old.request_id) then
     raise exception 'ยกเลิกแล้วเตรียมใหม่เมื่อต้องการเปลี่ยนเครื่องหรือตึก';
   end if;
   if old.status<>'เตรียม' and new.status is distinct from old.status then raise exception 'รายการนี้ปิดแล้ว'; end if;
   perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(new.equipment_type)||'::'||public.mems_number_key(new.equipment_number),0));
   if new.status='ยืมแล้ว' and (new.status is distinct from old.status or new.borrow_record_id is distinct from old.borrow_record_id) and not exists(select 1 from public.borrow_records r where r.id=new.borrow_record_id and r.action ~ 'ยืม' and r.ward=new.ward and public.mems_type_key(r.equipment_name)=public.mems_type_key(new.equipment_type) and public.mems_number_key(r.equipment_number)=public.mems_number_key(new.equipment_number)) then raise exception 'ไม่มีรายการยืมที่เชื่อมโยง'; end if;
   if new.status is distinct from old.status and new.status<>'เตรียม' and new.status<>'ยืมแล้ว' and new.status not like 'ยกเลิก: %' then raise exception 'สถานะเตรียมไม่ถูกต้อง'; end if;
   new.record_date:=(new.recorded_at at time zone 'Asia/Bangkok')::date;
   new.record_time:=(new.recorded_at at time zone 'Asia/Bangkok')::time;
   return new;
 end if;
 if new.status<>'เตรียม' then raise exception 'ต้องเริ่มด้วยสถานะเตรียม'; end if;
 if nullif(btrim(new.ward),'') is null or nullif(btrim(new.prepared_by),'') is null then raise exception 'กรุณาระบุตึกและผู้เตรียม'; end if;
 perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(new.equipment_type)||'::'||public.mems_number_key(new.equipment_number),0));
 select count(*) into total from public.assets where public.mems_type_key(type)=public.mems_type_key(new.equipment_type) and no::text=public.mems_number_key(new.equipment_number);
 if total<>1 then raise exception 'เพิ่มทะเบียนพร้อมหมายเลขก่อน หรือแก้ทะเบียนซ้ำ'; end if;
 select * into a from public.assets where public.mems_type_key(type)=public.mems_type_key(new.equipment_type) and no::text=public.mems_number_key(new.equipment_number) for share;
 if a.status is distinct from 'ใช้งานได้' then raise exception 'เครื่องซ่อม/ชำรุด หรือไม่พร้อมใช้'; end if;
 new.equipment_type:=a.type; new.equipment_number:=a.no::text;
 select * into latest from public.borrow_records where public.mems_type_key(equipment_name)=public.mems_type_key(a.type) and public.mems_number_key(equipment_number)=a.no::text and action ~ '(ยืม|คืน|ย้าย)' order by recorded_at desc,id desc limit 1;
 if latest.action ~ '(ยืม|ย้าย)' then raise exception 'เครื่องถูกยืมอยู่'; end if;
 if exists(select 1 from public.prepare_records where status='เตรียม' and public.mems_type_key(equipment_type)=public.mems_type_key(a.type) and public.mems_number_key(equipment_number)=a.no::text) then raise exception 'เครื่องถูกเตรียมไว้แล้ว'; end if;
 new.recorded_at:=statement_timestamp();
 new.record_date:=(new.recorded_at at time zone 'Asia/Bangkok')::date;
 new.record_time:=(new.recorded_at at time zone 'Asia/Bangkok')::time;
 return new;
end $$;
create trigger mems_prepare_guard before insert or update on public.prepare_records for each row execute function private.mems_prepare_guard();

create or replace function private.mems_borrow_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a public.assets; latest public.borrow_records; prep public.prepare_records; total int; origin bigint;
begin
 if tg_op='UPDATE' then
   if (new.equipment_name,new.equipment_number,new.action,new.ward,new.loan_id,new.request_id) is distinct from (old.equipment_name,old.equipment_number,old.action,old.ward,old.loan_id,old.request_id) then
     raise exception 'แก้ประเภทธุรกรรม เครื่อง หรือตึกไม่ได้ กรุณาใช้การย้ายตึก';
   end if;
   if new.recorded_at is distinct from old.recorded_at and old.action ~ '(ยืม|คืน|ย้าย)' then
     perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(old.equipment_name)||'::'||public.mems_number_key(old.equipment_number),0));
     if exists(select 1 from public.borrow_records r where r.id<>old.id
       and public.mems_type_key(r.equipment_name)=public.mems_type_key(old.equipment_name)
       and public.mems_number_key(r.equipment_number)=public.mems_number_key(old.equipment_number)
       and r.action ~ '(ยืม|คืน|ย้าย)' and
       (((r.recorded_at,r.id)<(old.recorded_at,old.id) and (r.recorded_at,r.id)>=(new.recorded_at,new.id)) or
        ((r.recorded_at,r.id)>(old.recorded_at,old.id) and (r.recorded_at,r.id)<=(new.recorded_at,new.id)))) then
       raise exception 'เวลาใหม่สลับลำดับยืม–คืนหรือย้ายตึก กรุณาตรวจประวัติก่อน';
     end if;
   end if;
   new.record_date:=(new.recorded_at at time zone 'Asia/Bangkok')::date;
   new.record_time:=(new.recorded_at at time zone 'Asia/Bangkok')::time;
   return new;
 end if;
 new.record_date:=(new.recorded_at at time zone 'Asia/Bangkok')::date;
 new.record_time:=(new.recorded_at at time zone 'Asia/Bangkok')::time;
 if new.action !~ '(ยืม|คืน|ย้าย)' then return new; end if;
 if new.recorded_at>statement_timestamp()+interval '5 seconds' then raise exception 'เวลาธุรกรรมต้องไม่เป็นอนาคต'; end if;
 if nullif(btrim(new.ward),'') is null or nullif(btrim(new.staff_name),'') is null then raise exception 'กรุณาระบุตึกและชื่อ'; end if;
 perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(new.equipment_name)||'::'||public.mems_number_key(new.equipment_number),0));
 select count(*) into total from public.assets where public.mems_type_key(type)=public.mems_type_key(new.equipment_name) and no::text=public.mems_number_key(new.equipment_number);
 if total<>1 then raise exception 'เพิ่มทะเบียนพร้อมหมายเลขก่อน หรือแก้ทะเบียนซ้ำ'; end if;
 select * into a from public.assets where public.mems_type_key(type)=public.mems_type_key(new.equipment_name) and no::text=public.mems_number_key(new.equipment_number) for share;
 new.equipment_name:=a.type; new.equipment_number:=a.no::text;
 select * into latest from public.borrow_records where public.mems_type_key(equipment_name)=public.mems_type_key(a.type) and public.mems_number_key(equipment_number)=a.no::text and action ~ '(ยืม|คืน|ย้าย)' order by recorded_at desc,id desc limit 1;
 if new.recorded_at < latest.recorded_at then raise exception 'เวลาบันทึกต้องไม่ก่อนธุรกรรมล่าสุดของเครื่อง'; end if;
 if new.action ~ 'ยืม' then
   if a.status is distinct from 'ใช้งานได้' then raise exception 'เครื่องไม่พร้อมใช้'; end if;
   if latest.action ~ '(ยืม|ย้าย)' then raise exception 'เครื่องถูกยืมอยู่'; end if;
   select * into prep from public.prepare_records where status='เตรียม' and public.mems_type_key(equipment_type)=public.mems_type_key(a.type) and public.mems_number_key(equipment_number)=a.no::text order by id limit 1 for update;
   if prep.id is null or prep.ward is distinct from new.ward then raise exception 'เครื่องไม่ได้เตรียมให้หน่วยงานนี้'; end if;
   new.loan_id:=new.id;
 elsif new.action ~ '(คืน|ย้าย)' then
   if latest.id is null or latest.action !~ '(ยืม|ย้าย)' then raise exception 'ไม่มีรอบยืมเปิดอยู่ หรือคืนแล้ว'; end if;
   if new.action ~ 'คืน' and latest.ward is distinct from new.ward then raise exception 'เครื่องอยู่ตึกอื่น กรุณาย้ายตึกก่อน'; end if;
   if new.action ~ 'ย้าย' and latest.ward is not distinct from new.ward then raise exception 'เครื่องอยู่ตึกนี้แล้ว'; end if;
   if new.action ~ 'ย้าย' and new.note is distinct from 'ย้ายจาก '||latest.ward then raise exception 'ตึกผู้ถือเครื่องเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; end if;
   origin:=coalesce(latest.loan_id,case when latest.action ~ 'ยืม' then latest.id end);
   if origin is null then
     select min(r.id) into origin from public.borrow_records r
     where r.action ~ 'ยืม' and public.mems_type_key(r.equipment_name)=public.mems_type_key(a.type)
     and public.mems_number_key(r.equipment_number)=a.no::text
     and (r.recorded_at,r.id)<=(latest.recorded_at,latest.id)
     and not exists(select 1 from public.borrow_records c where c.action ~ 'คืน'
       and public.mems_type_key(c.equipment_name)=public.mems_type_key(a.type)
       and public.mems_number_key(c.equipment_number)=a.no::text
       and (c.recorded_at,c.id)>(r.recorded_at,r.id) and (c.recorded_at,c.id)<=(latest.recorded_at,latest.id))
     having count(*)=1;
   end if;
   new.loan_id:=origin; -- Legacy move without origin stays incomplete, never invent a start.
 end if;
 new.record_date:=(new.recorded_at at time zone 'Asia/Bangkok')::date;
 new.record_time:=(new.recorded_at at time zone 'Asia/Bangkok')::time;
 return new;
end $$;
-- Existing registry/backdate/audit triggers stay installed.
create trigger zz_mems_borrow_guard before insert or update on public.borrow_records for each row execute function private.mems_borrow_guard();
create or replace function public.mark_prepared_used() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.action ~ 'ยืม' then
   update public.prepare_records set status='ยืมแล้ว',borrow_record_id=new.id
   where status='เตรียม' and ward=new.ward
   and public.mems_type_key(equipment_type)=public.mems_type_key(new.equipment_name)
   and public.mems_number_key(equipment_number)=public.mems_number_key(new.equipment_number);
 end if;
 return new;
end $$;

create table public.equipment_requests (
 id uuid primary key, actor_user_id uuid not null default auth.uid(), payload jsonb not null, result jsonb not null
);
alter table public.equipment_requests enable row level security;
revoke all on public.equipment_requests from public,anon,authenticated;
grant select,insert on public.equipment_requests to authenticated;
create policy equipment_requests_own_read on public.equipment_requests for select to authenticated using(actor_user_id=(select auth.uid()) and (select private.is_active_user()));
create policy equipment_requests_own_insert on public.equipment_requests for insert to authenticated with check(actor_user_id=(select auth.uid()) and (select private.is_active_user()));

-- Validate cached acknowledgements against actual rows, even if a client calls the table API.
create or replace function private.mems_verify_request(request_id uuid,payload jsonb,result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare item jsonb; rid bigint; idx int:=0; valid boolean;
begin
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_typeof(result) is distinct from 'array'
   or jsonb_array_length(result)<>jsonb_array_length(payload->'items') or jsonb_array_length(result)=0 then raise exception 'ไม่มีข้อมูลยืนยันการบันทึก'; end if;
 for item in select x from jsonb_array_elements(payload->'items') x loop
   rid:=(result->idx->>'id')::bigint;
   if payload->>'mode'='prepare' then
     select exists(select 1 from public.prepare_records p where p.id=rid and p.request_id=mems_verify_request.request_id and p.actor_user_id=auth.uid() and p.ward=payload->>'ward' and public.mems_type_key(p.equipment_type)=public.mems_type_key(item->>'equipment') and public.mems_number_key(p.equipment_number)=public.mems_number_key(item->>'number')) into valid;
   else
     select exists(select 1 from public.borrow_records r where r.id=rid and r.request_id=mems_verify_request.request_id and r.actor_user_id=auth.uid() and r.ward=payload->>'ward' and r.action ~ case when payload->>'mode'='return' then 'คืน' else 'ยืม' end and public.mems_type_key(r.equipment_name)=public.mems_type_key(item->>'equipment') and public.mems_number_key(r.equipment_number)=public.mems_number_key(item->>'number')) into valid;
   end if;
   if not valid then raise exception 'ไม่พบรายการที่บันทึกจริง หรือรายการถูกแก้ไข/ลบแล้ว กรุณาตรวจประวัติ'; end if;
   idx:=idx+1;
 end loop;
end $$;
create or replace function private.mems_request_guard() returns trigger
language plpgsql security invoker set search_path='' as $$begin
 perform private.mems_verify_request(new.id,new.payload,new.result);return new;
end $$;
create trigger mems_request_guard before insert on public.equipment_requests for each row execute function private.mems_request_guard();
create index mems_borrow_request on public.borrow_records(request_id);
create index mems_prepare_request on public.prepare_records(request_id);

create or replace function public.mems_equipment_batch(request_id uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; cached public.equipment_requests; ids jsonb:='[]'; rid bigint; mode text:=payload->>'mode'; ts timestamptz;
begin
 if auth.uid() is null or not private.is_active_user() then raise exception 'กรุณาเข้าสู่ระบบ' using errcode='42501'; end if;
 if request_id is null or mode is null or mode not in ('prepare','deliver','borrow','return') or jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items')=0 then raise exception 'ข้อมูลไม่ครบ'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,1));
 select * into cached from public.equipment_requests where id=request_id;
 if found then
   if cached.payload<>payload then raise exception 'รหัสบันทึกถูกใช้กับรายการอื่น'; end if;
   perform private.mems_verify_request(request_id,payload,cached.result);
   return cached.result;
 end if;
 if mode<>'prepare' and jsonb_array_length(payload->'items') > (case when not exists(select 1 from jsonb_array_elements(payload->'items') x where public.mems_type_key(x->>'equipment')<>'infusion pump') then 10 else 5 end) then raise exception 'เกินจำนวนสูงสุดต่อครั้ง'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'items') x group by public.mems_type_key(x->>'equipment'),public.mems_number_key(x->>'number') having count(*)>1) then raise exception 'รายการเครื่องซ้ำ'; end if;
 -- Lock every machine in deterministic order before writes; all-or-nothing on error.
 for item in select x from jsonb_array_elements(payload->'items') x order by public.mems_type_key(x->>'equipment'),public.mems_number_key(x->>'number') loop
   perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(item->>'equipment')||'::'||public.mems_number_key(item->>'number'),0));
 end loop;
 ts:=coalesce((payload->>'timestamp')::timestamptz,statement_timestamp());
 for item in select x from jsonb_array_elements(payload->'items') x loop
   if mode in ('prepare','deliver') then
     insert into public.prepare_records(request_id,record_date,record_time,equipment_type,equipment_number,ward,prepared_by,recorded_at,status)
     values(mems_equipment_batch.request_id,(ts at time zone 'Asia/Bangkok')::date,(ts at time zone 'Asia/Bangkok')::time,item->>'equipment',item->>'number',payload->>'ward',payload->>'name',ts,'เตรียม') returning id into rid;
   end if;
   if mode<>'prepare' then
     insert into public.borrow_records(request_id,record_date,record_time,action,equipment_name,equipment_number,ward,staff_name,shift,recorded_at,note)
     values(mems_equipment_batch.request_id,(ts at time zone 'Asia/Bangkok')::date,(ts at time zone 'Asia/Bangkok')::time,case when mode='return' then '🟥 คืน' else '🟩 ยืม' end,item->>'equipment',item->>'number',payload->>'ward',payload->>'name',payload->>'shift',ts,case when mode='deliver' then 'เตรียมพร้อมส่ง (แอดมินนำส่ง)' end) returning id into rid;
   end if;
   ids:=ids||jsonb_build_array(jsonb_build_object('id',rid));
 end loop;
 insert into public.equipment_requests(id,payload,result) values(request_id,payload,ids);
 return ids;
end $$;
revoke all on function public.mems_equipment_batch(uuid,jsonb) from public,anon;
grant execute on function public.mems_equipment_batch(uuid,jsonb) to authenticated;
commit;
