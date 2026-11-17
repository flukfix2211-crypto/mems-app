begin;
create table public.equipment_return_checks (
 return_id bigint primary key references public.borrow_records(id),
 confirmed_by text,
 confirmed_user_id uuid references auth.users(id),
 confirmed_at timestamptz,
 constraint return_check_signature check (
   (confirmed_by is null and confirmed_user_id is null and confirmed_at is null) or
   (nullif(btrim(confirmed_by),'') is not null and confirmed_user_id is not null and confirmed_at is not null))
);
create index equipment_return_checks_pending on public.equipment_return_checks(return_id) where confirmed_at is null;
create index equipment_return_checks_user on public.equipment_return_checks(confirmed_user_id);
alter table public.equipment_return_checks enable row level security;
revoke all on public.equipment_return_checks from public,anon,authenticated;
grant select,insert on public.equipment_return_checks to authenticated;
grant update(confirmed_by) on public.equipment_return_checks to authenticated;
create policy return_checks_read on public.equipment_return_checks for select to authenticated
 using ((select private.is_active_user()));
create policy return_checks_insert on public.equipment_return_checks for insert to authenticated
 with check ((select private.is_active_user()) and confirmed_at is null);
create policy return_checks_confirm on public.equipment_return_checks for update to authenticated
 using ((select private.has_permission('prepare')))
 with check ((select private.has_permission('prepare')) and confirmed_user_id=(select auth.uid()));

create function private.mems_return_check_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
   if pg_trigger_depth()<2 or not exists(select 1 from public.borrow_records where id=new.return_id and action ~ 'คืน') then
     raise exception 'สร้างรายการตรวจรับจากการคืนเครื่องเท่านั้น';
   end if;
   new.confirmed_by:=null; new.confirmed_at:=null; new.confirmed_user_id:=null;
 else
   if auth.uid() is null or not private.has_permission('prepare') then raise exception 'ไม่มีสิทธิ์ตรวจรับเครื่อง' using errcode='42501'; end if;
   if old.confirmed_at is not null then raise exception 'ยืนยันรับคืนแล้ว กรุณาโหลดรายการใหม่'; end if;
   if new.return_id is distinct from old.return_id or nullif(btrim(new.confirmed_by),'') is null then raise exception 'กรุณาลงชื่อเจ้าหน้าที่ผู้ตรวจรับ'; end if;
   new.confirmed_by:=btrim(new.confirmed_by);
   new.confirmed_at:=statement_timestamp(); new.confirmed_user_id:=auth.uid();
 end if;
 return new;
end $$;
create trigger mems_return_check_guard before insert or update on public.equipment_return_checks
 for each row execute function private.mems_return_check_guard();
create function private.mems_queue_return() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.action ~ 'คืน' then insert into public.equipment_return_checks(return_id) values(new.id); end if;
 return new;
end $$;
create trigger mems_queue_return after insert on public.borrow_records for each row execute function private.mems_queue_return();

create function private.mems_require_return_check() returns trigger
language plpgsql security invoker set search_path='' as $$
declare eq text; num text;
begin
 if tg_table_name='prepare_records' then eq:=new.equipment_type; num:=new.equipment_number;
 elsif new.action ~ 'ยืม' then eq:=new.equipment_name; num:=new.equipment_number;
 else return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(eq)||'::'||public.mems_number_key(num),0));
 if exists(select 1 from public.equipment_return_checks c join public.borrow_records r on r.id=c.return_id
   where c.confirmed_at is null and public.mems_type_key(r.equipment_name)=public.mems_type_key(eq)
   and public.mems_number_key(r.equipment_number)=public.mems_number_key(num)) then
   raise exception 'เครื่องรอตรวจและยืนยันการคืน กรุณาให้เจ้าหน้าที่ตรวจรับก่อนเตรียมหรือยืม';
 end if;
 return new;
