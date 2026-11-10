begin;

create table public.mems_calibration_tools (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('general', 'refrig', 'infusion',
    'flowmeter', 'suction', 'regulator', 'blood-pressure', 'ambient', 'weight-adult', 'weight-general', 'weight-neo', 'centrifuge', 'hematocrit', 'rotator', 'serofuge', 'alarm', 'syringe')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  department text not null check (department = btrim(department) and char_length(department) between 1 and 200),
  tool_code text not null check (tool_code = btrim(tool_code) and char_length(tool_code) between 1 and 100),
  inventory_no text not null default '' check (char_length(inventory_no) <= 100),
  manufacturer text not null default '' check (char_length(manufacturer) <= 100),
  model text not null default '' check (char_length(model) <= 100),
  serial_number text not null default '' check (char_length(serial_number) <= 100),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index mems_calibration_tools_code_idx on public.mems_calibration_tools (lower(tool_code));

alter table public.mems_calibration_tools enable row level security;
revoke all on public.mems_calibration_tools from public, anon, authenticated;
grant select on public.mems_calibration_tools to authenticated;
grant insert (method, name, department, tool_code, inventory_no, manufacturer, model, serial_number)
  on public.mems_calibration_tools to authenticated;
grant all on public.mems_calibration_tools to service_role;

create policy "calibration registry readers" on public.mems_calibration_tools
  for select to authenticated using ((select private.has_permission('calibration')));

create policy "calibration registry writers" on public.mems_calibration_tools
  for insert to authenticated with check (
    (select private.has_permission('calibration')) and created_by = (select auth.uid())
  );

create table public.mems_calibrations (
  id uuid primary key,
  tool_id uuid not null references public.mems_calibration_tools(id),
  asset_snapshot jsonb not null,
  equipment_type text not null,
  department text not null check (department = btrim(department) and char_length(department) between 1 and 200),
  calibrated_on date not null check (calibrated_on between date '2000-01-01' and date '2100-12-31'),
  certificate_no text not null check (certificate_no = btrim(certificate_no) and char_length(certificate_no) between 1 and 80),
  method text not null check (method in ('general', 'refrig', 'infusion',
    'flowmeter', 'suction', 'regulator', 'blood-pressure', 'ambient', 'weight-adult', 'weight-general', 'weight-neo', 'centrifuge', 'hematocrit', 'rotator', 'serofuge', 'alarm', 'syringe')),
  operator_name text not null check (operator_name = btrim(operator_name) and char_length(operator_name) between 1 and 160),
  standard_reference text not null default '' check (char_length(standard_reference) <= 200),
  ambient_temperature double precision check (ambient_temperature > '-Infinity'::double precision and ambient_temperature < 'Infinity'::double precision),
  relative_humidity double precision check (relative_humidity between 0 and 100),
  notes text not null default '' check (char_length(notes) <= 1000),
  search_text text generated always as (
    certificate_no || ' ' || coalesce(asset_snapshot->>'tool_code', '') || ' ' ||
    coalesce(asset_snapshot->>'inventory_no', '') || ' ' || coalesce(asset_snapshot->>'name', '')
  ) stored,
  formula_version text not null default 'cal1-v1',
  measurements jsonb not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index mems_calibrations_history_idx on public.mems_calibrations (calibrated_on desc, id desc);
create index mems_calibrations_department_idx on public.mems_calibrations (department, calibrated_on desc, id desc);
create index mems_calibrations_type_idx on public.mems_calibrations (equipment_type, calibrated_on desc, id desc);
create index mems_calibrations_tool_idx on public.mems_calibrations (tool_id);

create function private.prepare_mems_calibration()
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
  if jsonb_array_length(new.measurements) <> (case when new.method in ('infusion', 'syringe', 'centrifuge', 'hematocrit', 'rotator', 'serofuge') then 2 else 1 end) then
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
      if jsonb_typeof(reading) <> 'array' then
        raise exception 'รูปแบบจุดวัดไม่ถูกต้อง' using errcode = '23514';
      end if;
      if jsonb_array_length(reading) <> 8 then
        raise exception 'จำนวนช่องในจุดวัดไม่ถูกต้อง' using errcode = '23514';
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

create trigger mems_calibration_prepare
  before insert on public.mems_calibrations
  for each row execute function private.prepare_mems_calibration();

alter table public.mems_calibrations enable row level security;
revoke all on public.mems_calibrations from public, anon, authenticated;
grant select on public.mems_calibrations to authenticated;
grant insert (id, tool_id, calibrated_on, certificate_no, operator_name, standard_reference,
  ambient_temperature, relative_humidity, notes, measurements)
  on public.mems_calibrations to authenticated;
grant all on public.mems_calibrations to service_role;

create policy "calibration readers" on public.mems_calibrations
  for select to authenticated using ((select private.has_permission('calibration')));

create policy "calibration writers" on public.mems_calibrations
  for insert to authenticated with check (
    (select private.has_permission('calibration')) and created_by = (select auth.uid())
  );

create function public.mems_calibration_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'departments', coalesce(jsonb_agg(distinct department order by department), '[]'::jsonb),
    'equipment_types', coalesce(jsonb_agg(distinct equipment_type order by equipment_type), '[]'::jsonb)
  )
  from public.mems_calibrations;
$$;

revoke all on function public.mems_calibration_filter_options() from public, anon, authenticated;
grant execute on function public.mems_calibration_filter_options() to authenticated, service_role;

commit;
