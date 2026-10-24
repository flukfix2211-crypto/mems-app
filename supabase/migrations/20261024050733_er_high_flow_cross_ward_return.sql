-- ER-held High Flow may be returned by any ward. Transfer rules and permissions stay unchanged.
begin;
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
 select * into a from public.assets where public.mems_type_key(type)=public.mems_type_key(new.equipment_name) and no::text=public.mems_number_key(new.equipment_number);
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
   if new.action ~ 'คืน' and latest.ward is distinct from new.ward
      and not (latest.ward is not distinct from 'ER' and public.mems_type_key(a.type) = 'high flow') then raise exception 'เครื่องอยู่ตึกอื่น กรุณาย้ายตึกก่อน'; end if;
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

commit;
