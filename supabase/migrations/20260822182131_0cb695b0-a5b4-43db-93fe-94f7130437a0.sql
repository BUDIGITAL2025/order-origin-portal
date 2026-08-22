-- ===== 1. Replace single-price response flow; drop old RPC + view that reference dropped columns =====
drop function if exists public.respond_to_quote(uuid, boolean);
drop view if exists public.quote_requests_client;

-- ===== 2. quote_status: submitted | sourcing | quoted | closed | expired =====
alter type public.quote_status rename to quote_status_old;
create type public.quote_status as enum ('submitted', 'sourcing', 'quoted', 'closed', 'expired');
alter table public.quote_requests alter column status drop default;
alter table public.quote_requests
  alter column status type public.quote_status
  using (case when status::text in ('accepted', 'rejected') then 'closed' else status::text end)::public.quote_status;
alter table public.quote_requests alter column status set default 'submitted';
drop type public.quote_status_old;

-- ===== 3. Strip pricing from quote_requests; add internal_reference + quoted_by =====
alter table public.quote_requests
  drop column if exists supplier_cogs,
  drop column if exists supplier_shipping,
  drop column if exists supplier_tax,
  drop column if exists markup_product,
  drop column if exists markup_shipping,
  drop column if exists quoted_price_total,
  drop column if exists moq,
  drop column if exists lead_time_days,
  drop column if exists tier_at_quote,
  add column if not exists internal_reference text,
  add column if not exists quoted_by uuid references public.profiles(id);

-- Direct read paths on the base table (pricing columns no longer exist here)
grant select, update on public.quote_requests to authenticated;
create policy "Clients read own quote requests"
  on public.quote_requests for select to authenticated
  using (auth.uid() = client_id);
create policy "Admins have full access to quote requests"
  on public.quote_requests for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ===== 4. New enums + shared SKU sequence =====
create type public.quote_line_status as enum ('pending', 'accepted', 'rejected');
create type public.product_type as enum ('simple', 'bundle');
create type public.product_status as enum ('active', 'discontinued', 'needs_review');
create type public.push_status as enum ('pending', 'pushed', 'failed');

create sequence public.product_sku_seq as bigint start with 1 increment by 1;

create or replace function public.generate_sku(p_prefix text)
returns text language sql volatile security definer set search_path = public as $$
  select p_prefix || lpad(nextval('public.product_sku_seq')::text, 6, '0')
$$;
revoke all on function public.generate_sku(text) from public, anon, authenticated;

-- ===== 5. quote_lines =====
create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  variant_label text not null,
  sku text not null unique,
  supplier_cogs numeric,
  supplier_shipping numeric,
  supplier_tax numeric,
  markup_product numeric,
  markup_shipping numeric,
  unit_price numeric,
  moq integer,
  lead_time_days integer,
  status public.quote_line_status not null default 'pending',
  responded_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
create index quote_lines_request_idx on public.quote_lines(quote_request_id);

grant select on public.quote_lines to authenticated;
grant all on public.quote_lines to service_role;
alter table public.quote_lines enable row level security;

create policy "Admins have full access to quote lines"
  on public.quote_lines for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Client-facing restricted view: safe columns only, enforced server-side
create view public.quote_lines_client
with (security_invoker = false) as
select ql.id, ql.quote_request_id, ql.variant_label, ql.sku, ql.unit_price,
       ql.moq, ql.lead_time_days, ql.status, ql.responded_at, ql.created_at
from public.quote_lines ql
join public.quote_requests qr on qr.id = ql.quote_request_id
where qr.client_id = auth.uid();
grant select on public.quote_lines_client to authenticated;

-- ===== 6. products (client catalogue) =====
create table public.products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  quote_line_id uuid references public.quote_lines(id),
  sku text not null unique,
  product_name text not null,
  variant_label text,
  product_type public.product_type not null default 'simple',
  unit_price numeric,
  price_override numeric,
  moq integer,
  lead_time_days integer,
  status public.product_status not null default 'active',
  middleware_product_id text,
  push_status public.push_status not null default 'pending',
  push_error text,
  created_at timestamp with time zone not null default now(),
  constraint products_quote_line_unique unique (quote_line_id),
  constraint simple_requires_unit_price check (product_type <> 'simple' or unit_price is not null),
  constraint simple_no_price_override check (product_type <> 'simple' or price_override is null),
  constraint bundle_no_unit_price check (product_type <> 'bundle' or unit_price is null)
);
create index products_client_idx on public.products(client_id);

