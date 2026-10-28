begin;
create table public.mems_report_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  bridge_url text not null default '' check (bridge_url = '' or bridge_url ~ '^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]+/exec$'),
  folder_id text not null default '1L3K9n7O1kVabVXxmFrQFAYF0KycMxsK8',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);
insert into public.mems_report_settings(id) values(true);
alter table public.mems_report_settings enable row level security;
grant select,update on public.mems_report_settings to authenticated;
grant all on public.mems_report_settings to service_role;
create policy report_settings_read on public.mems_report_settings for select to authenticated
using(exists(select from public.user_profiles p where p.id=(select auth.uid()) and p.active));
create policy report_settings_admin on public.mems_report_settings for update to authenticated
using(exists(select from public.user_profiles p where p.id=(select auth.uid()) and p.active and p.role='admin'))
with check(updated_by=(select auth.uid()) and exists(select from public.user_profiles p where p.id=(select auth.uid()) and p.active and p.role='admin')
  and folder_id='1L3K9n7O1kVabVXxmFrQFAYF0KycMxsK8');

create function private.can_use_mems_reports() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select from public.user_profiles p where p.id=(select auth.uid()) and p.active and (p.role='admin' or 'pm_reports'=any(p.permissions)))
 and exists(select from public.mems_report_settings s where s.id and s.enabled)
$$;
revoke all on function private.can_use_mems_reports() from public;
grant execute on function private.can_use_mems_reports() to authenticated;

create table public.mems_reports (
  id uuid primary key,
  actor_user_id uuid not null default auth.uid() references auth.users,
  kind text not null check(kind in ('pm','acceptance')),
  report_date date not null,
  payload jsonb not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  status text not null default 'saved' check(status in ('saved','generating','exported','export_error')),
  slides_id text, pdf_id text, drive_folder_id text,
  export_error text, export_started_at timestamptz, exported_at timestamptz
);
create index mems_reports_created on public.mems_reports(created_at desc,id);
alter table public.mems_reports enable row level security;
grant select,insert on public.mems_reports to authenticated;
grant all on public.mems_reports to service_role;
create policy reports_read on public.mems_reports for select to authenticated using((select private.can_use_mems_reports()));
create policy reports_insert on public.mems_reports for insert to authenticated with check(actor_user_id=(select auth.uid()) and (select private.can_use_mems_reports()));
-- No client UPDATE/DELETE grant: saved inspections and export receipts are immutable.

