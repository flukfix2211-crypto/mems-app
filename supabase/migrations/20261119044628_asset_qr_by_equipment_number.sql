begin;

-- Legacy labels contain the original row ID. Keep their printed identity
-- independently of the lifetime of that row.
create table private.asset_qr_legacy (
  legacy_id bigint primary key,
  equipment_type text not null,
  equipment_no integer not null
);
alter table private.asset_qr_legacy enable row level security;
revoke all on private.asset_qr_legacy from public, anon, authenticated;
grant select on private.asset_qr_legacy to authenticated;
create policy read_asset_qr_legacy on private.asset_qr_legacy
  for select to authenticated using (true);

create function private.mems_remember_asset_qr() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.no is not null and nullif(public.mems_type_key(old.type), '') is not null then
    insert into private.asset_qr_legacy values (old.id, public.mems_type_key(old.type), old.no)
    on conflict (legacy_id) do nothing;
  end if;
  if tg_op <> 'DELETE' and new.no is not null and nullif(public.mems_type_key(new.type), '') is not null then
    insert into private.asset_qr_legacy values (new.id, public.mems_type_key(new.type), new.no)
    on conflict (legacy_id) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function private.mems_remember_asset_qr() from public, anon, authenticated;

-- Keep the live registry snapshot and trigger installation consistent.
lock table public.assets in share row exclusive mode;
insert into private.asset_qr_legacy (legacy_id, equipment_type, equipment_no)
select id, public.mems_type_key(type), no
from public.assets
where no is not null and nullif(public.mems_type_key(type), '') is not null;

-- For IDs already deleted, restore only identities with one recorded pair.
with snapshots as (
  select l.row_id, s.asset
  from public.audit_log l
  cross join lateral (values (l.old_data), (l.new_data)) s(asset)
  where l.table_name = 'assets'
), identities as (
  select (s.asset->>'id')::bigint as legacy_id,
         public.mems_type_key(s.asset->>'type') as equipment_type,
         case when (s.asset->>'no')::bigint between -2147483648 and 2147483647
           then (s.asset->>'no')::integer end as equipment_no
  from snapshots s
  where s.asset->>'id' = s.row_id and s.row_id ~ '^[0-9]{1,18}$'
    and s.asset->>'no' ~ '^-?[0-9]{1,10}$'
    and nullif(public.mems_type_key(s.asset->>'type'), '') is not null
)
insert into private.asset_qr_legacy (legacy_id, equipment_type, equipment_no)
select i.legacy_id, min(i.equipment_type), min(i.equipment_no)
from identities i
where i.equipment_no is not null
  and not exists (select 1 from public.assets a where a.id = i.legacy_id)
group by i.legacy_id
having count(distinct (i.equipment_type, i.equipment_no)) = 1
on conflict (legacy_id) do nothing;

create trigger mems_remember_asset_qr
after insert or update of no, type or delete on public.assets
for each row execute function private.mems_remember_asset_qr();

create function public.mems_resolve_asset_qr(p_legacy_id bigint, p_type text, p_no integer)
returns table (id bigint, no integer, type text, status text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.no, a.type, a.status::text
  from public.assets a
  where p_legacy_id is null and p_type is not null and p_no is not null
    and a.no = p_no and public.mems_type_key(a.type) = public.mems_type_key(p_type)
  union all
  select a.id, a.no, a.type, a.status::text
  from private.asset_qr_legacy q
  join public.assets a on a.no = q.equipment_no and public.mems_type_key(a.type) = q.equipment_type
  where p_legacy_id = q.legacy_id and p_type is null and p_no is null
  union all
  select a.id, a.no, a.type, a.status::text
  from public.assets a
  where a.id = p_legacy_id and a.no is null and p_type is null and p_no is null
    and not exists (select 1 from private.asset_qr_legacy q where q.legacy_id = p_legacy_id)
$$;
revoke execute on function public.mems_resolve_asset_qr(bigint, text, integer) from public, anon;
grant execute on function public.mems_resolve_asset_qr(bigint, text, integer) to authenticated;

commit;
