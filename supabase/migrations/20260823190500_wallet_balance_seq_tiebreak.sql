-- Deterministic wallet balance reads: same-instant movements now tie-break by
-- the identity column (seq = insertion order) instead of the random UUID id.
-- Matches apply_wallet_transaction and the app-side readers.

CREATE OR REPLACE FUNCTION public.admin_resolve_order_item(p_item_id uuid, p_product_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_entity_id uuid;
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
  if not found or v_product.store_id <> v_order.store_id or v_product.status <> 'active' then
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
  select s.entity_id into v_entity_id from public.stores s where s.id = v_order.store_id;
  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.entity_id = v_entity_id
   order by wt.created_at desc, wt.seq desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  if v_balance >= v_total then
    begin
      perform public.apply_wallet_transaction(
        v_entity_id, 'debit', v_total,
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
    insert into public.notifications (entity_id, kind, title, body)
    values (
      v_entity_id, 'order_awaiting_payment', 'Order awaiting payment',
      format('Order %s ($%s) was resolved and is waiting for payment.',
        coalesce(v_order.external_order_number, ''), to_char(v_total, 'FM999999990.00'))
    );
  end if;
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_order_internal(p_store_id uuid, p_customer jsonb, p_shipping jsonb, p_client_reference text, p_lines jsonb)
 RETURNS orders
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
  -- Suspension gate: covers manual creation AND CSV import (both come
  -- through this internal path). Refuse new orders while suspended.
  if exists (
    select 1
      from public.entities e
      join public.profiles p on p.id = e.account_id
     where e.id = v_entity_id
       and (e.status = 'suspended' or p.status = 'suspended')
  ) then
    raise exception 'ACCOUNT_SUSPENDED: this account is suspended — order creation is disabled';
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
   order by wt.created_at desc, wt.seq desc
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

CREATE OR REPLACE FUNCTION public.ingest_order(p_store_id uuid, p_external_order_id text, p_external_order_number text, p_destination_country text, p_shipping_address jsonb, p_line_items jsonb)
 RETURNS orders
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
  v_country text := upper(trim(coalesce(p_destination_country, '')));
  v_review text := null;
  v_components integer;
  v_priced integer;
  v_entity_id uuid;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN: order intake is internal';
  end if;
  if p_line_items is null or jsonb_typeof(p_line_items) <> 'array' or jsonb_array_length(p_line_items) = 0 then
    raise exception 'ORDER_REQUIRES_ITEMS';
  end if;
  select s.entity_id into v_entity_id
    from public.stores s
   where s.id = p_store_id;
  if v_entity_id is null then
    raise exception 'STORE_NOT_FOUND';
  end if;
  -- Suspension gate: webhook/middleware intake refuses new orders for
  -- suspended accounts with a clear reason.
  if exists (
    select 1
      from public.entities e
      join public.profiles p on p.id = e.account_id
     where e.id = v_entity_id
       and (e.status = 'suspended' or p.status = 'suspended')
  ) then
    raise exception 'ACCOUNT_SUSPENDED: order intake refused — this account is suspended';
  end if;
  if nullif(p_external_order_id, '') is not null then
    select * into v_order from public.orders
     where store_id = p_store_id and external_order_id = p_external_order_id;
    if found then
      return v_order;
    end if;
  end if;
  perform set_config('app.internal_write', 'on', true);
  insert into public.orders (
    store_id, external_order_id, external_order_number,
    destination_country, shipping_address, status
  ) values (
    p_store_id, nullif(p_external_order_id, ''), p_external_order_number,
    v_country, coalesce(p_shipping_address, '{}'::jsonb), 'awaiting_payment'
  ) returning * into v_order;
  for v_item in select * from jsonb_array_elements(p_line_items) loop
    v_qty := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_price := null;
    select * into v_product from public.products
     where store_id = p_store_id and sku = v_item->>'sku' and status = 'active';
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
   where wt.entity_id = v_entity_id
   order by wt.created_at desc, wt.seq desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  if v_balance >= v_total then
    begin
      perform public.apply_wallet_transaction(
        v_entity_id, 'debit', v_total,
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
    insert into public.notifications (entity_id, kind, title, body)
    values (
      v_entity_id, 'order_awaiting_payment', 'Order awaiting payment',
      format('Order %s ($%s) is waiting for payment. Top up your wallet or pay it directly from the Orders page.',
        coalesce(nullif(p_external_order_number, ''), ''), to_char(v_total, 'FM999999990.00'))
    );
  end if;
  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pay_orders_from_wallet(p_order_ids uuid[])
 RETURNS TABLE(order_id uuid, amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entity_count integer;
  v_entity_id uuid;
  v_total numeric;
  v_balance numeric;
  v_order record;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'NO_ORDERS_SELECTED';
  end if;

  -- Wallet writes below go through apply_wallet_transaction on the caller's
  -- behalf; mark this audited function as an internal writer.
  perform set_config('app.internal_write', 'on', true);

  -- Only the caller's own, still-payable orders participate.
  select count(distinct s.entity_id), min(s.entity_id::text)::uuid
    into v_entity_count, v_entity_id
    from public.orders o
    join public.stores s on s.id = o.store_id
    join public.entities e on e.id = s.entity_id
   where o.id = any (p_order_ids)
     and o.status = 'awaiting_payment'
     and o.total_amount is not null
     and e.account_id = auth.uid();

  if v_entity_count = 0 then
    raise exception 'NO_PAYABLE_ORDERS: none of the selected orders are awaiting payment';
  end if;
  if v_entity_count > 1 then
    raise exception 'MIXED_ENTITIES: pay orders one entity at a time';
  end if;

  -- Frozen while suspended: awaiting_payment orders cannot be paid until the
  -- account is reactivated. They are NOT cancelled here — the normal 7-day
  -- expiry cycle still applies.
  if exists (
    select 1
      from public.entities e
      join public.profiles p on p.id = e.account_id
     where e.id = v_entity_id
       and (e.status = 'suspended' or p.status = 'suspended')
  ) then
    raise exception 'ACCOUNT_SUSPENDED: payments are frozen while this account is suspended';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_entity_id::text));

  -- Totals are re-read from the database — never trusted from the client.
  select coalesce(sum(o.total_amount), 0) into v_total
    from public.orders o
    join public.stores s on s.id = o.store_id
    join public.entities e on e.id = s.entity_id
   where o.id = any (p_order_ids)
     and o.status = 'awaiting_payment'
     and o.total_amount is not null
     and e.account_id = auth.uid();

  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.entity_id = v_entity_id
   order by wt.created_at desc, wt.seq desc
   limit 1;
  v_balance := coalesce(v_balance, 0);

  if v_balance < v_total then
    raise exception 'INSUFFICIENT_BALANCE: the selected orders total $% but the wallet balance is $%',
      to_char(v_total, 'FM999999990.00'), to_char(v_balance, 'FM999999990.00');
  end if;

  for v_order in
    select o.id, o.total_amount, o.external_order_number
      from public.orders o
      join public.stores s on s.id = o.store_id
      join public.entities e on e.id = s.entity_id
     where o.id = any (p_order_ids)
       and o.status = 'awaiting_payment'
       and o.total_amount is not null
       and e.account_id = auth.uid()
     order by o.created_at asc, o.id asc
  loop
    begin
      perform public.apply_wallet_transaction(
        v_entity_id,
        'debit',
        v_order.total_amount,
        'Order payment ' || coalesce(v_order.external_order_number, v_order.id::text),
        v_order.id::text
      );
    exception when raise_exception then
      -- Reference clash = paid through another path in the meantime; skip.
      continue;
    end;
    update public.orders
       set status = 'paid', payment_method = 'wallet', paid_at = now()
     where id = v_order.id and status = 'awaiting_payment';
    if found then
      perform public.release_order_to_fulfilment(v_order.id);
      order_id := v_order.id;
      amount := v_order.total_amount;
      return next;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_awaiting_payment_orders(p_entity_id uuid)
 RETURNS TABLE(order_id uuid, amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_order record;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'Only admins or the service role can release orders';
  end if;
  if not exists (select 1 from public.entities where id = p_entity_id) then
    raise exception 'ENTITY_NOT_FOUND';
  end if;

  -- Frozen while suspended: a top-up that settles during suspension still
  -- credits the wallet (money received is never refused) but must NOT
  -- release orders. Silent no-op so webhook/cron callers stay clean.
  if exists (
    select 1
      from public.entities e
      join public.profiles p on p.id = e.account_id
     where e.id = p_entity_id
       and (e.status = 'suspended' or p.status = 'suspended')
  ) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_entity_id::text));
  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.entity_id = p_entity_id
   order by wt.created_at desc, wt.seq desc
   limit 1;
  v_balance := coalesce(v_balance, 0);
  for v_order in
    select o.id, o.total_amount, o.external_order_number
      from public.orders o
      join public.stores s on s.id = o.store_id
     where s.entity_id = p_entity_id and o.status = 'awaiting_payment'
     order by o.created_at asc, o.id asc
  loop
    exit when v_balance < v_order.total_amount;
    begin
      perform public.apply_wallet_transaction(
        p_entity_id, 'debit', v_order.total_amount,
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
$function$;

