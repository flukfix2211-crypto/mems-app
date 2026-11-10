begin;

alter table public.mems_calibration_tools
  drop constraint if exists mems_calibration_tools_method_check;
alter table public.mems_calibration_tools
  add constraint mems_calibration_tools_method_check check (method in (
    'general', 'refrig', 'infusion', 'flowmeter', 'suction', 'regulator', 'blood-pressure',
    'manual-bp', 'digital-bp', 'ambient', 'weight-adult', 'weight-general', 'weight-neo',
    'centrifuge', 'hematocrit', 'rotator', 'serofuge', 'alarm', 'syringe'
  ));

alter table public.mems_calibrations
  drop constraint if exists mems_calibrations_method_check;
alter table public.mems_calibrations
  add constraint mems_calibrations_method_check check (method in (
    'general', 'refrig', 'infusion', 'flowmeter', 'suction', 'regulator', 'blood-pressure',
    'manual-bp', 'digital-bp', 'ambient', 'weight-adult', 'weight-general', 'weight-neo',
    'centrifuge', 'hematocrit', 'rotator', 'serofuge', 'alarm', 'syringe'
  ));

create or replace function private.prepare_mems_calibration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tool public.mems_calibration_tools%rowtype;
  sheet jsonb;
  reading jsonb;
  item jsonb;
begin
  select * into tool from public.mems_calibration_tools where id = new.tool_id;
  if not found then
    raise exception 'กรุณาเลือกเครื่องมือจากทะเบียนสอบเทียบ' using errcode = '23514';
  end if;
  new.method := tool.method;
  new.department := tool.department;
  new.equipment_type := case tool.method
    when 'general' then 'General Thermometer'
    when 'refrig' then 'Refrig. Thermometer'
    when 'infusion' then 'Infusion Pump'
    when 'flowmeter' then 'Flowmeter'
    when 'suction' then 'Suction'
    when 'regulator' then 'Regulator'
    when 'blood-pressure' then 'Blood Pressure'
    when 'manual-bp' then 'Manual Blood Pressure'
    when 'digital-bp' then 'Digital Blood Pressure'
    when 'ambient' then 'Ambient Thermometer'
    when 'weight-adult' then 'Weighting Machine (Adult)'
    when 'weight-general' then 'Weighting Machine (General)'
    when 'weight-neo' then 'Weighting Machine (Neo)'
    when 'centrifuge' then 'Centrifuge'
    when 'hematocrit' then 'Hematocrit'
    when 'rotator' then 'Rotator'
    when 'serofuge' then 'SEROFUGE'
    when 'alarm' then 'Alarm Clock'
    when 'syringe' then 'Syringe Pump'
  end;
  new.asset_snapshot := jsonb_build_object('id', tool.id, 'type', new.equipment_type, 'name', tool.name,
    'tool_code', tool.tool_code, 'inventory_no', tool.inventory_no, 'manufacturer', tool.manufacturer,
    'model', tool.model, 'serial_number', tool.serial_number);

  if jsonb_typeof(new.measurements) is distinct from 'array' then
    raise exception 'ข้อมูลการวัดต้องเป็นรายการพารามิเตอร์' using errcode = '23514';
  end if;
  if jsonb_array_length(new.measurements) <> (case
    when new.method = 'digital-bp' then 5
    when new.method in ('infusion', 'syringe', 'centrifuge', 'hematocrit', 'rotator', 'serofuge') then 2
    else 1 end) then
    raise exception 'จำนวนพารามิเตอร์ไม่ตรงกับวิธีสอบเทียบ' using errcode = '23514';
  end if;
  for sheet in select value from jsonb_array_elements(new.measurements) loop
    if jsonb_typeof(sheet->'unit') is distinct from 'string'
      or char_length(btrim(sheet->>'unit')) not between 1 and 12
      or jsonb_typeof(sheet->'rows') is distinct from 'array'
      or jsonb_typeof(sheet->'budget') is distinct from 'array' then
      raise exception 'ข้อมูลหน่วย จุดวัด หรือ UCB ไม่ครบ' using errcode = '23514';
    end if;
    if jsonb_array_length(sheet->'rows') not between 1 and 100 or jsonb_array_length(sheet->'budget') <> 4 then
      raise exception 'ระบุ 1–100 จุดวัดและ UCB 4 ค่าในแต่ละพารามิเตอร์' using errcode = '23514';
    end if;
    for item in select value from jsonb_array_elements(sheet->'budget') loop
      if jsonb_typeof(item) <> 'number' then
        raise exception 'UCB ต้องเป็นตัวเลข' using errcode = '23514';
      end if;
      if item::numeric < 0 then
        raise exception 'UCB ต้องไม่ติดลบ' using errcode = '23514';
      end if;
    end loop;
    for reading in select value from jsonb_array_elements(sheet->'rows') loop
      if jsonb_typeof(reading) <> 'array' or jsonb_array_length(reading) <> 8 then
        raise exception 'รูปแบบจุดวัดไม่ถูกต้อง' using errcode = '23514';
      end if;
      if jsonb_typeof(reading->0) <> 'number' or jsonb_typeof(reading->1) <> 'number'
        or jsonb_typeof(reading->3) <> 'number' or jsonb_typeof(reading->5) <> 'number'
        or jsonb_typeof(reading->7) <> 'number' then
        raise exception 'กรอกจุดทดสอบ STD และค่าที่เครื่องอ่านครบ 3 รอบ' using errcode = '23514';
      end if;
      if not ((jsonb_typeof(reading->2) = 'number' and jsonb_typeof(reading->4) = 'number' and jsonb_typeof(reading->6) = 'number')
        or (new.method not in ('general', 'ambient') and reading->2 = 'null' and reading->4 = 'null' and reading->6 = 'null')) then
        raise exception 'ค่ามาตรฐานต้องกรอกครบ 3 รอบ หรือเว้นทั้ง 3 รอบสำหรับวิธีที่รองรับ' using errcode = '23514';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

revoke all on function private.prepare_mems_calibration() from public, anon, authenticated;

commit;