end $$;
create trigger mems_require_return_check before insert on public.prepare_records for each row execute function private.mems_require_return_check();
create trigger mems_require_return_check before insert on public.borrow_records for each row execute function private.mems_require_return_check();

create function public.mems_confirm_equipment_return(p_return_id bigint,p_name text) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.borrow_records;
begin
 if auth.uid() is null or not private.has_permission('prepare') then raise exception 'ไม่มีสิทธิ์ตรวจรับเครื่อง' using errcode='42501'; end if;
 if nullif(btrim(p_name),'') is null then raise exception 'กรุณาลงชื่อเจ้าหน้าที่ผู้ตรวจรับ'; end if;
 select * into r from public.borrow_records where id=p_return_id and action ~ 'คืน';
 if not found then raise exception 'ไม่พบรายการคืนเครื่อง'; end if;
 perform pg_advisory_xact_lock(hashtextextended(public.mems_type_key(r.equipment_name)||'::'||public.mems_number_key(r.equipment_number),0));
 update public.equipment_return_checks set confirmed_by=p_name where return_id=p_return_id and confirmed_at is null;
 if not found then raise exception 'ยืนยันรับคืนแล้ว หรือไม่พบรายการ กรุณาโหลดรายการใหม่'; end if;
end $$;
revoke all on function public.mems_confirm_equipment_return(bigint,text) from public,anon;
grant execute on function public.mems_confirm_equipment_return(bigint,text) to authenticated;

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
 having count(*)=1) as borrow_started_at,
 exists(select 1 from public.equipment_return_checks c where c.return_id=b.id and c.confirmed_at is null) as is_return_pending
 from public.borrow_records b
 where equipment_name is not null and nullif(public.mems_number_key(equipment_number),'') is not null
 and action ~ '(ยืม|คืน|ย้าย)'
 order by public.mems_type_key(equipment_name),public.mems_number_key(equipment_number),recorded_at desc,id desc;


create or replace function public.mems_equipment_batch(request_id uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; cached public.equipment_requests; ids jsonb:='[]'; rid bigint; mode text:=payload->>'mode'; ts timestamptz; holder public.borrow_records; confirmation jsonb;
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
     select * into holder from public.borrow_records
     where public.mems_type_key(equipment_name)=public.mems_type_key(item->>'equipment')
       and public.mems_number_key(equipment_number)=public.mems_number_key(item->>'number')
       and action ~ '(ยืม|คืน|ย้าย)' order by recorded_at desc,id desc limit 1;
     if holder.action ~ '(ยืม|ย้าย)' then
       if not private.has_permission('prepare') then raise exception 'ไม่มีสิทธิ์เตรียมเครื่อง' using errcode='42501'; end if;
       select x into confirmation from jsonb_array_elements(coalesce(payload->'unreturned','[]'::jsonb)) x
       where public.mems_type_key(x->>'equipment')=public.mems_type_key(item->>'equipment')
         and public.mems_number_key(x->>'number')=public.mems_number_key(item->>'number');
       if confirmation is null or confirmation->>'ward' is distinct from holder.ward
          or (confirmation->>'lastUpdate')::timestamptz is distinct from holder.recorded_at then
         raise exception 'สถานะยืมเปลี่ยนแล้ว กรุณาโหลดข้อมูลและยืนยันคืนเครื่องอีกครั้ง';
       end if;
       insert into public.borrow_records(record_date,record_time,action,equipment_name,equipment_number,ward,staff_name,shift,recorded_at,note)
       values((ts at time zone 'Asia/Bangkok')::date,(ts at time zone 'Asia/Bangkok')::time,'🟥 คืน',item->>'equipment',item->>'number',holder.ward,payload->>'name',payload->>'shift',ts,'หน่วยงาน '||holder.ward||' ไม่คีย์คืนเครื่อง') returning id into rid;
       perform public.mems_confirm_equipment_return(rid,payload->>'name');
     end if;
   end if;
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
