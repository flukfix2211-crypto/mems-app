begin;

create sequence public.mems_calibration_certificate_seq start with 2771 increment by 1;
revoke all on sequence public.mems_calibration_certificate_seq from public, anon, authenticated;

create unique index mems_calibrations_certificate_no_uidx
  on public.mems_calibrations (lower(certificate_no));

create table public.mems_calibration_standards (
  method text primary key,
  standard_reference text not null check (char_length(standard_reference) <= 200),
  source_note text not null check (char_length(source_note) <= 500),
  source_record_id integer,
  updated_at timestamptz not null default now()
);

alter table public.mems_calibration_standards enable row level security;
revoke all on public.mems_calibration_standards from public, anon, authenticated;
grant select on public.mems_calibration_standards to authenticated;
create policy "calibration standard readers" on public.mems_calibration_standards
  for select to authenticated using ((select private.has_permission('calibration')));

insert into public.mems_calibration_standards (method, standard_reference, source_note, source_record_id) values
  ('blood-pressure', 'FLUKE · ProSim8 · S/N 3240040 · สอบเทียบ 21/04/2026 · รหัส MMP-0061-26', 'ค่าเดิม Blood Pressure ใน Access · พบ 40 ใบใช้เครื่องนี้ · ใบล่าสุด ID CER 2674', 2674),
  ('manual-bp', 'FLUKE · ProSim8 · S/N 3240040 · สอบเทียบ 21/04/2026 · รหัส MMP-0061-26', 'ค่าเดิม Blood Pressure ใน Access · พบ 40 ใบใช้เครื่องนี้ · ใบล่าสุด ID CER 2674', 2674),
  ('digital-bp', 'FLUKE · ProSim8 · S/N 3240040 · สอบเทียบ 21/04/2026 · รหัส MMP-0061-26', 'Access ไม่มีใบ Digital แยก · ใช้ค่าเริ่มต้นจาก Blood Pressure · ใบล่าสุด ID CER 2674', 2674),
  ('refrig', 'Alpha Technics · 4600 · S/N 15GA10793 · สอบเทียบ 04/09/2025 · รหัส 25I966', 'ใบ Refrig.Thermometer ล่าสุดใน Access · ID CER 2705', 2705),
  ('flowmeter', 'Defender · 510-H · S/N 155674 · สอบเทียบ 14/09/2025 · รหัส 25MD1639', 'ใบ Flowmeter ล่าสุดใน Access · ID CER 2713', 2713),
  ('suction', 'FLUKE · 717-100G · S/N 3750085 · สอบเทียบ 10/09/2025 · รหัส 25P3534', 'ใบ Suction ล่าสุดใน Access · ID CER 2714', 2714),
  ('regulator', 'FLUKE · 717-100G · S/N 3750085 · สอบเทียบ 14/09/2025 · รหัส 25MD1639', 'ใบ Regulator ล่าสุดใน Access · ID CER 2652', 2652),
  ('ambient', 'Alpha Technics · 4600 · S/N 15GA10793 · สอบเทียบ 04/09/2025 · รหัส 25I966', 'ใบ Ambient Thermometer ล่าสุดใน Access · ID CER 2134', 2134),
  ('weight-adult', 'LS · S/N - · สอบเทียบ 05/09/2025 · รหัส 25M1718', 'ใบ Weighting Machine (Adult) ล่าสุดใน Access · ID CER 2708', 2708),
  ('weight-general', 'LS · S/N - · สอบเทียบ 05/09/2025 · รหัส 25M1718', 'ใบ Weighting Machine (General) ล่าสุดใน Access · ID CER 2596', 2596),
  ('weight-neo', 'LS · สอบเทียบ 05/09/2025 · รหัส 25M1718', 'ใบ Weighting Machine (Neo) ล่าสุดใน Access · ID CER 2478', 2478),
  ('centrifuge', 'Digicon · DT-251TL · S/N I.337187 · สอบเทียบ 08/09/2025 · รหัส 25E2861 / ABS · ZSD-013 · สอบเทียบ 25/08/2025 · รหัส 25PHAHOL08250346', 'ใบ Centrifuge ล่าสุดใน Access · ID CER 2697', 2697),
  ('hematocrit', 'Digicon · DT-251TL · S/N I.337187 · สอบเทียบ 08/09/2025 · รหัส 25E2861 / ABS · ZSD-013 · สอบเทียบ 25/08/2025 · รหัส 25PHAHOL08250346', 'ใบ Hematocrit ล่าสุดใน Access · ID CER 2695', 2695),
  ('rotator', 'Digicon · DT-251TL · S/N I.337187 · สอบเทียบ 08/09/2025 · รหัส 25E2861 / ABS · ZSD-013 · S/N 340934 · สอบเทียบ 25/08/2025 · รหัส 25PHAHOL08250346', 'ใบ Rotator ล่าสุดใน Access · ID CER 2696', 2696),
  ('serofuge', 'Digicon · DT-251TL · S/N I.337187 · สอบเทียบ 08/09/2025 · รหัส 25E2861 / ABS · ZSD-013 · S/N 340934 · สอบเทียบ 25/08/2025 · รหัส 25PHAHOL08250346', 'ใบ SEROFUGE ล่าสุดใน Access · ID CER 2690', 2690),
  ('alarm', 'ABS · ZSD-013 · สอบเทียบ 25/08/2025 · รหัส 25PHAHOL08250346', 'ใบ Alarm Clock ล่าสุดใน Access · ID CER 2685', 2685);

create or replace function public.mems_next_calibration_certificate(p_calibration_date date default current_date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  sequence_no bigint;
  certificate text;
  buddhist_year text;
begin
  if not private.has_permission('calibration') then
    raise exception 'ไม่มีสิทธิ์ออกเลขใบรับรองสอบเทียบ' using errcode = '42501';
  end if;
  buddhist_year := right(((extract(year from coalesce(p_calibration_date, current_date))::integer + 543)::text), 2);
  loop
    sequence_no := nextval('public.mems_calibration_certificate_seq'::regclass);
    certificate := 'CA-5-' || buddhist_year || '-10731-' || lpad(sequence_no::text, 5, '0');
    exit when not exists (
      select 1 from public.mems_calibrations
      where lower(certificate_no) = lower(certificate)
    );
  end loop;
  return certificate;
end;
$$;

revoke all on function public.mems_next_calibration_certificate(date) from public, anon;
grant execute on function public.mems_next_calibration_certificate(date) to authenticated;

commit;
