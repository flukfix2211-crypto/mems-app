begin;
insert into public.app_settings(id,bool_value) values('return_receipt_enabled',true) on conflict(id) do nothing;
create function public.mems_return_receipt_enabled() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select bool_value from public.app_settings where id='return_receipt_enabled'),true)
$$;
revoke all on function public.mems_return_receipt_enabled() from public,anon;
grant execute on function public.mems_return_receipt_enabled() to authenticated;
create or replace function private.mems_queue_return() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not public.mems_return_receipt_enabled() then return new; end if;
 if new.action ~ 'คืน' then insert into public.equipment_return_checks(return_id) values(new.id); end if;
 return new;
end $$;
create or replace function private.mems_require_return_check() returns trigger
language plpgsql security invoker set search_path='' as $$
declare eq text; num text;
begin
 if not public.mems_return_receipt_enabled() then return new; end if;
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
 public.mems_return_receipt_enabled() and exists(select 1 from public.equipment_return_checks c join public.borrow_records pending on pending.id=c.return_id where public.mems_type_key(pending.equipment_name)=public.mems_type_key(b.equipment_name) and public.mems_number_key(pending.equipment_number)=public.mems_number_key(b.equipment_number) and c.confirmed_at is null) as is_return_pending
 from public.borrow_records b
 where equipment_name is not null and nullif(public.mems_number_key(equipment_number),'') is not null
 and action ~ '(ยืม|คืน|ย้าย)'
 order by public.mems_type_key(equipment_name),public.mems_number_key(equipment_number),recorded_at desc,id desc;


commit;
