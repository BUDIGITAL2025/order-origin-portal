alter table public.quote_requests add column if not exists target_countries text[];
update public.quote_requests set target_countries = array['US'] where target_countries is null;
alter table public.quote_requests alter column target_countries set not null;
alter table public.quote_requests add constraint quote_requests_target_countries_min check (cardinality(target_countries) >= 1);

alter table public.quote_lines add column if not exists country_code text;
update public.quote_lines ql set country_code = upper(qr.target_countries[1]) from public.quote_requests qr where qr.id = ql.quote_request_id and ql.country_code is null;
alter table public.quote_lines alter column country_code set not null;
alter table public.quote_lines drop constraint if exists quote_lines_sku_key;
alter table public.quote_lines add constraint quote_lines_variant_country_unique unique (quote_request_id, variant_label, country_code);

drop view if exists public.quote_lines_client;
create view public.quote_lines_client
with (security_invoker = false) as
select ql.id, ql.quote_request_id, ql.variant_label, ql.country_code, ql.sku,
       ql.unit_price, ql.moq, ql.lead_time_days, ql.status, ql.responded_at, ql.created_at
from public.quote_lines ql
join public.quote_requests qr on qr.id = ql.quote_request_id
where qr.client_id = auth.uid();
grant select on public.quote_lines_client to authenticated;

create table public.product_country_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  country_code text not null,
  unit_price numeric not null check (unit_price >= 0),
  lead_time_days integer,
  created_at timestamp with time zone not null default now(),
  constraint product_country_prices_unique unique (product_id, country_code)
);
create index product_country_prices_product_idx on public.product_country_prices(product_id);
grant select on public.product_country_prices to authenticated;
grant all on public.product_country_prices to service_role;
alter table public.product_country_prices enable row level security;
create policy "Clients read own product prices" on public.product_country_prices for select to authenticated using (exists (select 1 from public.products p where p.id = product_country_prices.product_id and p.client_id = auth.uid()));
create policy "Admins have full access to product country prices" on public.product_country_prices for all to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));

insert into public.product_country_prices (product_id, country_code, unit_price, lead_time_days)
select p.id, ql.country_code, p.unit_price, p.lead_time_days
  from public.products p
  join public.quote_lines ql on ql.id = p.quote_line_id
 where p.unit_price is not null
on conflict (product_id, country_code) do nothing;

drop view if exists public.bundle_prices;
alter table public.products drop constraint if exists simple_requires_unit_price;
alter table public.products drop constraint if exists bundle_no_unit_price;

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
     or new.price_override is distinct from old.price_override
     or new.push_status is distinct from old.push_status
     or new.push_error is distinct from old.push_error
     or new.middleware_product_id is distinct from old.middleware_product_id
     or new.client_id is distinct from old.client_id
     or new.quote_line_id is distinct from old.quote_line_id
     or new.product_type is distinct from old.product_type
     or new.moq is distinct from old.moq
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

alter table public.products drop column if exists unit_price;
alter table public.products drop column if exists lead_time_days;

create or replace function public.create_bundle(p_name text, p_components jsonb)
returns public.products language plpgsql security definer set search_path = public as $$
declare
  v_product public.products%rowtype;
  v_distinct integer;
  v_valid integer;
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
  select count(*) into v_valid
    from (select distinct (e->>'product_id')::uuid as pid from jsonb_array_elements(p_components) e) ids
    join public.products p on p.id = ids.pid
   where p.client_id = auth.uid() and p.product_type = 'simple' and p.status = 'active';
  if v_valid < v_distinct then
    raise exception 'INVALID_COMPONENT';
  end if;
  perform set_config('app.internal_write', 'on', true);
  insert into public.products (client_id, sku, product_name, product_type, moq, status, push_status)
  values (auth.uid(), public.generate_sku('FSB-'), trim(p_name), 'bundle', 1, 'active', 'pending')
  returning * into v_product;
  insert into public.bundle_components (bundle_product_id, component_product_id, quantity)
  select v_product.id, (e->>'product_id')::uuid, greatest(1, (e->>'quantity')::integer)
    from jsonb_array_elements(p_components) e;
  return v_product;