create function private.prepare_mems_report() returns trigger language plpgsql security invoker set search_path='' as $$
declare p jsonb; a public.assets; checks text[]; k text; base jsonb;
begin
 if not private.can_use_mems_reports() then raise exception 'ฟังก์ชันปิดอยู่หรือไม่มีสิทธิ์ใช้งาน' using errcode='42501'; end if;
 p:=new.payload;
 if jsonb_typeof(p)<>'object' or octet_length(p::text)>24000 then raise exception 'ข้อมูลไม่ถูกต้อง'; end if;
 if p->>'kind' not in ('pm','acceptance') or p->>'kind' is null then raise exception 'เลือกชนิดรายงาน'; end if;
 if coalesce(p->>'operator','')='' or coalesce(p->>'section','')='' then raise exception 'กรอกผู้ปฏิบัติงานและหน่วยงาน'; end if;
 if coalesce(btrim(p->>'brand'),'')='' or coalesce(btrim(p->>'model'),'')='' or coalesce(btrim(p->>'tool_type'),'')='' then raise exception 'กรอกชนิดเครื่อง ยี่ห้อ และรุ่น'; end if;
 if length(p->>'operator')>200 or length(p->>'section')>200 or length(coalesce(p->>'note',''))>2000 then raise exception 'ข้อความยาวเกินกำหนด'; end if;
 new.report_date:=(p->>'date')::date;
 if new.report_date is null or new.report_date<date '2000-01-01' or new.report_date>date '2100-12-31' then raise exception 'วันที่ไม่ถูกต้อง'; end if;
 checks:=array['สภาพภายนอกโครงสร้าง','ข้อต่อ/จุดต่างๆ','ล้อ/การเคลื่อนที่','ฉลาก/เครื่องหมาย','สายปลั๊กไฟ AC / Adepter DC','แบตเตอรี่ / การชาร์จเก็บประจุ','หน้าจอแสดงผล','สัญญาณเตือน','สายสัญญาณต่างๆ','ฟิลเตอรกรองอากาศ','ความสะอาดเครื่อง','Self Test'];
 checks:=checks || case when p->>'kind'='pm' then array['มอเตอร์ (ปั้ม/พัดลม/คอมเพรสเซอร์)','ปรับเทียบค่ามาตรฐาน / ปรับจูนแก้ไข','การหล่อลื่นจุดหมุนกลไกต่างๆ'] else array['คู่มือเครื่อง','ใบรับรอง'] end;
 if jsonb_typeof(p->'results') is distinct from 'object' then raise exception 'กรอกผลตรวจ'; end if;
 foreach k in array checks loop
   if coalesce(p->'results'->>k,'') not in ('ผ่าน','ไม่ผ่าน','N/A') then raise exception 'ผลตรวจไม่ครบ: %',k; end if;
 end loop;
 if p->'confirmed' is distinct from 'true'::jsonb then raise exception 'ยืนยันผลตรวจจริงก่อนบันทึก'; end if;
 if p->>'asset_pk' is not null and p->>'asset_pk'<>'' then
   select * into a from public.assets where id=(p->>'asset_pk')::bigint;
   if not found then raise exception 'ไม่พบเครื่องในทะเบียน'; end if;
   base:=jsonb_build_object('asset_pk',a.id,'equipment_type',a.type,'no',a.no,'asset_code',a.asset_code,'asset_id',a.asset_id);
 else
   if p->>'kind'='pm' then raise exception 'PM ต้องเลือกเครื่องจากทะเบียน'; end if;
   if coalesce(p->>'equipment_type','')='' or coalesce(p->>'model','')='' or coalesce(p->>'brand','')='' then raise exception 'กรอกประเภท ยี่ห้อ และรุ่นเครื่องใหม่'; end if;
   base:=jsonb_build_object('asset_pk',null,'equipment_type',p->>'equipment_type','no',p->>'no','asset_code',p->>'asset_code','asset_id',p->>'asset_id');
 end if;
 new.kind:=p->>'kind';
 new.actor_user_id:=auth.uid();
 new.snapshot:=base || jsonb_build_object('brand',p->>'brand','model',p->>'model','serial_number',p->>'serial_number','tool_type',p->>'tool_type');
 new.created_at:=now(); new.status:='saved';
 new.slides_id:=null;new.pdf_id:=null;new.drive_folder_id:=null;new.export_error:=null;new.export_started_at:=null;new.exported_at:=null;
 return new;
end;
$$;
revoke all on function private.prepare_mems_report() from public;
create trigger prepare_mems_report before insert on public.mems_reports for each row execute function private.prepare_mems_report();

create function public.save_mems_report(request_id uuid, report_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.mems_reports;
begin
 if not private.can_use_mems_reports() then raise exception 'ฟังก์ชันปิดอยู่หรือไม่มีสิทธิ์ใช้งาน' using errcode='42501';end if;
 select * into r from public.mems_reports where id=request_id;
 if found then
   if r.actor_user_id<>auth.uid() or r.payload<>report_payload then raise exception 'รหัสรายการถูกใช้กับข้อมูลอื่นแล้ว';end if;
   return to_jsonb(r);
 end if;
 insert into public.mems_reports(id,kind,report_date,payload,snapshot) values(request_id,report_payload->>'kind',(report_payload->>'date')::date,report_payload,'{}') on conflict(id) do nothing;
 select * into strict r from public.mems_reports where id=request_id;
 if r.actor_user_id<>auth.uid() or r.payload<>report_payload then raise exception 'รหัสรายการถูกใช้กับข้อมูลอื่นแล้ว';end if;
 return to_jsonb(r);
end;
$$;
revoke all on function public.save_mems_report(uuid,jsonb) from public;
grant execute on function public.save_mems_report(uuid,jsonb) to authenticated;
commit;
