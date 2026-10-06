create table if not exists public.app_settings (
  id text primary key,
  bool_value boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.app_settings is 'Global MEMs application feature settings';
comment on column public.app_settings.id is 'Stable setting key';
comment on column public.app_settings.bool_value is 'Boolean setting value';

alter table public.app_settings enable row level security;

grant select, insert, update on table public.app_settings to authenticated;

insert into public.app_settings (id, bool_value)
values ('qr_scanner_enabled', true)
on conflict (id) do nothing;

drop policy if exists "authenticated users read app settings" on public.app_settings;
create policy "authenticated users read app settings"
on public.app_settings
for select
to authenticated
using (true);

drop policy if exists "super admins insert app settings" on public.app_settings;
create policy "super admins insert app settings"
on public.app_settings
for insert
to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.active
      and profile.is_super_admin
  )
);

drop policy if exists "super admins update app settings" on public.app_settings;
create policy "super admins update app settings"
on public.app_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.active
      and profile.is_super_admin
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.user_profiles profile
    where profile.id = (select auth.uid())
      and profile.active
      and profile.is_super_admin
  )
);
