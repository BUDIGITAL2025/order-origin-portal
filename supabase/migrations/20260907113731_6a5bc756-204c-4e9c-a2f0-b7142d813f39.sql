-- ============ Enums ============
create type public.fulfilment_model as enum ('per_order', 'stock_in');
create type public.inbound_status as enum ('declared', 'in_transit', 'received', 'completed', 'refused');

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============ Products ============
alter table public.products
  add column fulfilment_model public.fulfilment_model not null default 'per_order',
  add column client_owned boolean not null default false,
  add column image_urls text[] not null default '{}';

create or replace function public.guard_product_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
     or new.store_id is distinct from old.store_id
     or new.quote_line_id is distinct from old.quote_line_id
     or new.product_type is distinct from old.product_type
     or new.moq is distinct from old.moq
     or new.variant_label is distinct from old.variant_label
     or new.supplier_id is distinct from old.supplier_id
     or new.production_lead_days is distinct from old.production_lead_days
     or new.transit_lead_days is distinct from old.transit_lead_days
     or new.safety_margin_days is distinct from old.safety_margin_days
     or new.fulfilment_model is distinct from old.fulfilment_model
     or new.client_owned is distinct from old.client_owned
  then
    raise exception 'FORBIDDEN_PRODUCT_FIELD';
  end if;
  if new.status is distinct from old.status and new.status <> 'discontinued' then
    raise exception 'FORBIDDEN_STATUS_CHANGE';
  end if;
  return new;
end;
$function$;

-- ============ Stock-in outbound pricing (fees only) ============
create table public.stock_in_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  country_code text not null,
  fulfilment_fee numeric not null default 0,
  shipping_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, country_code)
);

grant select on public.stock_in_prices to authenticated;
grant all on public.stock_in_prices to service_role;
alter table public.stock_in_prices enable row level security;

create policy "Clients read their own stock-in prices"
  on public.stock_in_prices for select to authenticated
  using (exists (
    select 1 from public.products p
      join public.stores s on s.id = p.store_id
      join public.entities e on e.id = s.entity_id
     where p.id = stock_in_prices.product_id and e.account_id = auth.uid()
  ));

create policy "Admins read all stock-in prices"
  on public.stock_in_prices for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create trigger stock_in_prices_touch
  before update on public.stock_in_prices
  for each row execute function public.touch_updated_at();

-- ============ Inbound shipments ============
create table public.inbound_shipments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  status public.inbound_status not null default 'declared',
  qc boolean not null default false,
  service_fee_per_piece numeric not null default 0.50,
  qc_fee_per_piece numeric not null default 0.20,
  tracking_number text,
  tracking_carrier text,
  warehouse_reference text not null default 'FS-WH-01',
  declared_pieces integer not null default 0,
  counted_pieces integer,
  has_discrepancy boolean not null default false,
  fee_charged numeric,
  wallet_reference text,
  refusal_reason text,
  in_transit_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inbound_shipments_store_idx on public.inbound_shipments (store_id, created_at desc);

grant select on public.inbound_shipments to authenticated;
grant all on public.inbound_shipments to service_role;
alter table public.inbound_shipments enable row level security;

create policy "Clients read their own inbound shipments"
  on public.inbound_shipments for select to authenticated
  using (exists (
    select 1 from public.entities e
     where e.id = inbound_shipments.entity_id and e.account_id = auth.uid()
  ));

create policy "Admins read all inbound shipments"
  on public.inbound_shipments for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create trigger inbound_shipments_touch
  before update on public.inbound_shipments
  for each row execute function public.touch_updated_at();

create table public.inbound_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inbound_shipments(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  declared_qty integer not null,
  counted_qty integer,
  created_at timestamptz not null default now()
);

create index inbound_shipment_lines_shipment_idx on public.inbound_shipment_lines (shipment_id);

grant select on public.inbound_shipment_lines to authenticated;
grant all on public.inbound_shipment_lines to service_role;
alter table public.inbound_shipment_lines enable row level security;

create policy "Clients read their own inbound lines"
  on public.inbound_shipment_lines for select to authenticated
  using (exists (
    select 1 from public.inbound_shipments s
      join public.entities e on e.id = s.entity_id
     where s.id = inbound_shipment_lines.shipment_id and e.account_id = auth.uid()
  ));

create policy "Admins read all inbound lines"
  on public.inbound_shipment_lines for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ============ Client-owned products ============