end;
$$;

create or replace function public.update_bundle(p_bundle_id uuid, p_name text, p_components jsonb)
returns public.products language plpgsql security definer set search_path = public as $$
declare
  v_bundle public.products%rowtype;
  v_distinct integer;
  v_valid integer;
begin
  select * into v_bundle from public.products where id = p_bundle_id for update;
  if not found or v_bundle.product_type <> 'bundle' then
    raise exception 'BUNDLE_NOT_FOUND';
  end if;
  if v_bundle.client_id <> auth.uid() and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'FORBIDDEN';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'NAME_REQUIRED';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'BUNDLE_REQUIRES_COMPONENT';
  end if;
  select count(distinct (e->>'product_id')::uuid) into v_distinct from jsonb_array_elements(p_components) e;
  select count(*) into v_valid
    from (select distinct (e->>'product_id')::uuid as pid from jsonb_array_elements(p_components) e) ids
    join public.products p on p.id = ids.pid
   where p.client_id = v_bundle.client_id and p.product_type = 'simple' and p.status <> 'discontinued';
  if v_valid < v_distinct then
    raise exception 'INVALID_COMPONENT';
  end if;
  perform set_config('app.internal_write', 'on', true);
  update public.products set product_name = trim(p_name), status = 'active' where id = p_bundle_id;
  delete from public.bundle_components where bundle_product_id = p_bundle_id;
  insert into public.bundle_components (bundle_product_id, component_product_id, quantity)
  select p_bundle_id, (e->>'product_id')::uuid, greatest(1, (e->>'quantity')::integer)
    from jsonb_array_elements(p_components) e;
  select * into v_bundle from public.products where id = p_bundle_id;
  return v_bundle;
end;
$$;

create view public.bundle_prices
with (security_invoker = true) as
select b.id as bundle_product_id,
       pcp.country_code,
       count(bc.id)::integer as component_count,
       sum(pcp.unit_price * bc.quantity)::numeric as calculated_price,
       coalesce(b.price_override, sum(pcp.unit_price * bc.quantity))::numeric as effective_price,
       max(pcp.lead_time_days) as max_lead_time_days
  from public.products b
  join public.bundle_components bc on bc.bundle_product_id = b.id
  join public.product_country_prices pcp on pcp.product_id = bc.component_product_id
 where b.product_type = 'bundle'
 group by b.id, pcp.country_code
having count(distinct pcp.product_id) = (
  select count(*) from public.bundle_components x where x.bundle_product_id = b.id
);
grant select on public.bundle_prices to authenticated;

drop function if exists public.submit_quote_request(text, text, text, integer, text[], uuid, uuid);

