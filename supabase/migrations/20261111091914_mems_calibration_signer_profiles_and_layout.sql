begin;

create table public.mems_calibration_signer_profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('tested', 'approved')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  position text not null check (position = btrim(position) and char_length(position) between 1 and 160),
  signature_data_url text not null check (
    signature_data_url like 'data:image/png;base64,%'
    and char_length(signature_data_url) <= 150000
  ),
  updated_at timestamptz not null default now()
);

create table public.mems_calibration_signer_preferences (
  role text primary key check (role in ('tested', 'approved')),
  profile_id uuid not null references public.mems_calibration_signer_profiles(id) on delete restrict,
  offset_x_mm numeric not null default 4.2 check (offset_x_mm between -20 and 20),
  offset_y_mm numeric not null default 0 check (offset_y_mm between -20 and 20),
  updated_at timestamptz not null default now()
);

alter table public.mems_calibration_signer_profiles enable row level security;
revoke all on public.mems_calibration_signer_profiles from public, anon, authenticated;
grant select, insert, update on public.mems_calibration_signer_profiles to authenticated;
grant all on public.mems_calibration_signer_profiles to service_role;

create policy "calibration signer profile readers"
  on public.mems_calibration_signer_profiles
  for select to authenticated
  using ((select private.has_permission('calibration')));

create policy "calibration signer profile writers"
  on public.mems_calibration_signer_profiles
  for insert to authenticated
  with check ((select private.has_permission('calibration')));

create policy "calibration signer profile updaters"
  on public.mems_calibration_signer_profiles
  for update to authenticated
  using ((select private.has_permission('calibration')))
  with check ((select private.has_permission('calibration')));

alter table public.mems_calibration_signer_preferences enable row level security;
revoke all on public.mems_calibration_signer_preferences from public, anon, authenticated;
grant select, insert, update on public.mems_calibration_signer_preferences to authenticated;
grant all on public.mems_calibration_signer_preferences to service_role;

create policy "calibration signer preference readers"
  on public.mems_calibration_signer_preferences
  for select to authenticated
  using ((select private.has_permission('calibration')));

create policy "calibration signer preference writers"
  on public.mems_calibration_signer_preferences
  for insert to authenticated
  with check ((select private.has_permission('calibration')));

create policy "calibration signer preference updaters"
  on public.mems_calibration_signer_preferences
  for update to authenticated
  using ((select private.has_permission('calibration')))
  with check ((select private.has_permission('calibration')));

with migrated as (
  insert into public.mems_calibration_signer_profiles (role, name, position, signature_data_url, updated_at)
  select role, name, position, signature_data_url, updated_at
  from public.mems_calibration_signatories
  returning id, role
)
insert into public.mems_calibration_signer_preferences (role, profile_id, offset_x_mm, offset_y_mm)
select role, id, 4.2, 0 from migrated;

commit;