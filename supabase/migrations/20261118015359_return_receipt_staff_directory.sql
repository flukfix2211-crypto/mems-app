-- Expose only display names to users who can confirm physical returns.
create function private.list_return_receipt_staff()
returns table (staff_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct btrim(profile.display_name) as staff_name
  from public.user_profiles as profile
  where (select auth.uid()) is not null
    and (select private.has_permission('prepare'))
    and profile.active
    and (profile.role = 'admin' or 'prepare' = any(profile.permissions))
    and char_length(btrim(profile.display_name)) between 1 and 200
  order by staff_name;
$$;

revoke all on function private.list_return_receipt_staff() from public, anon, authenticated;
grant execute on function private.list_return_receipt_staff() to authenticated;

create function public.list_return_receipt_staff()
returns table (staff_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select staff_name from private.list_return_receipt_staff() order by staff_name;
$$;

revoke all on function public.list_return_receipt_staff() from public, anon, authenticated;
grant execute on function public.list_return_receipt_staff() to authenticated;