create function public.submit_quote_request(
  p_product_url text default null,
  p_product_name text default null,
  p_notes text default null,
  p_target_monthly_volume integer default null,
  p_image_urls text[] default null,
  p_supersedes_quote_id uuid default null,
  p_on_behalf_of uuid default null,
  p_target_countries text[] default null
)
returns public.quote_requests language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_client_id uuid;
  v_profile public.profiles%rowtype;
  v_original public.quote_requests%rowtype;
  v_month_start date := date_trunc('month', current_date)::date;
  v_quota integer;
  v_row public.quote_requests%rowtype;
  v_countries text[];
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  v_is_admin := public.has_role(v_caller, 'admin');
  if p_on_behalf_of is not null then
    if not v_is_admin then
      raise exception 'Only admins can submit quotes on behalf of a client';
    end if;
    v_client_id := p_on_behalf_of;
  else
    v_client_id := v_caller;
  end if;
  select * into v_profile from public.profiles where id = v_client_id for update;
  if not found then
    raise exception 'Client profile not found';
  end if;
  select array_agg(distinct upper(trim(c))) into v_countries
    from unnest(coalesce(p_target_countries, array[]::text[])) c
   where length(trim(c)) = 2;
  if p_supersedes_quote_id is not null then
    select * into v_original from public.quote_requests where id = p_supersedes_quote_id;
    if not found then
      raise exception 'Original quote not found';
    end if;
    if v_original.client_id <> v_client_id then
      raise exception 'Original quote does not belong to this client';
    end if;
    if v_original.status not in ('accepted', 'expired', 'closed') then
      raise exception 'Only accepted or expired quotes can be requoted';
    end if;
    insert into public.quote_requests
      (client_id, product_url, product_name, notes, status, supersedes_quote_id, target_countries)
    values
      (v_client_id, v_original.product_url, v_original.product_name, v_original.notes,
       'sourcing', p_supersedes_quote_id, v_original.target_countries)
    returning * into v_row;
    return v_row;
  end if;
  if v_countries is null or cardinality(v_countries) = 0 then
    raise exception 'TARGET_COUNTRIES_REQUIRED';
  end if;
  if not (v_is_admin and p_on_behalf_of is not null) then
    if v_profile.quotes_period_start < v_month_start then
      update public.profiles
      set quotes_used_this_month = 0, quotes_period_start = v_month_start
      where id = v_client_id
      returning quotes_used_this_month, quotes_period_start
      into v_profile.quotes_used_this_month, v_profile.quotes_period_start;
    end if;
    v_quota := case v_profile.subscription_plan when 'basic' then 5 else null end;
    if v_quota is not null and v_profile.quotes_used_this_month >= v_quota then
      raise exception 'QUOTE_LIMIT_REACHED: Monthly quote limit of % reached on plan %. Upgrade to Unlimited for uncapped quote requests.', v_quota, v_profile.subscription_plan;
    end if;
    update public.profiles set quotes_used_this_month = quotes_used_this_month + 1 where id = v_client_id;
  end if;
  if p_product_url is null or length(trim(p_product_url)) = 0 then
    raise exception 'product_url is required';
  end if;
  insert into public.quote_requests
    (client_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, target_countries)
  values
    (v_client_id, p_product_url, p_product_name, p_notes, p_target_monthly_volume, p_image_urls, 'submitted', v_countries)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.admin_save_quote_lines(p_quote_id uuid, p_lines jsonb, p_internal_reference text default null, p_quote_valid_until date default null, p_admin_notes text default null)