grant select, update on public.products to authenticated;
grant all on public.products to service_role;
alter table public.products enable row level security;

create policy "Clients read own products"
  on public.products for select to authenticated
  using (auth.uid() = client_id);
create policy "Admins have full access to products"
  on public.products for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "Clients update own bundles"
  on public.products for update to authenticated
  using (auth.uid() = client_id and product_type = 'bundle')
  with check (auth.uid() = client_id and product_type = 'bundle');

-- Clients may never write sku, prices, push state or provenance; only name + discontinue
create or replace function public.guard_product_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.internal_write', true) = 'on' then
    return new;
  end if;
  if public.has_role(auth.uid(), 'admin'::public.app_role) then
    return new;
  end if;
  if new.sku is distinct from old.sku
     or new.unit_price is distinct from old.unit_price
     or new.price_override is distinct from old.price_override
     or new.push_status is distinct from old.push_status
     or new.push_error is distinct from old.push_error
     or new.middleware_product_id is distinct from old.middleware_product_id
     or new.client_id is distinct from old.client_id
     or new.quote_line_id is distinct from old.quote_line_id
     or new.product_type is distinct from old.product_type
     or new.moq is distinct from old.moq
     or new.lead_time_days is distinct from old.lead_time_days
     or new.variant_label is distinct from old.variant_label
  then
    raise exception 'FORBIDDEN_PRODUCT_FIELD';
  end if;
  if new.status is distinct from old.status and new.status <> 'discontinued' then
    raise exception 'FORBIDDEN_STATUS_CHANGE';
  end if;
  return new;
end;
$$;
create trigger products_guard_update before update on public.products
  for each row execute function public.guard_product_update();

-- ===== 7. bundle_components =====
create table public.bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_product_id uuid not null references public.products(id) on delete cascade,
  component_product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity >= 1),
  created_at timestamp with time zone not null default now(),
  constraint bundle_components_unique unique (bundle_product_id, component_product_id)
);

grant select on public.bundle_components to authenticated;
grant all on public.bundle_components to service_role;
alter table public.bundle_components enable row level security;

create policy "Clients read own bundle components"
  on public.bundle_components for select to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = bundle_components.bundle_product_id and p.client_id = auth.uid()
  ));
create policy "Admins have full access to bundle components"
  on public.bundle_components for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- bundle must be type 'bundle', component must be type 'simple', same client
create or replace function public.validate_bundle_component()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bundle public.products%rowtype;
  v_component public.products%rowtype;
begin
  select * into v_bundle from public.products where id = new.bundle_product_id;
  select * into v_component from public.products where id = new.component_product_id;
  if v_bundle.id is null or v_bundle.product_type <> 'bundle' then
    raise exception 'BUNDLE_PRODUCT_MUST_BE_BUNDLE';
  end if;
  if v_component.id is null or v_component.product_type <> 'simple' then
    raise exception 'COMPONENT_MUST_BE_SIMPLE';
  end if;
  if v_bundle.client_id <> v_component.client_id then
    raise exception 'BUNDLE_COMPONENT_CLIENT_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger bundle_components_validate before insert or update on public.bundle_components
  for each row execute function public.validate_bundle_component();

-- a bundle can never be left with zero components
create or replace function public.block_last_component_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.internal_write', true) = 'on' then
    return old;
  end if;
  if not exists (select 1 from public.products where id = old.bundle_product_id) then
    return old; -- parent bundle is being deleted (cascade)
  end if;
  if not exists (
    select 1 from public.bundle_components
    where bundle_product_id = old.bundle_product_id and id <> old.id
  ) then
    raise exception 'BUNDLE_REQUIRES_COMPONENT';
  end if;
  return old;
end;
$$;
create trigger bundle_components_keep_one before delete on public.bundle_components
  for each row execute function public.block_last_component_delete();

-- discontinuing a component flags its bundles for review instead of breaking them
create or replace function public.flag_bundles_on_component_discontinued()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'discontinued' and old.status is distinct from 'discontinued' then
    perform set_config('app.internal_write', 'on', true);
    update public.products p
       set status = 'needs_review'
     where p.product_type = 'bundle'
       and p.status = 'active'
       and exists (
         select 1 from public.bundle_components bc
         where bc.bundle_product_id = p.id and bc.component_product_id = new.id
       );
  end if;
  return new;
