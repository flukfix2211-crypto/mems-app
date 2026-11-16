begin;

create table public.mems_calibration_pdf_branding (
  id boolean primary key default true check (id),
  logo text not null default '' check (
    logo = '' or (length(logo) <= 600000 and logo ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$')
  )
);

alter table public.mems_calibration_pdf_branding enable row level security;
revoke all on public.mems_calibration_pdf_branding from public, anon, authenticated;
grant select, insert, update on public.mems_calibration_pdf_branding to authenticated;
grant all on public.mems_calibration_pdf_branding to service_role;

create policy "calibration users can read PDF branding" on public.mems_calibration_pdf_branding
  for select to authenticated using ((select private.has_permission('calibration')));
create policy "admins can insert PDF branding" on public.mems_calibration_pdf_branding
  for insert to authenticated with check (
    exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.active and p.role = 'admin')
  );
create policy "admins can update PDF branding" on public.mems_calibration_pdf_branding
  for update to authenticated using (
    exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.active and p.role = 'admin')
  ) with check (
    exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.active and p.role = 'admin')
  );

commit;
