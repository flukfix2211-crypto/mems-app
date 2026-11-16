begin;

create policy "only super admins can insert removed standards"
  on public.mems_calibration_standard_equipment
  as restrictive for insert to authenticated
  with check (not removed or (select private.is_super_admin()));

create policy "only super admins can change removed standards"
  on public.mems_calibration_standard_equipment
  as restrictive for update to authenticated
  using (not removed or (select private.is_super_admin()))
  with check (not removed or (select private.is_super_admin()));

commit;
