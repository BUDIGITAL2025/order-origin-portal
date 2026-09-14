create type public.staff_level as enum ('owner','collaborator','reader');

create table public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  level public.staff_level not null default 'reader',
  status text not null default 'active' check (status in ('active','inactive')),
  last_active_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.staff_members to authenticated;
grant all on public.staff_members to service_role;

alter table public.staff_members enable row level security;

create or replace function public.is_staff_email(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email, '')) like '%@budigital.org'
$$;

create or replace function public.is_perpetual_owner(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email, '')) in ('flavio@budigital.org', 'info@budigital.org')
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_members
    where user_id = _user_id and status = 'active'
  )
$$;

create or replace function public.staff_level(_user_id uuid)
returns public.staff_level language sql stable security definer set search_path = public as $$
  select level from public.staff_members
  where user_id = _user_id and status = 'active'
$$;

create policy "Staff read the team, everyone reads their own row"
on public.staff_members for select to authenticated
using (user_id = auth.uid() or public.is_staff(auth.uid()));

-- Domain wall + perpetual-owner protection, enforced in the database.
create or replace function public.guard_staff_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if public.is_perpetual_owner(old.email) then
      raise exception 'PERPETUAL_OWNER: % cannot be removed', old.email;
    end if;
    return old;
  end if;

  new.email := lower(new.email);
  if not public.is_staff_email(new.email) then
    raise exception 'NOT_STAFF_EMAIL: only @budigital.org accounts can be staff';
  end if;

  if tg_op = 'UPDATE' then
    if public.is_perpetual_owner(old.email)
       and (new.level <> 'owner' or new.status <> 'active' or new.email <> old.email) then
      raise exception 'PERPETUAL_OWNER: % cannot be demoted or deactivated', old.email;
    end if;
    new.updated_at := now();
  end if;

  return new;
end $$;

create trigger staff_members_guard
before insert or update or delete on public.staff_members
for each row execute function public.guard_staff_member();

-- Any verified @budigital.org account is internal staff, never a client.
create or replace function public.provision_staff_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and public.is_staff_email(new.email) then
    insert into public.staff_members (user_id, email, level)
    values (
      new.id,
      lower(new.email),
      case when public.is_perpetual_owner(new.email) then 'owner' else 'reader' end::public.staff_level
    )
    on conflict (user_id) do nothing;

    insert into public.user_roles (user_id, role)
    values (new.id, 'admin')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created_staff
after insert on auth.users
for each row execute function public.provision_staff_account();

create trigger on_auth_user_confirmed_staff
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.provision_staff_account();

-- Backfill the existing company accounts.
insert into public.staff_members (user_id, email, level)
select u.id, lower(u.email),
       case when public.is_perpetual_owner(u.email) then 'owner' else 'reader' end::public.staff_level
from auth.users u
where u.email_confirmed_at is not null and public.is_staff_email(u.email)
on conflict (user_id) do nothing;

insert into public.user_roles (user_id, role)
select s.user_id, 'admin'::public.app_role from public.staff_members s
on conflict (user_id, role) do nothing;