end;
$$;
create trigger products_flag_bundles_on_discontinue
  after update of status on public.products
  for each row execute function public.flag_bundles_on_component_discontinued();

-- ===== 8. bundle pricing + lead time (RLS-respecting view) =====
create view public.bundle_prices
with (security_invoker = true) as
select b.id as bundle_product_id,
       count(bc.id)::integer as component_count,
       coalesce(sum(c.unit_price * bc.quantity), 0)::numeric as calculated_price,
       coalesce(b.price_override, coalesce(sum(c.unit_price * bc.quantity), 0))::numeric as effective_price,
       max(c.lead_time_days) as max_lead_time_days
from public.products b
left join public.bundle_components bc on bc.bundle_product_id = b.id
left join public.products c on c.id = bc.component_product_id
where b.product_type = 'bundle'
group by b.id;
grant select on public.bundle_prices to authenticated;

-- ===== 9. explode_product — single source of truth for order fulfilment =====
create or replace function public.explode_product(p_product_id uuid, p_quantity integer)
returns table(sku text, quantity integer)
language sql stable security invoker set search_path = public as $$
  select p.sku, p_quantity
    from public.products p
   where p.id = p_product_id and p.product_type = 'simple'
  union all
  select c.sku, bc.quantity * p_quantity
    from public.products b
    join public.bundle_components bc on bc.bundle_product_id = b.id
    join public.products c on c.id = bc.component_product_id
   where b.id = p_product_id and b.product_type = 'bundle'
$$;
revoke all on function public.explode_product(uuid, integer) from public, anon;
grant execute on function public.explode_product(uuid, integer) to authenticated;

-- ===== 10. Admin: save variant lines, generate SKUs, move request to 'quoted' =====
create or replace function public.admin_save_quote_lines(
  p_quote_id uuid,
  p_lines jsonb,
  p_internal_reference text default null,
  p_quote_valid_until date default null,
  p_admin_notes text default null
)
returns setof public.quote_lines
language plpgsql security definer set search_path = public as $$
declare
  v_request public.quote_requests%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_unit numeric;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'FORBIDDEN: admin access required';
  end if;

  select * into v_request from public.quote_requests where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_request.status not in ('submitted', 'sourcing', 'quoted') then
    raise exception 'QUOTE_NOT_EDITABLE';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'AT_LEAST_ONE_LINE_REQUIRED';
  end if;

  -- drop pending lines the admin removed from the payload
  delete from public.quote_lines ql
   where ql.quote_request_id = p_quote_id
     and ql.status = 'pending'
     and not exists (
       select 1 from jsonb_array_elements(p_lines) e
       where e ? 'id' and e->>'id' is not null and (e->>'id')::uuid = ql.id
     );

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if nullif(trim(coalesce(v_line->>'variant_label', '')), '') is null then
      raise exception 'VARIANT_LABEL_REQUIRED';
    end if;

    -- supplier_tax is a pass-through at exact cost; it is never marked up
    v_unit := round(
        coalesce((v_line->>'supplier_cogs')::numeric, 0)
      + coalesce((v_line->>'supplier_shipping')::numeric, 0)
      + coalesce((v_line->>'supplier_tax')::numeric, 0)
      + coalesce((v_line->>'markup_product')::numeric, 0)
      + coalesce((v_line->>'markup_shipping')::numeric, 0)
    , 2);

    if v_line ? 'id' and v_line->>'id' is not null then
      v_line_id := (v_line->>'id')::uuid;
      update public.quote_lines set
        variant_label = trim(v_line->>'variant_label'),
        supplier_cogs = coalesce((v_line->>'supplier_cogs')::numeric, 0),
        supplier_shipping = coalesce((v_line->>'supplier_shipping')::numeric, 0),
        supplier_tax = coalesce((v_line->>'supplier_tax')::numeric, 0),
        markup_product = coalesce((v_line->>'markup_product')::numeric, 0),
        markup_shipping = coalesce((v_line->>'markup_shipping')::numeric, 0),
        unit_price = v_unit,
        moq = (v_line->>'moq')::integer,
        lead_time_days = (v_line->>'lead_time_days')::integer
      where id = v_line_id and quote_request_id = p_quote_id and status = 'pending';
      if not found then
        raise exception 'LINE_NOT_EDITABLE';
      end if;
    else
      insert into public.quote_lines (
        quote_request_id, variant_label, sku,
        supplier_cogs, supplier_shipping, supplier_tax, markup_product, markup_shipping,
        unit_price, moq, lead_time_days
      ) values (
        p_quote_id, trim(v_line->>'variant_label'), public.generate_sku('FS-'),
        coalesce((v_line->>'supplier_cogs')::numeric, 0),
        coalesce((v_line->>'supplier_shipping')::numeric, 0),
        coalesce((v_line->>'supplier_tax')::numeric, 0),
        coalesce((v_line->>'markup_product')::numeric, 0),
        coalesce((v_line->>'markup_shipping')::numeric, 0),
        v_unit,
        (v_line->>'moq')::integer,
        (v_line->>'lead_time_days')::integer
      ) returning id into v_line_id;
    end if;
  end loop;

  update public.quote_requests set
    status = 'quoted',
    quoted_at = now(),
    quoted_by = auth.uid(),
    internal_reference = nullif(p_internal_reference, ''),
    quote_valid_until = p_quote_valid_until,
    admin_notes = nullif(p_admin_notes, '')
  where id = p_quote_id;

  return query select * from public.quote_lines where quote_request_id = p_quote_id order by created_at;
