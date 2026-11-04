begin;
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
       values((ts at time zone 'Asia/Bangkok')::date,(ts at time zone 'Asia/Bangkok')::time,'🟥 คืน',item->>'equipment',item->>'number',holder.ward,payload->>'name',payload->>'shift',ts,'หน่วยงาน '||holder.ward||' ไม่คีย์คืนเครื่อง');
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
