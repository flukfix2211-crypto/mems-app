begin;
create table public.mems_report_tool_types (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and length(name) between 1 and 200),
 source text not null default 'custom' check(source in ('form_response','custom')),
 created_by uuid default auth.uid() references auth.users,
 created_at timestamptz not null default now()
);
create unique index mems_report_tool_type_name on public.mems_report_tool_types(lower(name));
create index mems_report_tool_type_creator on public.mems_report_tool_types(created_by);
alter table public.mems_report_tool_types enable row level security;
revoke all on public.mems_report_tool_types from public,anon,authenticated;
grant select,insert on public.mems_report_tool_types to authenticated;
grant all on public.mems_report_tool_types to service_role;
create policy tool_types_read on public.mems_report_tool_types for select to authenticated using((select private.can_use_mems_reports()));
create policy tool_types_insert on public.mems_report_tool_types for insert to authenticated with check(created_by=(select auth.uid()) and source='custom' and (select private.can_use_mems_reports()));
-- Seed observed names from the two linked Forms response sheets (column D), not unverified Form choice lists.
-- Exclude obvious test entries; consolidate spelling variants of the same device category.
insert into public.mems_report_tool_types(name,source,created_by) select name,'form_response',null from unnest(array[
 'Ventilator','Infusion pump','Defibrillator','เครื่องดมยาสลบ Anesthetic Machine','ตู้อบเด็ก','EKG','Regulator',
 'Hyper-hypothermia','Hyperthermia','เครื่องปั่นเลือด','เครื่องชั่งน้ำหนักแบบรถเข็นขึ้นชั่ง','Monitor','Ultrasound',
 'เครื่องชั่งน้ำหนักวัดส่วนสูง','เครื่องวัดความดันสอดแขน','เครื่องวัดความดัน','NIBP','เครื่องให้ความอบอุ่นทารกแรกเกิด','เครื่องอัลตร้าซาวด์แบบพกพา'
]) name;
create function public.save_mems_report_tool_type(type_name text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.mems_report_tool_types; n text:=btrim(type_name);
begin
 if auth.uid() is null or not private.can_use_mems_reports() then raise exception 'ไม่มีสิทธิ์เพิ่มประเภทเครื่อง' using errcode='42501'; end if;
 if nullif(n,'') is null or length(n)>200 then raise exception 'กรอกชื่อประเภทเครื่องไม่เกิน 200 ตัวอักษร'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(n),4));
 insert into public.mems_report_tool_types(name) values(n) on conflict do nothing;
 select * into strict saved from public.mems_report_tool_types where lower(name)=lower(n);
 return to_jsonb(saved);
end $$;
revoke all on function public.save_mems_report_tool_type(text) from public,anon;
grant execute on function public.save_mems_report_tool_type(text) to authenticated;
commit;
