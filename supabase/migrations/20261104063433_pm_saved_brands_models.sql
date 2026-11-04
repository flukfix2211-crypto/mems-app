begin;
create table public.mems_report_brand_models (
 id uuid primary key default gen_random_uuid(),
 brand text not null check(brand=btrim(brand) and length(brand) between 1 and 200),
 model text not null default '' check(model=btrim(model) and length(model)<=200),
 created_by uuid default auth.uid() references auth.users,
 created_at timestamptz not null default now()
);
create unique index mems_report_brand_model_identity on public.mems_report_brand_models(lower(brand),lower(model));
create index mems_report_brand_model_creator on public.mems_report_brand_models(created_by);
alter table public.mems_report_brand_models enable row level security;
revoke all on public.mems_report_brand_models from public,anon,authenticated;
grant select,insert on public.mems_report_brand_models to authenticated;
grant all on public.mems_report_brand_models to service_role;
create policy brand_models_read on public.mems_report_brand_models for select to authenticated using((select private.can_use_mems_reports()));
create policy brand_models_insert on public.mems_report_brand_models for insert to authenticated with check(created_by=(select auth.uid()) and (select private.can_use_mems_reports()));
-- Existing inspection snapshots provide starting choices without altering saved reports.
with choices as (
 select btrim(snapshot->>'brand') brand,btrim(snapshot->>'model') model from public.mems_reports
 where length(btrim(snapshot->>'brand')) between 1 and 200 and length(btrim(snapshot->>'model')) between 1 and 200
), canonical as (
 select distinct on(lower(brand)) brand from choices order by lower(brand),brand
)
insert into public.mems_report_brand_models(brand,model,created_by)
select distinct on(lower(c.brand),lower(p.model)) c.brand,p.model,null
from choices p join canonical c on lower(c.brand)=lower(p.brand)
order by lower(c.brand),lower(p.model),p.model;
create function public.save_mems_report_brand_model(brand_name text,model_name text default '') returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.mems_report_brand_models; b text:=btrim(brand_name); m text:=btrim(coalesce(model_name,'')); canonical_brand text;
begin
 if auth.uid() is null or not private.can_use_mems_reports() then raise exception 'ไม่มีสิทธิ์เพิ่มยี่ห้อและรุ่น' using errcode='42501'; end if;
 if nullif(b,'') is null or length(b)>200 or length(m)>200 then raise exception 'กรอกยี่ห้อและรุ่นไม่เกิน 200 ตัวอักษร'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(b),5));
 select brand into canonical_brand from public.mems_report_brand_models where lower(brand)=lower(b) order by created_at,id limit 1;
 b:=coalesce(canonical_brand,b);
 insert into public.mems_report_brand_models(brand,model) values(b,m) on conflict do nothing;
 select * into strict saved from public.mems_report_brand_models where lower(brand)=lower(b) and lower(model)=lower(m);
 return to_jsonb(saved);
end $$;
revoke all on function public.save_mems_report_brand_model(text,text) from public,anon;
grant execute on function public.save_mems_report_brand_model(text,text) to authenticated;
commit;