returns setof public.quote_lines language plpgsql security definer set search_path = public as $$
declare
  v_request public.quote_requests%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_unit numeric;
  v_label text;
  v_country text;
  v_sku text;
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
  delete from public.quote_lines ql
   where ql.quote_request_id = p_quote_id and ql.status = 'pending'
     and not exists (
       select 1 from jsonb_array_elements(p_lines) e
       where e ? 'id' and e->>'id' is not null and (e->>'id')::uuid = ql.id
     );
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_label := trim(coalesce(v_line->>'variant_label', ''));
    if v_label = '' then
      raise exception 'VARIANT_LABEL_REQUIRED';
    end if;
    v_country := upper(trim(coalesce(v_line->>'country_code', '')));
    if length(v_country) <> 2 then
      raise exception 'COUNTRY_CODE_REQUIRED';
    end if;
    if not (v_country = any(v_request.target_countries)) then
      raise exception 'COUNTRY_NOT_IN_REQUEST: %', v_country;
    end if;
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
        variant_label = v_label,
        country_code = v_country,
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
      select ql.sku into v_sku
        from public.quote_lines ql
       where ql.quote_request_id = p_quote_id and ql.variant_label = v_label
       order by ql.created_at
       limit 1;
      if v_sku is null then
        v_sku := public.generate_sku('FS-');
      end if;
      insert into public.quote_lines (
        quote_request_id, variant_label, country_code, sku,
        supplier_cogs, supplier_shipping, supplier_tax, markup_product, markup_shipping,
        unit_price, moq, lead_time_days
      ) values (
        p_quote_id, v_label, v_country, v_sku,
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

create or replace function public.respond_to_quote_lines(p_quote_id uuid, p_product_name text, p_decisions jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_request public.quote_requests%rowtype;
  v_decision jsonb;
  v_line public.quote_lines%rowtype;
  v_product_id uuid;
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
      continue;
    end if;
    update public.quote_lines set
      status = case when (v_decision->>'accept')::boolean
                    then 'accepted'::public.quote_line_status
                    else 'rejected'::public.quote_line_status end,
      responded_at = now()
    where id = v_line.id;
    if (v_decision->>'accept')::boolean then
      v_accepted := v_accepted + 1;
      select p.id into v_product_id from public.products p
       where p.client_id = v_request.client_id and p.sku = v_line.sku;
      if v_product_id is null then
        insert into public.products (
          client_id, quote_line_id, sku, product_name, variant_label,
          product_type, moq, status, push_status
        ) values (
          v_request.client_id, v_line.id, v_line.sku, trim(p_product_name), v_line.variant_label,
          'simple', v_line.moq, 'active', 'pending'
        ) returning id into v_product_id;
      end if;
      insert into public.product_country_prices (product_id, country_code, unit_price, lead_time_days)
      values (v_product_id, v_line.country_code, v_line.unit_price, v_line.lead_time_days)
      on conflict (product_id, country_code) do nothing;
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

create type public.order_status as enum ('awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'needs_review');
create type public.order_payment_method as enum ('wallet', 'direct');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  external_order_id text,
  external_order_number text,
  middleware_order_id text,
  status public.order_status not null default 'awaiting_payment',
  payment_method public.order_payment_method,
  total_amount numeric,
  destination_country text,
  shipping_address jsonb,
  paid_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  reminder_24_sent_at timestamp with time zone,
  reminder_48_sent_at timestamp with time zone,
  reminder_72_sent_at timestamp with time zone,
  needs_review_reason text,
  created_at timestamp with time zone not null default now()
);
create unique index orders_client_external_unique on public.orders (client_id, external_order_id) where external_order_id is not null;
create index orders_client_idx on public.orders(client_id);
create index orders_status_idx on public.orders(status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  sku text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  created_at timestamp with time zone not null default now()
);
create index order_items_order_idx on public.order_items(order_id);

create table public.order_fulfillment_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku text not null,
  quantity integer not null,
  created_at timestamp with time zone not null default now()
);
create index order_fulfillment_items_order_idx on public.order_fulfillment_items(order_id);

grant select on public.orders to authenticated;
grant all on public.orders to service_role;
grant select on public.order_items to authenticated;
grant all on public.order_items to service_role;
grant select on public.order_fulfillment_items to authenticated;
grant all on public.order_fulfillment_items to service_role;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_fulfillment_items enable row level security;

create policy "Clients read own orders" on public.orders for select to authenticated using (auth.uid() = client_id);
create policy "Admins have full access to orders" on public.orders for all to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "Clients read own order items" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_items.order_id and o.client_id = auth.uid()));
create policy "Admins have full access to order items" on public.order_items for all to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));
create policy "Clients read own fulfillment items" on public.order_fulfillment_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_fulfillment_items.order_id and o.client_id = auth.uid()));
create policy "Admins have full access to fulfillment items" on public.order_fulfillment_items for all to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role)) with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create or replace function public.release_order_to_fulfilment(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'processing'
   where id = p_order_id and status = 'paid';
end;
$$;
revoke all on function public.release_order_to_fulfilment(uuid) from public, anon, authenticated;

create or replace function public.ingest_order(
  p_client_id uuid,
  p_external_order_id text,
  p_external_order_number text,
  p_destination_country text,
  p_shipping_address jsonb,
  p_line_items jsonb
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_price numeric;
  v_qty integer;
  v_total numeric := 0;
  v_balance numeric;
  v_country text := upper(trim(coalesce(p_destination_country, '')));
  v_review text := null;
  v_components integer;
  v_priced integer;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN: order intake is internal';
  end if;
  if p_line_items is null or jsonb_typeof(p_line_items) <> 'array' or jsonb_array_length(p_line_items) = 0 then
    raise exception 'ORDER_REQUIRES_ITEMS';
  end if;
  if nullif(p_external_order_id, '') is not null then
    select * into v_order from public.orders
     where client_id = p_client_id and external_order_id = p_external_order_id;
    if found then
      return v_order;
    end if;
  end if;
  perform set_config('app.internal_write', 'on', true);
  insert into public.orders (
    client_id, external_order_id, external_order_number,
    destination_country, shipping_address, status
  ) values (
    p_client_id, nullif(p_external_order_id, ''), p_external_order_number,
    v_country, coalesce(p_shipping_address, '{}'::jsonb), 'awaiting_payment'
  ) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_line_items) loop
    v_qty := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_price := null;
    select * into v_product from public.products
     where client_id = p_client_id and sku = v_item->>'sku' and status = 'active';
    if not found then
      v_review := coalesce(v_review || '; ', '') || format('Unknown SKU %s', v_item->>'sku');
      insert into public.order_items (order_id, product_id, sku, quantity)
      values (v_order.id, null, v_item->>'sku', v_qty);
      continue;
    end if;
    if v_product.product_type = 'bundle' then
      select count(*) into v_components from public.bundle_components bc
       where bc.bundle_product_id = v_product.id;
      select count(*), sum(pcp.unit_price * bc.quantity) into v_priced, v_price
        from public.bundle_components bc
        join public.product_country_prices pcp
          on pcp.product_id = bc.component_product_id and pcp.country_code = v_country
       where bc.bundle_product_id = v_product.id;
      if v_priced < v_components then
        v_price := null;
      end if;
    else
      select pcp.unit_price into v_price
        from public.product_country_prices pcp
       where pcp.product_id = v_product.id and pcp.country_code = v_country;
    end if;
    if v_price is null then
      v_review := coalesce(v_review || '; ', '') || format('No price for SKU %s in %s', v_product.sku, v_country);
      insert into public.order_items (order_id, product_id, sku, quantity)
      values (v_order.id, v_product.id, v_product.sku, v_qty);
      continue;
    end if;
    insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total)
    values (v_order.id, v_product.id, v_product.sku, v_qty, v_price, round(v_price * v_qty, 2));
    v_total := v_total + round(v_price * v_qty, 2);
    insert into public.order_fulfillment_items (order_id, sku, quantity)
    select v_order.id, e.sku, e.quantity
      from public.explode_product(v_product.id, v_qty) e;
  end loop;
  if v_review is not null then
    update public.orders
       set status = 'needs_review', needs_review_reason = v_review, total_amount = v_total
     where id = v_order.id
    returning * into v_order;
    return v_order;
  end if;
  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.client_id = p_client_id
   order by wt.created_at desc, wt.id desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  if v_balance >= v_total then
    begin
      perform public.apply_wallet_transaction(
        p_client_id, 'debit', v_total,
        'Order payment ' || coalesce(nullif(p_external_order_number, ''), v_order.id::text),
        v_order.id::text
      );
      update public.orders
         set status = 'paid', payment_method = 'wallet', paid_at = now(), total_amount = v_total
       where id = v_order.id;
      perform public.release_order_to_fulfilment(v_order.id);
    exception when raise_exception then
      update public.orders set total_amount = v_total where id = v_order.id;
    end;
  else
    update public.orders set total_amount = v_total where id = v_order.id;
    insert into public.notifications (client_id, kind, title, body)
    values (
      p_client_id, 'order_awaiting_payment', 'Order awaiting payment',
      format('Order %s ($%s) is waiting for payment. Top up your wallet or pay it directly from the Orders page.',
        coalesce(nullif(p_external_order_number, ''), ''), to_char(v_total, 'FM999999990.00'))
    );
  end if;
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$$;
revoke all on function public.ingest_order(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_order(uuid, text, text, text, jsonb, jsonb) to service_role;

create or replace function public.release_awaiting_payment_orders(p_client_id uuid)
returns table(order_id uuid, amount numeric) language plpgsql security definer set search_path = public as $$
declare
  v_balance numeric;
  v_order record;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'Only admins or the service role can release orders';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_client_id::text));
  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.client_id = p_client_id
   order by wt.created_at desc, wt.id desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  for v_order in
    select o.id, o.total_amount, o.external_order_number
      from public.orders o
     where o.client_id = p_client_id and o.status = 'awaiting_payment'
     order by o.created_at asc, o.id asc
  loop
    exit when v_balance < v_order.total_amount;
    begin
      perform public.apply_wallet_transaction(
        p_client_id, 'debit', v_order.total_amount,
        'Order payment ' || coalesce(v_order.external_order_number, v_order.id::text),
        v_order.id::text
      );
    exception when raise_exception then
      exit;
    end;
    update public.orders
       set status = 'paid', payment_method = 'wallet', paid_at = now()
     where id = v_order.id and status = 'awaiting_payment';
    perform public.release_order_to_fulfilment(v_order.id);
    v_balance := v_balance - v_order.total_amount;
    order_id := v_order.id;
    amount := v_order.total_amount;
    return next;
  end loop;
