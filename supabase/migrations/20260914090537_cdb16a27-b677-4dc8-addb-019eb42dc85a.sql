create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
  and (
    _role <> 'admin'
    or coalesce(
      (select level::text from public.staff_members
        where user_id = _user_id and status = 'active'),
      'owner'
    ) <> 'reader'
  )
$$;