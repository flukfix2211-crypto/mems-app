begin;

create or replace function private.mems_siri_prepare_request(p_code text, p_action text, p_text text, p_draft uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  link private.mems_siri_prepare_links;
  phrase text;
  action text := lower(btrim(p_action, E' \t\n\r'));
  reply text := regexp_replace(normalize(p_text, NFKC), '^[[:space:]]+|[[:space:].!?…]+$', '', 'g');
  fields text[];
  spoken_type text;
  spoken_ward text;
  machine_number text;
  equipment text;
  ward text;
  staff text;
  matches bigint;
  bangkok_time time := (statement_timestamp() at time zone 'Asia/Bangkok')::time;
  payload jsonb;
  result jsonb;
  summary text;
  record_id bigint;
begin
  if p_code is null or p_code !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'error', 'message', 'กรุณาเชื่อมคำสั่งลัดในหน้าเตรียมเครื่อง MEMS');
  end if;
  select * into link from private.mems_siri_prepare_links
    where code_hash = sha256(convert_to(p_code, 'UTF8')) and expires_at > statement_timestamp() for update;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'รหัสคำสั่งลัดหมดอายุหรือถูกยกเลิก กรุณาเชื่อมใหม่ใน MEMS');
  end if;
  perform set_config('request.jwt.claim.sub', link.account_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', link.account_id, 'role', 'authenticated')::text, true);
  if not private.has_permission('prepare') then
    return jsonb_build_object('status', 'error', 'message', 'บัญชี MEMS นี้ไม่มีสิทธิ์เตรียมเครื่อง');
  end if;

  reply := regexp_replace(reply, '[[:space:]]*(ครับผม|ครับ|ค่ะ|คะ)$', '');
  if action is null or action not in ('preview', 'confirm', 'cancel') then
    return jsonb_build_object('status', 'error', 'message', 'คำสั่งลัดส่งขั้นตอนไม่ถูกต้อง');
  end if;

  if action = 'preview' then
    if p_text is null or length(p_text) > 180 then
      return jsonb_build_object('status', 'error', 'message', 'กรุณาพูดชื่อเครื่อง หมายเลข และหน่วยงาน');
    end if;
    phrase := btrim(regexp_replace(normalize(p_text, NFKC), '[[:space:],]+', ' ', 'g'));
    phrase := regexp_replace(phrase, '[.!?…]+$', '');
    phrase := regexp_replace(phrase, '[[:space:]]*(ครับผม|ครับ|ค่ะ|คะ)$', '');
    phrase := regexp_replace(phrase, '^(?:ช่วย[[:space:]]*)?เตรียม[[:space:]]*(?:เครื่องมือ|เครื่อง)?[[:space:]]*', '');
    fields := regexp_match(phrase,
      '^(.+?)[[:space:]]*(?:เบอร์|หมายเลข|เลขที่|no\.?|#)[[:space:]:]*(.+?)[[:space:]]*ให้(?:กับ)?[[:space:]]*(?:หน่วยงาน[[:space:]]*)?(.+)$', 'i');
    if fields is null then
      fields := regexp_match(phrase,
        '^(.+?)[[:space:]]*ให้(?:กับ)?[[:space:]]*(?:หน่วยงาน[[:space:]]*)?(.+?)[[:space:]]*(?:เบอร์|หมายเลข|เลขที่|no\.?|#)[[:space:]:]*(.+)$', 'i');
      if fields is not null then fields := array[fields[1], fields[3], fields[2]]; end if;
    end if;
    if fields is null then
      fields := regexp_match(phrase,
        '^ให้(?:กับ)?[[:space:]]*(?:หน่วยงาน[[:space:]]*)?(.+?)[[:space:]]*เครื่อง[[:space:]]*(.+?)[[:space:]]*(?:เบอร์|หมายเลข|เลขที่|no\.?|#)[[:space:]:]*(.+)$', 'i');
      if fields is not null then fields := array[fields[2], fields[3], fields[1]]; end if;
    end if;
    if fields is null then
      fields := regexp_match(phrase,
        '^(.+?)[[:space:]]+([0-9๐-๙]{1,9})[[:space:]]*ให้(?:กับ)?[[:space:]]*(?:หน่วยงาน[[:space:]]*)?(.+)$');
    end if;
    machine_number := private.mems_siri_machine_number(fields[2]);
    if machine_number is null then
      return jsonb_build_object('status', 'error', 'message', 'ฟังข้อมูลไม่ครบ ลองพูดว่า ไฮโฟลว์ เบอร์สิบสอง ให้ห้องฉุกเฉิน');
    end if;
    spoken_type := public.mems_type_key(fields[1]);
    spoken_type := case regexp_replace(spoken_type, '[[:space:]]', '', 'g')
      when 'ไฮโฟลว์' then 'high flow' when 'ไฮโฟล' then 'high flow' when 'ไฮโฟว์' then 'high flow'
      when 'highflow' then 'high flow' when 'ไฮโฟ' then 'high flow'
      when 'ซีทู' then 'c2' when 'ซีสอง' then 'c2' when 'อินฟิวชันปั๊ม' then 'infusion pump'
      when 'ไซริงจ์ปั๊ม' then 'syringe pump' else spoken_type end;
    spoken_ward := lower(btrim(fields[3]));
    case regexp_replace(spoken_ward, '[[:space:].]+', '', 'g')
      when 'er', 'ห้องฉุกเฉิน', 'ฉุกเฉิน', 'อีอาร์' then spoken_ward := 'er';
      when 'semiicu', 'เซมิไอซียู', 'เซมี่ไอซียู', 'เซมิicu' then spoken_ward := 'semi icu';
      else null;
    end case;

    -- Include the normal page's ward choices and additional names already used in preparation.
    select min(name), count(*) into ward, matches from (
      select unnest(array['ER','อายุรกรรมหญิง (M.ญ)','EENT','ศัลยกรรมหญิง','ศัลยกรรมกระดูก','ศัลยกรรมชาย',
        'อายุรกรรมชาย (M.ช)','Semi ICU','ICU 100 ปี','กจ.3','กจ.2','TM','เด็กล่าง','PICU','เด็กบน',
        'ICU ญสส.','ห้องคลอด LR','หลังคลอด PP','ญสส.9','Premium ญสส.8','ญสส.7','ICU.S','ICU Neuro',
        'NICU','SNB','กจ.4','AIIR','สธ.7','สธ.6','ศูนย์เปล','เคมีบำบัด']) as name
      union select btrim(p.ward) from public.prepare_records p
    ) names where lower(name) = spoken_ward;
    if matches <> 1 then
      return jsonb_build_object('status', 'error', 'message', 'ไม่พบชื่อหน่วยงานที่ตรงกัน กรุณาพูดชื่อหน่วยงานอีกครั้ง');
    end if;

    select min(a.type), count(*) into equipment, matches from public.assets a
      where public.mems_type_key(a.type) = spoken_type and a.no::text = machine_number;
    if matches <> 1 then
      return jsonb_build_object('status', 'error', 'message', 'ไม่พบเครื่องในทะเบียนเพียงรายการเดียว กรุณาตรวจชื่อเครื่องและหมายเลข');
    end if;
    if exists (select 1 from public.assets a where a.type = equipment and a.no::text = machine_number
                and a.status is distinct from 'ใช้งานได้')
      or exists (select 1 from public.prepare_records p where p.status = 'เตรียม'
                 and public.mems_type_key(p.equipment_type) = spoken_type
                 and public.mems_number_key(p.equipment_number) = machine_number)
      or exists (select 1 from public.equipment_status s where public.mems_type_key(s.equipment_name) = spoken_type
                 and public.mems_number_key(s.equipment_number) = machine_number
                 and (s.is_borrowed or coalesce((to_jsonb(s)->>'is_return_pending')::boolean, false))) then
      return jsonb_build_object('status', 'error', 'message', 'เครื่องนี้ยังเตรียมไม่ได้ กรุณาตรวจสอบสถานะใน MEMS');
    end if;
    link.draft_id := gen_random_uuid();
    update private.mems_siri_prepare_links set draft_id = link.draft_id,
      draft_until = statement_timestamp() + interval '2 minutes', saved_record_id = null,
      draft_payload = jsonb_build_object('equipment', equipment, 'number', machine_number, 'ward', ward)
      where account_id = link.account_id;
    return jsonb_build_object('status', 'preview', 'draft_id', link.draft_id, 'message',
      format('เตรียมเครื่อง %s เบอร์ %s ให้ %s ใช่ไหม กรุณาพูดว่า ยืนยัน หรือ ยกเลิก', equipment, machine_number, ward));
  end if;

  if p_draft is null or link.draft_id is distinct from p_draft or link.draft_until <= statement_timestamp() then
    return jsonb_build_object('status', 'error', 'message', 'รายการหมดอายุ กรุณาเริ่มคำสั่งใหม่');
  end if;
  if (action = 'cancel' or (action = 'confirm' and reply = 'ยกเลิก'))
     and link.saved_record_id is null then
    update private.mems_siri_prepare_links set draft_id = null, draft_until = null, draft_payload = null
      where account_id = link.account_id;
    return jsonb_build_object('status', 'cancelled', 'message', 'ยกเลิกแล้ว');
  end if;
  if action is distinct from 'confirm' or reply is distinct from 'ยืนยัน' then
    return jsonb_build_object('status', 'error', 'message', 'ต้องตอบว่า ยืนยัน ก่อนบันทึก');
  end if;

  equipment := link.draft_payload->>'equipment';
  machine_number := link.draft_payload->>'number';
  ward := link.draft_payload->>'ward';
  summary := format('เตรียมเครื่อง %s เบอร์ %s ให้ %s แล้ว', equipment, machine_number, ward);
  if link.saved_record_id is not null then
    return jsonb_build_object('status', 'saved', 'record_id', link.saved_record_id, 'message', summary);
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''))
    into staff from public.user_profiles p where p.id = link.account_id;
  if staff is null then
    return jsonb_build_object('status', 'error', 'message', 'บัญชีนี้ไม่มีชื่อผู้เตรียมใน MEMS');
  end if;
  payload := jsonb_build_object('mode', 'prepare', 'ward', ward, 'name', staff || ' เจ้าหน้าที่ศูนย์เครื่องมือแพทย์',
    'items', jsonb_build_array(jsonb_build_object('equipment', equipment, 'number', machine_number)),
    'shift', case when bangkok_time >= time '08:30' and bangkok_time < time '16:30' then 'เวรเช้า'
                  when bangkok_time >= time '16:30' or bangkok_time < time '00:30' then 'เวรบ่าย'
                  else 'เวรดึก' end);
  begin
    -- Reuses the same locks, return checks, registry validation and audit as web preparation.
    result := public.mems_equipment_batch(p_draft, payload);
    record_id := (result->0->>'id')::bigint;
    if record_id is null then raise exception 'Prepare result missing'; end if;
  exception when raise_exception or unique_violation or insufficient_privilege then
    update private.mems_siri_prepare_links set draft_id = null, draft_until = null, draft_payload = null
      where account_id = link.account_id;
    return jsonb_build_object('status', 'error', 'message', 'ยังบันทึกไม่สำเร็จ กรุณาตรวจสถานะเครื่องใน MEMS แล้วลองใหม่');
  end;
  update private.mems_siri_prepare_links set saved_record_id = record_id where account_id = link.account_id;
  return jsonb_build_object('status', 'saved', 'record_id', record_id, 'message', summary);
end $$;
revoke all on function private.mems_siri_prepare_request(text, text, text, uuid) from public, anon, authenticated;

commit;