end;
$$;

create or replace function public.admin_resolve_order_item(p_item_id uuid, p_product_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_price numeric;
  v_total numeric;
  v_balance numeric;
  v_unresolved integer;
  v_components integer;
  v_priced integer;
  v_line record;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'FORBIDDEN: admin access required';
  end if;
  select * into v_item from public.order_items where id = p_item_id;
  if not found then
    raise exception 'ORDER_ITEM_NOT_FOUND';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  if v_order.status <> 'needs_review' then
    raise exception 'ORDER_NOT_IN_REVIEW';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if not found or v_product.client_id <> v_order.client_id or v_product.status <> 'active' then
    raise exception 'INVALID_PRODUCT';
  end if;
  if v_product.product_type = 'bundle' then
    select count(*) into v_components from public.bundle_components bc
     where bc.bundle_product_id = v_product.id;
    select count(*), sum(pcp.unit_price * bc.quantity) into v_priced, v_price
      from public.bundle_components bc
      join public.product_country_prices pcp
        on pcp.product_id = bc.component_product_id and pcp.country_code = v_order.destination_country
     where bc.bundle_product_id = v_product.id;
    if v_priced < v_components then
      v_price := null;
    end if;
  else
    select pcp.unit_price into v_price
      from public.product_country_prices pcp
     where pcp.product_id = v_product.id and pcp.country_code = v_order.destination_country;
  end if;
  if v_price is null then
    raise exception 'NO_COUNTRY_PRICE: that product has no price for %', v_order.destination_country;
  end if;
  perform set_config('app.internal_write', 'on', true);
  update public.order_items set
    product_id = v_product.id,
    sku = v_product.sku,
    unit_price = v_price,
    line_total = round(v_price * greatest(1, coalesce(quantity, 1)), 2)
  where id = v_item.id;
  select count(*) into v_unresolved from public.order_items
   where order_id = v_order.id and (product_id is null or unit_price is null);
  if v_unresolved > 0 then
    select * into v_order from public.orders where id = v_order.id;
    return v_order;
  end if;
  select coalesce(sum(line_total), 0) into v_total
    from public.order_items where order_id = v_order.id;
  delete from public.order_fulfillment_items where order_id = v_order.id;
  for v_line in
    select product_id, greatest(1, coalesce(quantity, 1)) as qty
      from public.order_items where order_id = v_order.id
  loop
    insert into public.order_fulfillment_items (order_id, sku, quantity)
    select v_order.id, e.sku, e.quantity
      from public.explode_product(v_line.product_id, v_line.qty) e;
  end loop;
  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.client_id = v_order.client_id
   order by wt.created_at desc, wt.id desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  if v_balance >= v_total then
    begin
      perform public.apply_wallet_transaction(
        v_order.client_id, 'debit', v_total,
        'Order payment ' || coalesce(v_order.external_order_number, v_order.id::text),
        v_order.id::text
      );
      update public.orders
         set status = 'paid', payment_method = 'wallet', paid_at = now(),
             total_amount = v_total, needs_review_reason = null
       where id = v_order.id;
      perform public.release_order_to_fulfilment(v_order.id);
    exception when raise_exception then
      update public.orders
         set status = 'awaiting_payment', total_amount = v_total, needs_review_reason = null
       where id = v_order.id;
    end;
  else
    update public.orders
       set status = 'awaiting_payment', total_amount = v_total, needs_review_reason = null
     where id = v_order.id;
    insert into public.notifications (client_id, kind, title, body)
    values (
      v_order.client_id, 'order_awaiting_payment', 'Order awaiting payment',
      format('Order %s ($%s) was resolved and is waiting for payment.',
        coalesce(v_order.external_order_number, ''), to_char(v_total, 'FM999999990.00'))
    );
  end if;
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$$;