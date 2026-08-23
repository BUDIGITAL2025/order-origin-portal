-- Suspension gates (I2): a suspended account keeps in-flight PAID work
-- (fulfilment, tracking, disputes, wallet refunds) but cannot start new
-- unpaid work: quote submissions, order creation (manual/CSV/intake),
-- wallet/batch payments of awaiting_payment orders, and auto-release after
-- top-ups. Mirrors the existing SUBSCRIPTION_REQUIRED gate pattern.

CREATE OR REPLACE FUNCTION public.submit_quote_request(p_product_url text default null, p_product_name text default null, p_notes text default null, p_target_monthly_volume integer default null, p_image_urls text[] default null, p_supersedes_quote_id uuid default null, p_on_behalf_of uuid default null, p_target_countries text[] default null, p_store_id uuid default null, p_preview_id uuid default null)
RETURNS public.quote_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_account_id uuid;
  v_store public.stores%rowtype;
  v_entity public.entities%rowtype;
  v_month_start date := date_trunc('month', current_date)::date;
  v_quota integer;
  v_row public.quote_requests%rowtype;
  v_countries text[];
  v_has_subscription_receipt boolean;
begin
  if v_caller is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Quota bookkeeping below writes protected store columns from inside this
  -- audited definer function; allow it through the store guard trigger.
  perform set_config('app.internal_write', 'on', true);

  v_is_admin := public.has_role(v_caller, 'admin');
  v_account_id := coalesce(p_on_behalf_of, v_caller);
  if p_on_behalf_of is not null and not v_is_admin then
    raise exception 'NOT_AUTHORISED: only admins may submit on behalf of a client';
  end if;

  if p_supersedes_quote_id is null then
    if p_product_url is null or p_target_countries is null or array_length(p_target_countries, 1) is null then
      raise exception 'MISSING_FIELDS: product url and at least one target country are required';
    end if;
  end if;

  if p_store_id is not null then
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where s.id = p_store_id
       and (v_is_admin or e.account_id = v_caller);
    if not found then
      raise exception 'NOT_AUTHORISED: store does not belong to you';
    end if;
    if v_is_admin then
      v_account_id := (select e.account_id from public.entities e where e.id = v_store.entity_id);
    end if;
  else
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where e.account_id = v_account_id
     order by (s.subscription_status in ('active','past_due') or s.fee_waived) desc,
              s.created_at
     limit 1;

    if not found then
      select e.* into v_entity
        from public.entities e
       where e.account_id = v_account_id
       order by e.created_at
       limit 1;
      if not found then
        insert into public.entities (account_id, legal_name)
        values (
          v_account_id,
          coalesce((select p.contact_name from public.profiles p where p.id = v_account_id), 'My company')
        )
        returning * into v_entity;
      end if;

      select exists (
        select 1 from public.documents d
         where d.entity_id = v_entity.id
           and d.document_type = 'subscription'
      ) into v_has_subscription_receipt;

      insert into public.stores (
        entity_id, platform, store_url, store_name, integration_mode, status,
        subscription_plan, subscription_status
      )
      values (
        v_entity.id, 'other', null, 'My workspace', 'manual', 'draft',
        'basic', case when v_has_subscription_receipt then 'active'::public.subscription_status else 'none'::public.subscription_status end
      )
      returning * into v_store;
    end if;
  end if;

  -- Suspension gate, same shape as the subscription gate below: suspension
  -- blocks NEW unpaid work only; in-flight paid work is untouched. Admins
  -- submitting on behalf of a client bypass it, exactly like SUBSCRIPTION_REQUIRED.
  if not v_is_admin then
    if exists (
      select 1
        from public.entities e
        join public.profiles p on p.id = e.account_id
       where e.id = v_store.entity_id
         and (e.status = 'suspended' or p.status = 'suspended')
    ) then
      raise exception 'ACCOUNT_SUSPENDED: this account is suspended — contact your account manager';
    end if;
  end if;

  if p_supersedes_quote_id is null then
    if not v_is_admin then
      if not (v_store.subscription_status in ('active','past_due') or v_store.fee_waived) then
        raise exception 'SUBSCRIPTION_REQUIRED: an active subscription is needed to request quotes';
      end if;
    end if;

    if v_store.quotes_period_start is distinct from v_month_start then
      update public.stores
         set quotes_period_start = v_month_start, quotes_used_this_month = 0
       where id = v_store.id;
      v_store.quotes_used_this_month := 0;
    end if;
    v_quota := case when v_store.subscription_plan = 'unlimited' then null else 5 end;
    if not v_is_admin and v_quota is not null and v_store.quotes_used_this_month >= v_quota then
      raise exception 'QUOTE_LIMIT_REACHED: monthly quote quota used up for this store';
    end if;
  end if;

  if p_supersedes_quote_id is not null then
    insert into public.quote_requests
      (store_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, supersedes_quote_id, target_countries, preview_id)
    select v_store.id, q.product_url, q.product_name, q.notes, q.target_monthly_volume, q.image_urls, 'submitted', q.id, q.target_countries, q.preview_id
      from public.quote_requests q
     where q.id = p_supersedes_quote_id
    returning * into v_row;
    if not found then
      raise exception 'QUOTE_NOT_FOUND';
    end if;
  else
    v_countries := array(select distinct c from unnest(p_target_countries) c order by c);
    insert into public.quote_requests
      (store_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, target_countries, preview_id)
    values
      (v_store.id, p_product_url, p_product_name, p_notes, p_target_monthly_volume, coalesce(p_image_urls, '{}'), 'submitted', v_countries, p_preview_id)
    returning * into v_row;
    update public.stores set quotes_used_this_month = quotes_used_this_month + 1 where id = v_store.id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_order_internal(p_store_id uuid, p_customer jsonb, p_shipping jsonb, p_client_reference text, p_lines jsonb)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.ingest_order(p_store_id uuid, p_external_order_id text, p_external_order_number text, p_destination_country text, p_shipping_address jsonb, p_line_items jsonb)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
   order by wt.created_at desc, wt.id desc
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
SET search_path = public
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

  -- Only the caller's own, still-payable orders participate.
  select count(distinct s.entity_id), min(s.entity_id)
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
   order by wt.created_at desc, wt.id desc
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
SET search_path = public
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
   order by wt.created_at desc, wt.id desc
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
