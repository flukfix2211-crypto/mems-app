begin;

alter table public.mems_calibration_tools
  drop constraint if exists mems_calibration_tools_method_check;
alter table public.mems_calibration_tools
  add constraint mems_calibration_tools_method_check check (method in (
    'general', 'refrig', 'infusion', 'flowmeter', 'suction', 'regulator', 'blood-pressure',
    'manual-bp', 'digital-bp', 'nibp', 'ambient', 'weight-adult', 'weight-general', 'weight-neo',
    'centrifuge', 'hematocrit', 'rotator', 'serofuge', 'alarm', 'syringe',
    'amalgamator', 'anaesthesia-machine', 'anaesthesia-vaporizer', 'analytical-balance',
    'blood-bank', 'defibrillator', 'doptone', 'drainage-suction', 'dry-bath', 'ekg',
    'electrosurgical-unit', 'fetal-monitor', 'freeze-bank', 'heart-rate', 'hypo-hyperthermia',
    'incubator', 'infant-incubator', 'infant-warmer', 'julse', 'pacer', 'pack-heater',
    'parafine-bath', 'patient-monitor', 'patient-thermometer', 'pulse-oxymeter',
    'radiant-warmer', 'steam-incubator', 'tourniquet', 'traction', 'ultrasound',
    'ultrasound-therapeutic', 'vacuum', 'ventilator', 'water-bath', 'x-ray',
    'x-ray-variant', 'x-ray-mas-alt', 'x-ray-dental', 'x-ray-mas'
  ));

alter table public.mems_calibrations
  drop constraint if exists mems_calibrations_method_check;
alter table public.mems_calibrations
  add constraint mems_calibrations_method_check check (method in (
    'general', 'refrig', 'infusion', 'flowmeter', 'suction', 'regulator', 'blood-pressure',
    'manual-bp', 'digital-bp', 'nibp', 'ambient', 'weight-adult', 'weight-general', 'weight-neo',
    'centrifuge', 'hematocrit', 'rotator', 'serofuge', 'alarm', 'syringe',
    'amalgamator', 'anaesthesia-machine', 'anaesthesia-vaporizer', 'analytical-balance',
    'blood-bank', 'defibrillator', 'doptone', 'drainage-suction', 'dry-bath', 'ekg',
    'electrosurgical-unit', 'fetal-monitor', 'freeze-bank', 'heart-rate', 'hypo-hyperthermia',
    'incubator', 'infant-incubator', 'infant-warmer', 'julse', 'pacer', 'pack-heater',
    'parafine-bath', 'patient-monitor', 'patient-thermometer', 'pulse-oxymeter',
    'radiant-warmer', 'steam-incubator', 'tourniquet', 'traction', 'ultrasound',
    'ultrasound-therapeutic', 'vacuum', 'ventilator', 'water-bath', 'x-ray',
    'x-ray-variant', 'x-ray-mas-alt', 'x-ray-dental', 'x-ray-mas'
  ));


insert into public.mems_calibration_standards (method, standard_reference, source_note)
values
  ('infusion', 'Infusion Analyzer · S/N 3749056 · Cert MMP-0063-26', 'Infusion workbook · exact traceability entry for tool 104450; example readings are not imported.'),
  ('nibp', 'Vital sign simulator · S/N 3240040 · Cert MMP-0061-26', 'NIBP workbook · exact traceability entry for tool 137309; example readings are not imported.')
