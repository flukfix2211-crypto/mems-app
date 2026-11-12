begin;

alter table public.mems_calibration_tools add column trashed_at timestamptz;
alter table public.mems_calibrations
  add column trashed_at timestamptz,
  add column trashed_with_tool boolean not null default false;

create index mems_calibration_tools_trash_idx on public.mems_calibration_tools (trashed_at) where trashed_at is not null;
create index mems_calibrations_trash_idx on public.mems_calibrations (trashed_at) where trashed_at is not null;

create policy "calibration active registry only" on public.mems_calibration_tools
  as restrictive for select to authenticated using (trashed_at is null);
create policy "calibration active records only" on public.mems_calibrations
  as restrictive for select to authenticated using (trashed_at is null);
create policy "calibration active updates only" on public.mems_calibrations
  as restrictive for update to authenticated using (trashed_at is null) with check (trashed_at is null);

create function private.require_active_calibration_tool() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.mems_calibration_tools where id = new.tool_id and trashed_at is null for share;
  if not found then raise exception 'เครื่องมืออยู่ในถังขยะหรือไม่มีในทะเบียน'; end if;
  return new;
end;
$$;
revoke all on function private.require_active_calibration_tool() from public, anon, authenticated;
create trigger mems_calibration_active_tool before insert on public.mems_calibrations
  for each row execute function private.require_active_calibration_tool();

create function private.change_calibration_trash(p_kind text, p_id uuid, p_restore boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tool_id uuid;
  v_tool_trash timestamptz;
  v_now timestamptz := statement_timestamp();
begin
  if auth.uid() is null or not coalesce(private.has_permission('calibration'), false) then
    raise exception 'ไม่มีสิทธิ์จัดการถังขยะสอบเทียบ' using errcode = '42501';
  end if;
  if p_kind = 'tool' then
    v_tool_id := p_id;
  elsif p_kind = 'record' then
    select tool_id into v_tool_id from public.mems_calibrations where id = p_id;
  else
    raise exception 'ประเภทรายการไม่ถูกต้อง';
  end if;

  select trashed_at into v_tool_trash from public.mems_calibration_tools where id = v_tool_id for update;
  if not found then raise exception 'ไม่พบรายการในระบบ'; end if;

  if p_kind = 'tool' then
    if p_restore then
      update public.mems_calibration_tools set trashed_at = null
        where id = p_id and trashed_at > v_now - interval '720 hours';
      if not found then raise exception 'รายการนี้กู้คืนไม่ได้หรือครบ 30 วันแล้ว'; end if;
      update public.mems_calibrations set trashed_at = null, trashed_with_tool = false
        where tool_id = p_id and trashed_with_tool;
    else
      update public.mems_calibration_tools set trashed_at = v_now
        where id = p_id and trashed_at is null;
      if not found then raise exception 'เครื่องมือนี้อยู่ในถังขยะแล้ว'; end if;
      update public.mems_calibrations set trashed_at = v_now, trashed_with_tool = true
        where tool_id = p_id and trashed_at is null;
    end if;
  elsif v_tool_trash is not null then
    raise exception 'กรุณากู้คืนเครื่องมือจากถังขยะก่อน';
  elsif p_restore then
    update public.mems_calibrations set trashed_at = null
      where id = p_id and trashed_at > v_now - interval '720 hours' and not trashed_with_tool;
    if not found then raise exception 'รายการนี้กู้คืนไม่ได้หรือครบ 30 วันแล้ว'; end if;
  else
    update public.mems_calibrations set trashed_at = v_now where id = p_id and trashed_at is null;
    if not found then raise exception 'รายการนี้อยู่ในถังขยะแล้ว'; end if;
  end if;
end;
$$;

create function private.list_calibration_trash()
returns table(kind text, id uuid, label text, expires_at timestamptz, can_restore boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(private.has_permission('calibration'), false) then
    raise exception 'ไม่มีสิทธิ์ดูถังขยะสอบเทียบ' using errcode = '42501';
  end if;
  return query
    select 'tool'::text, t.id, t.name || ' · ID ' || t.tool_code || ' · ' || t.department,
      t.trashed_at + interval '720 hours', true
    from public.mems_calibration_tools t where t.trashed_at > now() - interval '720 hours'
    union all
    select 'record'::text, c.id, c.certificate_no || ' · ' || c.equipment_type || ' · ' || c.department,
      c.trashed_at + interval '720 hours', t.trashed_at is null
    from public.mems_calibrations c join public.mems_calibration_tools t on t.id = c.tool_id
    where c.trashed_at > now() - interval '720 hours'
    order by 4, 2;
end;
$$;

create function public.mems_change_calibration_trash(p_kind text, p_id uuid, p_restore boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.change_calibration_trash(p_kind, p_id, p_restore);
$$;
create function public.mems_list_calibration_trash()
returns table(kind text, id uuid, label text, expires_at timestamptz, can_restore boolean)
language sql stable security invoker set search_path = '' as $$
  select * from private.list_calibration_trash();
$$;
revoke all on function private.change_calibration_trash(text, uuid, boolean), private.list_calibration_trash(),
  public.mems_change_calibration_trash(text, uuid, boolean), public.mems_list_calibration_trash() from public, anon, authenticated;
grant execute on function private.change_calibration_trash(text, uuid, boolean), private.list_calibration_trash(),
  public.mems_change_calibration_trash(text, uuid, boolean), public.mems_list_calibration_trash() to authenticated;

create extension if not exists pg_cron;
select cron.schedule('mems-calibration-trash-purge', '17 * * * *', $job$
  delete from public.mems_calibrations where trashed_at <= now() - interval '720 hours';
  delete from public.mems_calibration_tools t where t.trashed_at <= now() - interval '720 hours'
    and not exists (select 1 from public.mems_calibrations c where c.tool_id = t.id);
$job$);

commit;
