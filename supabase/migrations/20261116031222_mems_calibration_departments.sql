begin;

create table public.mems_calibration_departments (
  name text primary key check (name = btrim(name) and char_length(name) between 1 and 200)
);

create unique index mems_calibration_departments_name_ci_idx
  on public.mems_calibration_departments (lower(name));

alter table public.mems_calibration_departments enable row level security;
revoke all on public.mems_calibration_departments from public, anon, authenticated;
grant select, insert on public.mems_calibration_departments to authenticated;
grant all on public.mems_calibration_departments to service_role;

create policy "calibration department readers" on public.mems_calibration_departments
  for select to authenticated using ((select private.has_permission('calibration')));

create policy "calibration department writers" on public.mems_calibration_departments
  for insert to authenticated with check ((select private.has_permission('calibration')));

commit;
