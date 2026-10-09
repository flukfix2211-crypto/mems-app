create schema if not exists private;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.active = true
      and profile.is_super_admin = true
  );
$$;

revoke all on function private.is_super_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_super_admin() to authenticated;

create table if not exists public.memstag_status (
  id text primary key,
  display_name text not null,
  ble_name text not null,
  ble_mac text not null,
  center_id text not null,
  center_name text not null,
  status text not null check (status in ('present', 'missing')),
  rssi smallint check (rssi between -127 and 20),
  last_seen_at timestamptz,
  center_reported_at timestamptz not null default now(),
  service_data_hex text,
  updated_at timestamptz not null default now()
);

alter table public.memstag_status enable row level security;

drop policy if exists "memstag super admin select" on public.memstag_status;
create policy "memstag super admin select"
on public.memstag_status
for select
to authenticated
using ((select private.is_super_admin()));

revoke all on table public.memstag_status from anon, authenticated;
grant select on table public.memstag_status to authenticated;

insert into public.memstag_status (
  id, display_name, ble_name, ble_mac, center_id, center_name, status,
  rssi, last_seen_at, center_reported_at, service_data_hex, updated_at
)
values (
  'memstag-test01', 'memstag test01', 'Holy-IOT', 'CE:76:04:3F:CE:88',
  'mems-center-01', 'ศูนย์เครื่องมือแพทย์', 'missing', null, null,
  now() - interval '1 day', null, now()
)
on conflict (id) do nothing;
