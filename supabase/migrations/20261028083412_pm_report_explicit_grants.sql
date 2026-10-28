begin;
-- Supabase may automatically grant table privileges to anon/authenticated.
-- Remove inherited defaults as well as explicit grants, then allow only required operations.
revoke all on public.mems_report_settings, public.mems_reports from public, anon, authenticated;
grant select,update on public.mems_report_settings to authenticated;
grant select,insert on public.mems_reports to authenticated;
grant all on public.mems_report_settings, public.mems_reports to service_role;
commit;
