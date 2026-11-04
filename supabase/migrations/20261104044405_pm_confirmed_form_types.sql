begin;
-- User-confirmed Google Form choices. Retain old observations for provenance, not as current choices.
alter table public.mems_report_tool_types add column active boolean not null default true;
alter table public.mems_report_tool_types drop constraint mems_report_tool_types_source_check;
alter table public.mems_report_tool_types add constraint mems_report_tool_types_source_check check(source in ('form_response','form_confirmed','custom'));
update public.mems_report_tool_types set active=false where source='form_response' and name not in (
 'Defibrillator','Infusionpump','Syringpump','Vital sing Monitor','Electrosurgical','Anesthetic Machine','Ventilator'
);
drop index public.mems_report_tool_type_name;
create unique index mems_report_tool_type_name on public.mems_report_tool_types(lower(name)) where active;
insert into public.mems_report_tool_types(name,source,created_by) select name,'form_confirmed',null from unnest(array[
 'Defibrillator','Infusionpump','Syringpump','Vital sing Monitor','Electrosurgical','Anesthetic Machine','Ventilator'
]) name on conflict (lower(name)) where active do update set name=excluded.name,
 source=case when mems_report_tool_types.source='custom' then 'custom' else 'form_confirmed' end;
drop policy tool_types_read on public.mems_report_tool_types;
create policy tool_types_read on public.mems_report_tool_types for select to authenticated using(active and (select private.can_use_mems_reports()));
create or replace function public.save_mems_report_tool_type(type_name text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.mems_report_tool_types; n text:=btrim(type_name);
begin
 if auth.uid() is null or not private.can_use_mems_reports() then raise exception 'ไม่มีสิทธิ์เพิ่มประเภทเครื่อง' using errcode='42501'; end if;
 if nullif(n,'') is null or length(n)>200 then raise exception 'กรอกชื่อประเภทเครื่องไม่เกิน 200 ตัวอักษร'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(n),4));
 insert into public.mems_report_tool_types(name) values(n) on conflict do nothing;
 select * into strict saved from public.mems_report_tool_types where active and lower(name)=lower(n);
 return to_jsonb(saved);
end $$;
commit;
