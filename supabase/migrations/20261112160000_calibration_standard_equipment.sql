begin;

create table public.mems_calibration_standard_equipment (
  source_reference text primary key check (char_length(source_reference) between 1 and 200),
  manufacturer text not null check (char_length(btrim(manufacturer)) between 1 and 80),
  model text not null default '' check (char_length(model) <= 80),
  serial_number text not null default '' check (char_length(serial_number) <= 80),
  certificate_no text not null default '' check (char_length(certificate_no) <= 80),
  calibrated_on date,
  due_on date,
  methods text[] not null default '{}',
  check (due_on is null or calibrated_on is null or due_on >= calibrated_on)
);

alter table public.mems_calibration_standard_equipment enable row level security;
revoke all on public.mems_calibration_standard_equipment from public, anon, authenticated;
grant select, insert, update on public.mems_calibration_standard_equipment to authenticated;
grant all on public.mems_calibration_standard_equipment to service_role;
create policy "calibration equipment readers" on public.mems_calibration_standard_equipment
  for select to authenticated using ((select private.has_permission('calibration')));
create policy "calibration equipment inserts" on public.mems_calibration_standard_equipment
  for insert to authenticated with check ((select private.has_permission('calibration')));
create policy "calibration equipment updates" on public.mems_calibration_standard_equipment
  for update to authenticated using ((select private.has_permission('calibration')))
  with check ((select private.has_permission('calibration')));

alter table public.mems_calibrations drop constraint mems_calibrations_standard_reference_check;
alter table public.mems_calibrations add constraint mems_calibrations_standard_reference_check
  check (char_length(standard_reference) <= 2000);

commit;
