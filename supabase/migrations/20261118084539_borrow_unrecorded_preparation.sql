-- Record a missed checkout using the existing preparation and loan lifecycle.
create function private.mems_borrow_unrecorded_preparation(preparation_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preparation public.prepare_records;
  loan public.borrow_records;
  actor_id uuid := auth.uid();
  recorded_time timestamptz := statement_timestamp();
  bangkok_time timestamp := recorded_time at time zone 'Asia/Bangkok';
begin
  if actor_id is null or not private.has_permission('prepare') then
    raise exception 'ไม่มีสิทธิ์เตรียมเครื่องมือ' using errcode = '42501';
  end if;

  select * into preparation from public.prepare_records
  where id = preparation_id and status = 'เตรียม';
  if not found then
    raise exception 'รายการเตรียมนี้ไม่อยู่ในสถานะรอยืมแล้ว';
  end if;

  -- Take the equipment lock before any row lock, as in the standard borrow flow.
  perform pg_advisory_xact_lock(hashtextextended(
    public.mems_type_key(preparation.equipment_type) || '::' ||
    public.mems_number_key(preparation.equipment_number), 0));

  perform 1 from public.prepare_records
  where id = preparation_id and status = 'เตรียม'
    and equipment_type = preparation.equipment_type
    and equipment_number = preparation.equipment_number
    and ward = preparation.ward
  for update;
  if not found then
    raise exception 'รายการเตรียมมีการเปลี่ยนแปลง กรุณาโหลดรายการใหม่';
  end if;

  insert into public.borrow_records (
    action, equipment_name, equipment_number, ward, staff_name, shift,
    recorded_at, record_date, record_time, note, actor_user_id
  ) values (
    '🟩 ยืม', preparation.equipment_type, preparation.equipment_number, preparation.ward,
    'ยืมโดยระบบอัตโนมัติ (เนื่องจากผู้ยืมไม่คีย์ยืม)',
    case
      when bangkok_time::time >= time '08:30' and bangkok_time::time < time '16:30' then 'เวรเช้า'
      when bangkok_time::time >= time '16:30' or bangkok_time::time < time '00:30' then 'เวรบ่าย'
      else 'เวรดึก'
    end,
    recorded_time, bangkok_time::date, bangkok_time::time,
    'หน่วยงานนำเครื่องไปไม่คีย์ยืมเครื่อง', actor_id
  ) returning * into loan;

  if not exists (
    select 1 from public.prepare_records
    where id = preparation_id and status = 'ยืมแล้ว' and borrow_record_id = loan.id
  ) then
    raise exception 'เชื่อมรายการเตรียมกับรายการยืมไม่สำเร็จ';
  end if;

  return jsonb_build_object(
    'id', loan.id, 'action', loan.action, 'equipment_name', loan.equipment_name,
    'equipment_number', loan.equipment_number, 'ward', loan.ward, 'staff_name', loan.staff_name,
    'shift', loan.shift, 'recorded_at', loan.recorded_at,
    'record_date', loan.record_date, 'record_time', loan.record_time
  );
end;
$$;

revoke all on function private.mems_borrow_unrecorded_preparation(bigint) from public, anon, authenticated;
grant execute on function private.mems_borrow_unrecorded_preparation(bigint) to authenticated;

create function public.mems_borrow_unrecorded_preparation(preparation_id bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.mems_borrow_unrecorded_preparation(preparation_id);
$$;

revoke all on function public.mems_borrow_unrecorded_preparation(bigint) from public, anon, authenticated;
grant execute on function public.mems_borrow_unrecorded_preparation(bigint) to authenticated;
