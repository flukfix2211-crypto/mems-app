begin;

alter table public.mems_calibration_standard_equipment
  add column removed boolean not null default false;

drop policy "calibration equipment inserts" on public.mems_calibration_standard_equipment;
drop policy "calibration equipment updates" on public.mems_calibration_standard_equipment;

create policy "calibration equipment admin inserts" on public.mems_calibration_standard_equipment
  for insert to authenticated with check (
    exists (select 1 from public.user_profiles p
      where p.id = (select auth.uid()) and p.active and p.role = 'admin')
  );

create policy "calibration equipment admin updates" on public.mems_calibration_standard_equipment
  for update to authenticated using (
    exists (select 1 from public.user_profiles p
      where p.id = (select auth.uid()) and p.active and p.role = 'admin')
  ) with check (
    exists (select 1 from public.user_profiles p
      where p.id = (select auth.uid()) and p.active and p.role = 'admin')
  );

commit;