end;
$$;
revoke all on function public.admin_save_quote_lines(uuid, jsonb, text, date, text) from public, anon;
grant execute on function public.admin_save_quote_lines(uuid, jsonb, text, date, text) to authenticated;

-- ===== 11. Client: respond to lines individually; accepted lines become products =====
create or replace function public.respond_to_quote_lines(
  p_quote_id uuid,
  p_product_name text,
  p_decisions jsonb
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_request public.quote_requests%rowtype;
  v_decision jsonb;
  v_line public.quote_lines%rowtype;
  v_accepted integer := 0;
  v_pending integer;
begin
  select * into v_request from public.quote_requests where id = p_quote_id for update;
  if not found or v_request.client_id <> auth.uid() then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_request.status <> 'quoted' then
    raise exception 'QUOTE_NOT_OPEN';
  end if;
  if v_request.quote_valid_until is not null and v_request.quote_valid_until < current_date then
    update public.quote_requests set status = 'expired' where id = p_quote_id;
    raise exception 'QUOTE_EXPIRED';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'NO_DECISIONS';
  end if;

  -- one product name covers all accepted lines of this request
  if exists (select 1 from jsonb_array_elements(p_decisions) d where (d->>'accept')::boolean)
     and nullif(trim(coalesce(p_product_name, '')), '') is null then
    raise exception 'PRODUCT_NAME_REQUIRED';
  end if;

  perform set_config('app.internal_write', 'on', true);

  for v_decision in select * from jsonb_array_elements(p_decisions) loop
    select * into v_line from public.quote_lines
     where id = (v_decision->>'line_id')::uuid and quote_request_id = p_quote_id;
    if not found then
      raise exception 'LINE_NOT_FOUND';
    end if;
    if v_line.status <> 'pending' then
      continue; -- already answered; idempotent
    end if;

    update public.quote_lines set
      status = case when (v_decision->>'accept')::boolean
                    then 'accepted'::public.quote_line_status
                    else 'rejected'::public.quote_line_status end,
      responded_at = now()
    where id = v_line.id;

    if (v_decision->>'accept')::boolean then
      v_accepted := v_accepted + 1;
      insert into public.products (
        client_id, quote_line_id, sku, product_name, variant_label,
        product_type, unit_price, moq, lead_time_days, status, push_status
      ) values (
        v_request.client_id, v_line.id, v_line.sku, trim(p_product_name), v_line.variant_label,
        'simple', v_line.unit_price, v_line.moq, v_line.lead_time_days, 'active', 'pending'
      );
      -- TODO: push the product to the supplier Shopify store; on success store
      -- middleware_product_id and set push_status = 'pushed', on failure 'failed' + push_error.
    end if;
  end loop;

  select count(*) into v_pending from public.quote_lines
   where quote_request_id = p_quote_id and status = 'pending';
  if v_pending = 0 then
    update public.quote_requests set status = 'closed' where id = p_quote_id;
  end if;

  return v_accepted;
end;
$$;
revoke all on function public.respond_to_quote_lines(uuid, text, jsonb) from public, anon;
grant execute on function public.respond_to_quote_lines(uuid, text, jsonb) to authenticated;

-- ===== 12. Client: create a bundle from own active simple products =====
create or replace function public.create_bundle(p_name text, p_components jsonb)
returns public.products
language plpgsql security definer set search_path = public as $$
declare
  v_product public.products%rowtype;
  v_distinct integer;
  v_valid integer;
  v_lead integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'NAME_REQUIRED';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'BUNDLE_REQUIRES_COMPONENT';
  end if;

  select count(distinct (e->>'product_id')::uuid) into v_distinct from jsonb_array_elements(p_components) e;
  select count(*), max(p.lead_time_days) into v_valid, v_lead
    from (select distinct (e->>'product_id')::uuid as pid from jsonb_array_elements(p_components) e) ids
    join public.products p on p.id = ids.pid
   where p.client_id = auth.uid() and p.product_type = 'simple' and p.status = 'active';
  if v_valid < v_distinct then
    raise exception 'INVALID_COMPONENT';
  end if;

  perform set_config('app.internal_write', 'on', true);

  insert into public.products (client_id, sku, product_name, product_type, moq, lead_time_days, status, push_status)
  values (auth.uid(), public.generate_sku('FSB-'), trim(p_name), 'bundle', 1, v_lead, 'active', 'pending')
  returning * into v_product;
  -- TODO: push bundle to the supplier Shopify store (middleware_product_id / push_status)

  insert into public.bundle_components (bundle_product_id, component_product_id, quantity)
  select v_product.id, (e->>'product_id')::uuid, greatest(1, (e->>'quantity')::integer)
    from jsonb_array_elements(p_components) e;

  return v_product;
end;
$$;
revoke all on function public.create_bundle(text, jsonb) from public, anon;
grant execute on function public.create_bundle(text, jsonb) to authenticated;

-- ===== 13. Client: edit a bundle's name + components =====
create or replace function public.update_bundle(p_bundle_id uuid, p_name text, p_components jsonb)
returns public.products
language plpgsql security definer set search_path = public as $$
declare
  v_bundle public.products%rowtype;
  v_distinct integer;
  v_valid integer;
  v_lead integer;
begin
  select * into v_bundle from public.products where id = p_bundle_id for update;
  if not found or v_bundle.product_type <> 'bundle' then
    raise exception 'BUNDLE_NOT_FOUND';
  end if;
  if v_bundle.client_id <> auth.uid() and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'FORBIDDEN';
  end if;
  -- TODO: once orders exist, block component edits when an order references this bundle;
  -- afterwards the client creates a new bundle instead.
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'NAME_REQUIRED';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'BUNDLE_REQUIRES_COMPONENT';
  end if;

  select count(distinct (e->>'product_id')::uuid) into v_distinct from jsonb_array_elements(p_components) e;
  select count(*), max(p.lead_time_days) into v_valid, v_lead
    from (select distinct (e->>'product_id')::uuid as pid from jsonb_array_elements(p_components) e) ids
    join public.products p on p.id = ids.pid
   where p.client_id = v_bundle.client_id and p.product_type = 'simple' and p.status <> 'discontinued';
  if v_valid < v_distinct then
    raise exception 'INVALID_COMPONENT';
  end if;

  perform set_config('app.internal_write', 'on', true);

  update public.products
     set product_name = trim(p_name), lead_time_days = v_lead, status = 'active'
   where id = p_bundle_id;

  delete from public.bundle_components where bundle_product_id = p_bundle_id;
  insert into public.bundle_components (bundle_product_id, component_product_id, quantity)
  select p_bundle_id, (e->>'product_id')::uuid, greatest(1, (e->>'quantity')::integer)
    from jsonb_array_elements(p_components) e;

  select * into v_bundle from public.products where id = p_bundle_id;
  return v_bundle;
end;
$$;
revoke all on function public.update_bundle(uuid, text, jsonb) from public, anon;
grant execute on function public.update_bundle(uuid, text, jsonb) to authenticated;