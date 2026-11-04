begin;
-- This directory contains report signers, not MEMs login accounts.
create table public.mems_report_operators (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and length(name) between 1 and 200),
 position text not null check(position=btrim(position) and length(position) between 1 and 200),
 created_by uuid not null default auth.uid() references auth.users,
 created_at timestamptz not null default now()
);
create unique index mems_report_operator_identity on public.mems_report_operators(lower(name),lower(position));
create index mems_report_operators_creator on public.mems_report_operators(created_by);
alter table public.mems_report_operators enable row level security;
revoke all on public.mems_report_operators from public,anon,authenticated;
grant select,insert on public.mems_report_operators to authenticated;
grant all on public.mems_report_operators to service_role;
create policy operators_read on public.mems_report_operators for select to authenticated using((select private.can_use_mems_reports()));
create policy operators_insert on public.mems_report_operators for insert to authenticated with check(created_by=(select auth.uid()) and (select private.can_use_mems_reports()));
create function public.save_mems_report_operator(operator_name text,operator_position text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.mems_report_operators; n text:=btrim(operator_name); job text:=btrim(operator_position);
begin
 if auth.uid() is null or not private.can_use_mems_reports() then raise exception 'ไม่มีสิทธิ์เพิ่มผู้ปฏิบัติงาน' using errcode='42501'; end if;
 if nullif(n,'') is null or nullif(job,'') is null or length(n)>200 or length(job)>200 then raise exception 'กรอกชื่อและตำแหน่งไม่เกิน 200 ตัวอักษร'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(n)||'::'||lower(job),3));
 insert into public.mems_report_operators(name,position) values(n,job) on conflict do nothing;
 select * into strict saved from public.mems_report_operators where lower(name)=lower(n) and lower(position)=lower(job);
 return to_jsonb(saved);
end $$;
revoke all on function public.save_mems_report_operator(text,text) from public,anon;
grant execute on function public.save_mems_report_operator(text,text) to authenticated;

create function private.mems_report_position_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.payload ? 'operator_position' and (jsonb_typeof(new.payload->'operator_position') is distinct from 'string' or length(new.payload->>'operator_position')>200) then raise exception 'ตำแหน่งต้องเป็นข้อความไม่เกิน 200 ตัวอักษร'; end if;
 -- Preserve the historical position even if a signer is added again with a new job title.
 new.snapshot:=new.snapshot || jsonb_build_object('operator_position',coalesce(new.payload->>'operator_position',''));
 return new;
end $$;
revoke all on function private.mems_report_position_guard() from public;
create trigger zz_mems_report_position_guard before insert on public.mems_reports for each row execute function private.mems_report_position_guard();
commit;
