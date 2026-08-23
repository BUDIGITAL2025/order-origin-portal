-- 1. Manual mode: accepting a quote no longer requires a connected store.
-- Products are created in the workspace catalogue either way; without a
-- connected store they simply have nowhere external to be pushed to.
CREATE OR REPLACE FUNCTION public.respond_to_quote_lines(p_quote_id uuid, p_product_name text, p_decisions jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.quote_requests%rowtype;
  v_decision jsonb;
  v_line public.quote_lines%rowtype;
  v_product_id uuid;
  v_accepted integer := 0;
  v_pending integer;
begin
  select * into v_request from public.quote_requests where id = p_quote_id for update;
  if not found or not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = v_request.store_id and e.account_id = auth.uid()
  ) then
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
       where p.store_id = v_request.store_id and p.sku = v_line.sku;
      if v_product_id is null then
        insert into public.products (
          store_id, quote_line_id, sku, product_name, variant_label,
          product_type, moq, status, push_status
        ) values (
          v_request.store_id, v_line.id, v_line.sku, trim(p_product_name), v_line.variant_label,
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
$function$;

-- 2. Tracking on orders: set by the middleware (or admin) when a parcel
-- ships. tracking_notified_at enforces at-most-one client email per order.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tracking_carrier text,
  ADD COLUMN IF NOT EXISTS tracking_notified_at timestamptz;

-- 3. Manual orders. Internal helper mirrors ingest_order's settle path
-- (freeze prices, explode bundles, wallet debit or awaiting_payment) but
-- BLOCKS on unknown SKU / unpriced country instead of needs_review — in
-- manual mode the client fixes input upfront. Customer details ride in the
-- shipping_address jsonb alongside the address.
CREATE OR REPLACE FUNCTION public.create_manual_order_internal(
  p_store_id uuid,
  p_customer jsonb,
  p_shipping jsonb,
  p_client_reference text,
  p_lines jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_price numeric;
  v_qty integer;
  v_total numeric := 0;
  v_balance numeric;
  v_country text := upper(trim(coalesce(p_shipping->>'country', '')));
  v_components integer;
  v_priced integer;
  v_entity_id uuid;
  v_number text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ORDER_REQUIRES_ITEMS';
  end if;
  if v_country = '' or length(v_country) <> 2 then
    raise exception 'DESTINATION_COUNTRY_REQUIRED';
  end if;
  select s.entity_id into v_entity_id from public.stores s where s.id = p_store_id;
  if v_entity_id is null then
    raise exception 'STORE_NOT_FOUND';
  end if;
  -- Idempotency on the client's own reference.
  if nullif(trim(coalesce(p_client_reference, '')), '') is not null then
    select * into v_order from public.orders
     where store_id = p_store_id and external_order_id = trim(p_client_reference);
    if found then
      return v_order;
    end if;
  end if;
  v_number := 'M-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  perform set_config('app.internal_write', 'on', true);
  insert into public.orders (
    store_id, external_order_id, external_order_number,
    destination_country, shipping_address, status
  ) values (
    p_store_id,
    nullif(trim(coalesce(p_client_reference, '')), ''),
    v_number,
    v_country,
    jsonb_build_object(
      'name', p_customer->>'name',
      'email', p_customer->>'email',
      'phone', p_customer->>'phone',
      'address1', p_shipping->>'address1',
      'address2', nullif(p_shipping->>'address2', ''),
      'city', p_shipping->>'city',
      'postal_code', nullif(p_shipping->>'postal_code', ''),
      'state', nullif(p_shipping->>'state', ''),
      'country', v_country
    ),
    'awaiting_payment'
  ) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_qty := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_price := null;
    select * into v_product from public.products
     where store_id = p_store_id and sku = v_item->>'sku' and status = 'active';
    if not found then
      raise exception 'UNKNOWN_SKU: % is not in this workspace catalogue', v_item->>'sku';
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
      raise exception 'COUNTRY_NOT_PRICED: % has no price for % — request a requote for that country', v_product.sku, v_country;
    end if;
    insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total)
    values (v_order.id, v_product.id, v_product.sku, v_qty, v_price, round(v_price * v_qty, 2));
    v_total := v_total + round(v_price * v_qty, 2);
    insert into public.order_fulfillment_items (order_id, sku, quantity)
    select v_order.id, e.sku, e.quantity
      from public.explode_product(v_product.id, v_qty) e;
  end loop;
  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.entity_id = v_entity_id
   order by wt.created_at desc, wt.id desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  if v_balance >= v_total then
    begin
      perform public.apply_wallet_transaction(
        v_entity_id, 'debit', v_total,
        'Order payment ' || v_number,
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
    insert into public.notifications (entity_id, kind, title, body)
    values (
      v_entity_id, 'order_awaiting_payment', 'Order awaiting payment',
      format('Order %s ($%s) is waiting for payment. Top up your wallet or pay it directly from the Orders page.',
        v_number, to_char(v_total, 'FM999999990.00'))
    );
  end if;
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$function$;

-- 4. Single manual order, client-facing. Verifies the caller owns the
-- workspace via the entity chain.
CREATE OR REPLACE FUNCTION public.create_manual_order(
  p_store_id uuid,
  p_customer jsonb,
  p_shipping jsonb,
  p_client_reference text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = p_store_id and e.account_id = auth.uid()
  ) then
    raise exception 'STORE_NOT_FOUND';
  end if;
  return public.create_manual_order_internal(p_store_id, p_customer, p_shipping, p_client_reference, p_lines);
end;
$function$;

-- 5. Bulk CSV import: rows for the same customer + address arrive pre-grouped
-- by the caller; every group is validated and created in this one
-- transaction, so a failing group aborts the whole import.
CREATE OR REPLACE FUNCTION public.import_manual_orders(
  p_store_id uuid,
  p_orders jsonb
)
RETURNS TABLE(order_id uuid, order_number text, total numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_group jsonb;
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = p_store_id and e.account_id = auth.uid()
  ) then
    raise exception 'STORE_NOT_FOUND';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'IMPORT_REQUIRES_ROWS';
  end if;
  if jsonb_array_length(p_orders) > 200 then
    raise exception 'IMPORT_TOO_LARGE: max 200 orders per import';
  end if;
  for v_group in select * from jsonb_array_elements(p_orders) loop
    v_order := public.create_manual_order_internal(
      p_store_id,
      v_group->'customer',
      v_group->'shipping',
      v_group->>'client_reference',
      v_group->'lines'
    );
    order_id := v_order.id;
    order_number := v_order.external_order_number;
    total := v_order.total_amount;
    status := v_order.status::text;
    return next;
  end loop;
  return;
end;
$function$;