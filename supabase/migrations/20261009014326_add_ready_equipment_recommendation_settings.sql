insert into public.app_settings (id, bool_value)
values
  ('ready_equipment_recommendations_enabled', true),
  ('ready_equipment_type_c2', true),
  ('ready_equipment_type_infusion_pump', true),
  ('ready_equipment_type_syringe_pump', true),
  ('ready_equipment_type_high_flow', true),
  ('ready_equipment_type_brid_green', true),
  ('ready_equipment_type_t1', true),
  ('ready_equipment_type_monnal_t60', true),
  ('ready_equipment_type_patient_monitor', true),
  ('ready_equipment_type_nibp', true),
  ('ready_equipment_type_defibrillator', false),
  ('ready_equipment_type_other_equipment', false)
on conflict (id) do nothing;
