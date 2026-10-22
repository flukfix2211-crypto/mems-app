begin;
alter table public.user_profiles add column can_transfer_ward boolean not null default false;
-- Enable the primary administrator initially; all other accounts require opt-in.
update public.user_profiles set can_transfer_ward = true where is_super_admin is true;
comment on column public.user_profiles.can_transfer_ward is 'Explicit ward-transfer permission, independent of role and page access';

-- Invoker reads only the caller's own profile under existing profile SELECT RLS.
-- No new profile write grants/policies: only the existing super-admin Edge function can edit it.
create function private.guard_ward_transfer_permission()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.action like '%ย้าย%' and not exists (
    select 1 from public.user_profiles p
    where p.id = (select auth.uid()) and p.active and p.can_transfer_ward
      and (p.role = 'admin' or 'borrow' = any(p.permissions) or 'dashboard' = any(p.permissions))
  ) then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์ย้ายวอร์ดเครื่องมือ' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_ward_transfer_permission() from public;
create trigger borrow_records_transfer_permission
before insert or update of action, ward, equipment_name, equipment_number
on public.borrow_records for each row execute function private.guard_ward_transfer_permission();
commit;