create or replace function public.create_client_product(
  p_store_id uuid,
  p_name text,
  p_variants jsonb,
  p_image_urls text[] default '{}'
)
returns setof public.products
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_variant jsonb;
  v_label text;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_name is null then raise exception 'NAME_REQUIRED'; end if;
  if not exists (
    select 1 from public.stores s join public.entities e on e.id = s.entity_id
     where s.id = p_store_id and e.account_id = auth.uid()
  ) then
    raise exception 'STORE_NOT_FOUND';
  end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'VARIANTS_REQUIRED';
  end if;

  perform set_config('app.internal_write', 'on', true);

  for v_variant in select * from jsonb_array_elements(p_variants) loop
    v_label := nullif(trim(coalesce(v_variant->>'label', '')), '');
    if v_label is null then raise exception 'VARIANT_LABEL_REQUIRED'; end if;
    v_count := v_count + 1;
    return query
      insert into public.products
        (store_id, sku, product_name, variant_label, product_type, status,
         fulfilment_model, client_owned, image_urls)
      values
        (p_store_id, public.generate_sku('FS-'), v_name, v_label, 'simple', 'active',
         'stock_in', true, coalesce(p_image_urls, '{}'))
      returning *;
  end loop;

  perform set_config('app.internal_write', 'off', true);
  return;
end;
$$;

revoke all on function public.create_client_product(uuid, text, jsonb, text[]) from public;
grant execute on function public.create_client_product(uuid, text, jsonb, text[]) to authenticated;

-- ============ Declare an inbound shipment ============
create or replace function public.declare_inbound_shipment(
  p_store_id uuid,
  p_qc boolean,
  p_lines jsonb
)
returns public.inbound_shipments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entity_id uuid;
  v_shipment public.inbound_shipments%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_total integer := 0;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;

  select e.id into v_entity_id
    from public.stores s join public.entities e on e.id = s.entity_id
   where s.id = p_store_id and e.account_id = auth.uid();
  if v_entity_id is null then raise exception 'STORE_NOT_FOUND'; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'LINES_REQUIRED';
  end if;

  insert into public.inbound_shipments (store_id, entity_id, qc, created_by)
  values (p_store_id, v_entity_id, coalesce(p_qc, false), auth.uid())
  returning * into v_shipment;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'quantity')::integer, 0);
    select * into v_product from public.products
     where id = (v_line->>'product_id')::uuid and store_id = p_store_id;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_product.fulfilment_model <> 'stock_in' then raise exception 'NOT_STOCK_IN'; end if;
    if v_qty < 10 then raise exception 'MIN_10_UNITS'; end if;
    v_total := v_total + v_qty;
    insert into public.inbound_shipment_lines
      (shipment_id, product_id, sku, product_name, declared_qty)
    values
      (v_shipment.id, v_product.id, v_product.sku,
       v_product.product_name || coalesce(' — ' || v_product.variant_label, ''), v_qty);
  end loop;

  update public.inbound_shipments set declared_pieces = v_total
   where id = v_shipment.id returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke all on function public.declare_inbound_shipment(uuid, boolean, jsonb) from public;
grant execute on function public.declare_inbound_shipment(uuid, boolean, jsonb) to authenticated;

