create or replace function public.is_staff_email(p_email text)
returns boolean language sql immutable set search_path = public as $$
  select lower(coalesce(p_email, '')) like '%@budigital.org'
$$;

create or replace function public.is_perpetual_owner(p_email text)
returns boolean language sql immutable set search_path = public as $$
  select lower(coalesce(p_email, '')) in ('flavio@budigital.org', 'info@budigital.org')
$$;

revoke execute on function public.guard_staff_member() from anon, authenticated, public;
revoke execute on function public.provision_staff_account() from anon, authenticated, public;
revoke execute on function public.staff_level(uuid) from anon, public;
revoke execute on function public.is_staff(uuid) from anon, public;
revoke execute on function public.is_staff_email(text) from anon, public;
revoke execute on function public.is_perpetual_owner(text) from anon, public;