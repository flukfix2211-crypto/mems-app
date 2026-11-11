begin;

create table public.mems_calibration_signatories (
  role text primary key check (role in ('tested', 'approved')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 160),
  position text not null check (position = btrim(position) and char_length(position) between 1 and 160),
  signature_data_url text not null check (
    signature_data_url like 'data:image/png;base64,%'
    and char_length(signature_data_url) <= 150000
  ),
  updated_at timestamptz not null default now()
);

alter table public.mems_calibration_signatories enable row level security;
revoke all on public.mems_calibration_signatories from public, anon, authenticated;
grant select, insert, update on public.mems_calibration_signatories to authenticated;
grant all on public.mems_calibration_signatories to service_role;

create policy "calibration signatory readers"
  on public.mems_calibration_signatories
  for select to authenticated
  using ((select private.has_permission('calibration')));

create policy "calibration signatory writers"
  on public.mems_calibration_signatories
  for insert to authenticated
  with check ((select private.has_permission('calibration')));

create policy "calibration signatory updaters"
  on public.mems_calibration_signatories
  for update to authenticated
  using ((select private.has_permission('calibration')))
  with check ((select private.has_permission('calibration')));

commit;