-- ============ Tracking ============
create or replace function public.set_inbound_tracking(
  p_shipment_id uuid,
  p_tracking_number text,
  p_tracking_carrier text
)
returns public.inbound_shipments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shipment public.inbound_shipments%rowtype;
  v_num text := nullif(trim(coalesce(p_tracking_number, '')), '');
  v_car text := nullif(trim(coalesce(p_tracking_carrier, '')), '');
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_num is null or v_car is null then raise exception 'TRACKING_REQUIRED'; end if;

  select s.* into v_shipment from public.inbound_shipments s
    join public.entities e on e.id = s.entity_id
   where s.id = p_shipment_id
     and (e.account_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status not in ('declared', 'in_transit') then raise exception 'INVALID_STATUS'; end if;

  update public.inbound_shipments
     set tracking_number = v_num,
         tracking_carrier = v_car,
         status = 'in_transit',
         in_transit_at = coalesce(in_transit_at, now())
   where id = p_shipment_id
  returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke all on function public.set_inbound_tracking(uuid, text, text) from public;
grant execute on function public.set_inbound_tracking(uuid, text, text) to authenticated;

-- ============ Admin: confirm receipt (counted quantities, single wallet debit) ============
create or replace function public.admin_confirm_inbound_receipt(
  p_shipment_id uuid,
  p_counts jsonb
)
returns public.inbound_shipments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shipment public.inbound_shipments%rowtype;
  v_count jsonb;
  v_line public.inbound_shipment_lines%rowtype;
  v_qty integer;
  v_total integer := 0;
  v_discrepancy boolean := false;
  v_fee numeric;
  v_reference text;
  v_existing integer;
begin
  if not (public.has_role(auth.uid(), 'admin') or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_shipment from public.inbound_shipments where id = p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status in ('completed', 'refused') then raise exception 'ALREADY_CLOSED'; end if;

  -- Apply counted quantities (default to declared when not provided)
  if p_counts is not null and jsonb_typeof(p_counts) = 'array' then
    for v_count in select * from jsonb_array_elements(p_counts) loop
      update public.inbound_shipment_lines
         set counted_qty = greatest(coalesce((v_count->>'counted_qty')::integer, 0), 0)
       where id = (v_count->>'line_id')::uuid and shipment_id = p_shipment_id;
    end loop;
  end if;

  update public.inbound_shipment_lines
     set counted_qty = declared_qty
   where shipment_id = p_shipment_id and counted_qty is null;

  for v_line in select * from public.inbound_shipment_lines where shipment_id = p_shipment_id loop
    v_qty := coalesce(v_line.counted_qty, 0);
    v_total := v_total + v_qty;
    if v_qty <> v_line.declared_qty then v_discrepancy := true; end if;

    -- Write received stock into the fulfilment centre snapshot
    insert into public.inventory_snapshots (store_id, sku, location, quantity, captured_at)
    values (
      v_shipment.store_id,
      v_line.sku,
      'Fulfilment center',
      coalesce((
        select i.quantity from public.inventory_snapshots i
         where i.store_id = v_shipment.store_id and i.sku = v_line.sku
           and i.location = 'Fulfilment center'
         order by i.captured_at desc limit 1
      ), 0) + v_qty,
      now()
    );
  end loop;

  v_fee := round(v_total * (v_shipment.service_fee_per_piece + case when v_shipment.qc then v_shipment.qc_fee_per_piece else 0 end), 2);
  v_reference := 'inbound:' || p_shipment_id::text;

  select count(*) into v_existing from public.wallet_transactions where reference = v_reference;

  if v_existing = 0 and v_fee > 0 then
    perform public.apply_wallet_transaction(
      v_shipment.entity_id,
      'debit',
      v_fee,
      'Inbound service fee — ' || v_total || ' pieces',
      v_reference,
      auth.uid()
    );
  end if;

  update public.inbound_shipments
     set status = 'completed',
         counted_pieces = v_total,
         has_discrepancy = v_discrepancy,
         fee_charged = v_fee,
         wallet_reference = v_reference,
         received_at = coalesce(received_at, now()),
         completed_at = now()
   where id = p_shipment_id
  returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke all on function public.admin_confirm_inbound_receipt(uuid, jsonb) from public;
grant execute on function public.admin_confirm_inbound_receipt(uuid, jsonb) to service_role;

-- ============ Admin: refuse ============
create or replace function public.admin_refuse_inbound(
  p_shipment_id uuid,
  p_reason text
)
returns public.inbound_shipments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shipment public.inbound_shipments%rowtype;
begin
  if not (public.has_role(auth.uid(), 'admin') or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN';
  end if;
  update public.inbound_shipments
     set status = 'refused',
         refusal_reason = nullif(trim(coalesce(p_reason, '')), ''),
         completed_at = now()
   where id = p_shipment_id and status <> 'completed'
  returning * into v_shipment;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  return v_shipment;
end;
$$;

revoke all on function public.admin_refuse_inbound(uuid, text) from public;
grant execute on function public.admin_refuse_inbound(uuid, text) to service_role;

-- ============ Stock-in order handling ============
create or replace function public.stock_in_available(p_store_id uuid, p_sku text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select i.quantity from public.inventory_snapshots i
     where i.store_id = p_store_id and i.sku = p_sku and i.location = 'Fulfilment center'
     order by i.captured_at desc limit 1
  ), 0)
$$;

-- Orders that need stock they do not have land in needs_review instead of production.
create or replace function public.release_order_to_fulfilment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_short boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.status <> 'paid' then return; end if;

  select exists (
    select 1
      from public.order_items oi
      join public.products p on p.id = oi.product_id
     where oi.order_id = p_order_id
       and p.fulfilment_model = 'stock_in'
       and public.stock_in_available(v_order.store_id, p.sku) < coalesce(oi.quantity, 0)
  ) into v_short;

  if v_short then
    update public.orders
       set status = 'needs_review',
           needs_review_reason = 'insufficient stock'
     where id = p_order_id;
    return;
  end if;

  update public.orders set status = 'processing'
   where id = p_order_id and status = 'paid';
end;
$$;

-- On shipment, decrement fulfilment-centre stock for stock_in lines.
create or replace function public.decrement_stock_in_on_ship()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item record;
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    for v_item in
      select p.sku, oi.quantity
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = new.id and p.fulfilment_model = 'stock_in'
    loop
      insert into public.inventory_snapshots (store_id, sku, location, quantity, captured_at)
      values (
        new.store_id, v_item.sku, 'Fulfilment center',
        greatest(public.stock_in_available(new.store_id, v_item.sku) - coalesce(v_item.quantity, 0), 0),
        now()
      );
    end loop;
  end if;
  return new;
end;
$$;

create trigger orders_decrement_stock_in
  after update on public.orders
  for each row execute function public.decrement_stock_in_on_ship();