on conflict (method) do update set
  standard_reference = excluded.standard_reference,
  source_note = excluded.source_note,
  updated_at = now();
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
    when 'nibp' then 'NIBP'
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
    when 'amalgamator' then 'Amalgamator'
    when 'anaesthesia-machine' then 'Anaesthesia (Machine)'
    when 'anaesthesia-vaporizer' then 'Anaesthesia (Vapourizer)'
    when 'analytical-balance' then 'Analytical Balance'
    when 'blood-bank' then 'Blood Bank'
    when 'defibrillator' then 'Defiblillator'
    when 'doptone' then 'Doptone'
    when 'drainage-suction' then 'Drainage Suction'
    when 'dry-bath' then 'Dry Bath'
    when 'ekg' then 'EKG'
    when 'electrosurgical-unit' then 'Electrosurgical Unit'
    when 'fetal-monitor' then 'Fetal monitor'
    when 'freeze-bank' then 'Freeze Bank'
    when 'heart-rate' then 'Heart rate'
    when 'hypo-hyperthermia' then 'Hypo-hyperthermia unit'
    when 'incubator' then 'Incubator'
    when 'infant-incubator' then 'Infant Incubator'
    when 'infant-warmer' then 'Infant Warmer'
    when 'julse' then 'Julse'
    when 'pacer' then 'Pacer'
    when 'pack-heater' then 'Pack Heater'
    when 'parafine-bath' then 'Parafine Bath'
    when 'patient-monitor' then 'PATIENT MONITOR'
    when 'patient-thermometer' then 'Patient Thermometer'
    when 'pulse-oxymeter' then 'Pulse Oxymeter'
    when 'radiant-warmer' then 'Radiant Warmer'
    when 'steam-incubator' then 'Steam Incubator'
    when 'tourniquet' then 'Tourniquet'
    when 'traction' then 'Traction'
    when 'ultrasound' then 'Ultrasound'
    when 'ultrasound-therapeutic' then 'Ultrasound Therapeutic'
    when 'vacuum' then 'Vacuum'
    when 'ventilator' then 'Ventilator'
    when 'water-bath' then 'Water bath'
    when 'x-ray' then 'X-RAY'
    when 'x-ray-variant' then 'X-RAY -'
    when 'x-ray-mas-alt' then 'X-RAY  (MAS)'
    when 'x-ray-dental' then 'X-RAY (DENTAL)'
    when 'x-ray-mas' then 'X-RAY (MAS)'
    else new.equipment_type
  end;
  new.asset_snapshot := jsonb_build_object('id', tool.id, 'type', new.equipment_type, 'name', tool.name,
    'tool_code', tool.tool_code, 'inventory_no', tool.inventory_no, 'manufacturer', tool.manufacturer,
    'model', tool.model, 'serial_number', tool.serial_number);

  if jsonb_typeof(new.measurements) is distinct from 'array' then
    raise exception 'ข้อมูลการวัดต้องเป็นรายการพารามิเตอร์' using errcode = '23514';
  end if;
  if jsonb_array_length(new.measurements) <> (case
    when new.method = 'digital-bp' then 5
    when new.method = 'nibp' then 3
    when new.method in ('infusion', 'syringe', 'centrifuge', 'hematocrit', 'rotator', 'serofuge') then 2
    when new.method in ('defibrillator') then 3
    when new.method = 'ekg' then 3
    when new.method in ('pulse-oxymeter', 'radiant-warmer') then 2
    when new.method = 'fetal-monitor' then 2
    when new.method = 'infant-incubator' then 3
    when new.method = 'patient-monitor' then 5
    when new.method = 'ventilator' then 4
    when new.method in ('x-ray', 'x-ray-variant', 'x-ray-mas-alt', 'x-ray-dental', 'x-ray-mas') then 4
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
      if new.method = 'infusion' then
        if jsonb_typeof(reading->0) <> 'number' or jsonb_typeof(reading->1) <> 'number'
          or jsonb_typeof(reading->2) <> 'number' or jsonb_typeof(reading->4) <> 'number'
          or reading->3 <> 'null' or reading->5 <> 'null' or reading->6 <> 'null' or reading->7 <> 'null' then
          raise exception 'Infusion Pump ต้องระบุ UUC setting และ Standard Reading 2 รอบ' using errcode = '23514';
        end if;
      elsif new.method = 'nibp' then
        if jsonb_typeof(reading->0) <> 'number' or jsonb_typeof(reading->1) <> 'number'
          or jsonb_typeof(reading->3) <> 'number' or jsonb_typeof(reading->5) <> 'number'
          or jsonb_typeof(reading->7) <> 'number'
          or reading->2 <> 'null' or reading->4 <> 'null' or reading->6 <> 'null' then
          raise exception 'NIBP ต้องระบุค่า STD และค่าที่เครื่องอ่านครบ 3 รอบ' using errcode = '23514';
        end if;
      else
        if jsonb_typeof(reading->0) <> 'number' or jsonb_typeof(reading->1) <> 'number'
          or jsonb_typeof(reading->3) <> 'number' or jsonb_typeof(reading->5) <> 'number'
          or jsonb_typeof(reading->7) <> 'number' then
          raise exception 'กรอกจุดทดสอบ STD และค่าที่เครื่องอ่านครบ 3 รอบ' using errcode = '23514';
        end if;
        if not ((jsonb_typeof(reading->2) = 'number' and jsonb_typeof(reading->4) = 'number' and jsonb_typeof(reading->6) = 'number')
          or (new.method not in ('general', 'ambient') and reading->2 = 'null' and reading->4 = 'null' and reading->6 = 'null')) then
          raise exception 'ค่ามาตรฐานต้องกรอกครบ 3 รอบ หรือเว้นทั้ง 3 ช่องเมื่อใช้ STD' using errcode = '23514';
        end if;
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

revoke all on function private.prepare_mems_calibration() from public, anon, authenticated;

commit;
