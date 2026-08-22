create type public.entity_status as enum ('active', 'suspended');

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles(id) on delete cascade,
  legal_name text not null,
  vat_number text,
  country text,
  address text,
  max_stores integer not null default 3,
  status public.entity_status not null default 'active',
  created_at timestamp with time zone not null default now()
);

grant select, insert, update, delete on public.entities to authenticated;
grant all on public.entities to service_role;

alter table public.entities enable row level security;

create policy "Users read own entities"
  on public.entities for select to authenticated
  using (account_id = auth.uid());

create policy "Users update own entities"
  on public.entities for update to authenticated
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

create policy "Admins full access to entities"
  on public.entities for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  platform public.store_platform not null default 'shopify',
  store_url text not null,
  store_name text,
  integration_mode public.integration_mode not null default 'manual',
  subscription_plan public.subscription_plan not null default 'basic',
  subscription_status public.subscription_status not null default 'none',
  stripe_subscription_id text,
  pending_plan_change public.subscription_plan,
  pending_plan_change_date date,
  quotes_used_this_month integer not null default 0,
  quotes_period_start date not null default date_trunc('month', current_date)::date,
  fee_waived boolean not null default false,
  middleware_tenant_id text unique,
  provisioning_status public.provisioning_status not null default 'not_started',
  provisioning_step text,
  provisioning_error text,
  status public.profile_status not null default 'pending',
  approved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint stores_middleware_tenant_id_format
    check (middleware_tenant_id is null or middleware_tenant_id ~ '^rs_[0-9a-f]{32}$'),
  constraint stores_shopify_url
    check (platform <> 'shopify' or store_url ~* '\.myshopify\.com/?$')
);

create unique index stores_store_url_unique on public.stores (lower(store_url));

grant select, insert, update, delete on public.stores to authenticated;
grant all on public.stores to service_role;

alter table public.stores enable row level security;

create policy "Users read stores of own entities"
  on public.stores for select to authenticated
  using (exists (
    select 1 from public.entities e
    where e.id = stores.entity_id and e.account_id = auth.uid()
  ));

create policy "Users update stores of own entities"
  on public.stores for update to authenticated
  using (exists (
    select 1 from public.entities e
    where e.id = stores.entity_id and e.account_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.entities e
    where e.id = stores.entity_id and e.account_id = auth.uid()
  ));

create policy "Admins full access to stores"
  on public.stores for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create or replace function public.guard_entity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    if new.max_stores is distinct from old.max_stores
       or new.status is distinct from old.status
       or new.account_id is distinct from old.account_id then
      raise exception 'Protected entity fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger entities_guard_update
  before update on public.entities
  for each row execute function public.guard_entity_update();

create or replace function public.guard_store_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.middleware_tenant_id is not null
     and new.middleware_tenant_id is distinct from old.middleware_tenant_id then
    raise exception 'middleware_tenant_id is immutable once set';
  end if;
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    if new.middleware_tenant_id is distinct from old.middleware_tenant_id
       or new.subscription_plan is distinct from old.subscription_plan
       or new.subscription_status is distinct from old.subscription_status
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.pending_plan_change is distinct from old.pending_plan_change
       or new.pending_plan_change_date is distinct from old.pending_plan_change_date
       or new.quotes_used_this_month is distinct from old.quotes_used_this_month
       or new.quotes_period_start is distinct from old.quotes_period_start
       or new.fee_waived is distinct from old.fee_waived
       or new.provisioning_status is distinct from old.provisioning_status
       or new.provisioning_step is distinct from old.provisioning_step
       or new.provisioning_error is distinct from old.provisioning_error
       or new.status is distinct from old.status
       or new.approved_at is distinct from old.approved_at
       or new.entity_id is distinct from old.entity_id then
      raise exception 'Protected store fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger stores_guard_update
  before update on public.stores
  for each row execute function public.guard_store_update();

create or replace function public.enforce_entity_max_stores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_count integer;
begin
  if tg_op = 'UPDATE' and new.entity_id is not distinct from old.entity_id then
    return new;
  end if;
  select e.max_stores into v_max from public.entities e where e.id = new.entity_id for update;
  if v_max is null then
    raise exception 'ENTITY_NOT_FOUND';
  end if;
  select count(*) into v_count from public.stores s where s.entity_id = new.entity_id;
  if v_count >= v_max then
    raise exception 'ENTITY_MAX_STORES_REACHED: this entity already has % stores (max %)', v_count, v_max;
  end if;
  return new;
end;
$$;

create trigger stores_enforce_entity_max_stores
  before insert or update of entity_id on public.stores
  for each row execute function public.enforce_entity_max_stores();

alter table public.wallet_transactions add column entity_id uuid references public.entities(id);
alter table public.quote_requests add column store_id uuid references public.stores(id);
alter table public.products add column store_id uuid references public.stores(id);
alter table public.orders add column store_id uuid references public.stores(id);
alter table public.documents add column store_id uuid references public.stores(id);

do $$
declare
  v_profile public.profiles%rowtype;
  v_entity_id uuid;
  v_store_id uuid;
begin
  for v_profile in
    select p.* from public.profiles p
     where exists (
       select 1 from public.user_roles ur
       where ur.user_id = p.id and ur.role = 'client'::public.app_role
     )
     and not exists (select 1 from public.entities e where e.account_id = p.id)
  loop
    insert into public.entities (account_id, legal_name, vat_number, country)
    values (v_profile.id, v_profile.company_name, v_profile.vat_number, v_profile.country)
    returning id into v_entity_id;

    insert into public.stores (
      entity_id, platform, store_url, store_name, integration_mode,
      subscription_plan, subscription_status, stripe_subscription_id,
      pending_plan_change, pending_plan_change_date,
      quotes_used_this_month, quotes_period_start, fee_waived,
      middleware_tenant_id, provisioning_status, provisioning_step, provisioning_error,
      status, approved_at
    ) values (
      v_entity_id, v_profile.platform, v_profile.store_url, v_profile.company_name, v_profile.integration_mode,
      v_profile.subscription_plan, v_profile.subscription_status, v_profile.stripe_subscription_id,
      v_profile.pending_plan_change, v_profile.pending_plan_change_date,
      v_profile.quotes_used_this_month, v_profile.quotes_period_start, v_profile.fee_waived,
      v_profile.middleware_tenant_id, v_profile.provisioning_status, v_profile.provisioning_step, v_profile.provisioning_error,
      v_profile.status, v_profile.approved_at
    ) returning id into v_store_id;

    update public.wallet_transactions set entity_id = v_entity_id where client_id = v_profile.id;
    update public.quote_requests set store_id = v_store_id where client_id = v_profile.id;
    update public.products set store_id = v_store_id where client_id = v_profile.id;
    update public.orders set store_id = v_store_id where client_id = v_profile.id;
    update public.documents set store_id = v_store_id where client_id = v_profile.id;
  end loop;

  if exists (select 1 from public.wallet_transactions where entity_id is null)
     or exists (select 1 from public.quote_requests where store_id is null)
     or exists (select 1 from public.products where store_id is null)
     or exists (select 1 from public.orders where store_id is null)
     or exists (select 1 from public.documents where store_id is null) then
    raise exception 'BACKFILL_INCOMPLETE: rows with null entity_id/store_id remain, aborting before NOT NULL';
  end if;
end;
$$;

alter table public.wallet_transactions alter column entity_id set not null;
alter table public.quote_requests alter column store_id set not null;
alter table public.products alter column store_id set not null;
alter table public.orders alter column store_id set not null;
alter table public.documents alter column store_id set not null;