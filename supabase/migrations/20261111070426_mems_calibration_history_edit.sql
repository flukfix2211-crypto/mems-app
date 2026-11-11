begin;

grant update (calibrated_on, certificate_no, operator_name, standard_reference,
  ambient_temperature, relative_humidity, notes, measurements)
  on public.mems_calibrations to authenticated;

create policy "calibration updaters"
  on public.mems_calibrations
  for update
  to authenticated
  using ((select private.has_permission('calibration')))
  with check ((select private.has_permission('calibration')));

commit;
