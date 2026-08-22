-- Step 3: remove legacy client-level columns now that the Account → Entity → Store
-- hierarchy is verified. Transactional: any failure rolls back everything.

-- 0. Move pricing-tier machinery from profiles to stores
ALTER TABLE public.stores
  ADD COLUMN pricing_tier public.pricing_tier NOT NULL DEFAULT 'starter',
  ADD COLUMN tier_override public.pricing_tier,
  ADD COLUMN avg_daily_units_30d numeric NOT NULL DEFAULT 0;

UPDATE public.stores s
SET pricing_tier = p.pricing_tier,
    tier_override = p.tier_override,
    avg_daily_units_30d = p.avg_daily_units_30d
FROM public.entities e
JOIN public.profiles p ON p.id = e.account_id
WHERE s.entity_id = e.id;

DROP TRIGGER profiles_recalc_pricing_tier ON public.profiles;
CREATE TRIGGER stores_recalc_pricing_tier
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.recalc_pricing_tier();

-- 1. Rewrite profiles INSERT policy + guard BEFORE dropping columns
DROP POLICY "Users create their own pending profile" ON public.profiles;
CREATE POLICY "Users create their own pending profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND status = 'pending'::public.profile_status);

CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancel_notice_sent_at IS DISTINCT FROM OLD.cancel_notice_sent_at THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Per-store SKU uniqueness and per-store external order ids
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;
DROP INDEX IF EXISTS public.products_sku_key;
CREATE UNIQUE INDEX products_store_sku_key ON public.products (store_id, sku);

DROP INDEX IF EXISTS public.orders_client_external_unique;
CREATE UNIQUE INDEX orders_store_external_unique
  ON public.orders (store_id, external_order_id)
  WHERE external_order_id IS NOT NULL;

-- 3. Documents issued to the ENTITY
ALTER TABLE public.documents ADD COLUMN entity_id uuid REFERENCES public.entities(id);

UPDATE public.documents d
SET entity_id = w.entity_id
FROM public.wallet_transactions w
WHERE d.wallet_transaction_id = w.id AND d.entity_id IS NULL;

UPDATE public.documents d
SET entity_id = s.entity_id
FROM public.orders o
JOIN public.stores s ON s.id = o.store_id
WHERE d.order_id = o.id AND d.entity_id IS NULL;

UPDATE public.documents d
SET entity_id = e.id
FROM public.entities e
WHERE e.account_id = d.client_id AND d.entity_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.documents WHERE entity_id IS NULL) THEN
    RAISE EXCEPTION 'documents backfill incomplete: orphan rows remain';
  END IF;
END $$;

ALTER TABLE public.documents ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE public.documents DROP COLUMN client_id;

-- 4. Rewrite database functions without client_id
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(p_entity_id uuid, p_type text, p_amount numeric, p_description text, p_reference text DEFAULT NULL::text)
RETURNS wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_new_balance numeric;
  v_row public.wallet_transactions%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin') and auth.role() <> 'service_role' then
    raise exception 'Only admins or the service role can create wallet transactions';
  end if;
  if not exists (select 1 from public.entities where id = p_entity_id) then
    raise exception 'ENTITY_NOT_FOUND';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  if p_type not in ('credit', 'debit', 'adjustment') then
    raise exception 'Invalid transaction type: %', p_type;
  end if;
  if p_reference is not null and exists (
    select 1 from public.wallet_transactions where reference = p_reference
  ) then
    raise exception 'A transaction with reference % already exists', p_reference;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_entity_id::text));
  select balance_after into v_balance
    from public.wallet_transactions
   where entity_id = p_entity_id
   order by created_at desc, id desc
   limit 1
   for update;
  v_balance := coalesce(v_balance, 0);
  if p_type = 'debit' then
    v_new_balance := v_balance - p_amount;
    if v_new_balance < 0 then
      raise exception 'Insufficient funds: current balance is %, cannot debit %', v_balance, p_amount;
    end if;
  else
    v_new_balance := v_balance + p_amount;
  end if;
  insert into public.wallet_transactions
    (entity_id, type, amount, balance_after, description, reference, created_by)
  values
    (p_entity_id, p_type::public.wallet_txn_type, p_amount, v_new_balance, p_description, p_reference, auth.uid())
  returning * into v_row;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_bundle(p_store_id uuid, p_name text, p_components jsonb)
RETURNS products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_store public.stores%rowtype;
  v_product public.products%rowtype;
  v_distinct integer;
  v_valid integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  select s.* into v_store
    from public.stores s
    join public.entities e on e.id = s.entity_id
   where s.id = p_store_id and e.account_id = auth.uid();
  if not found then
    raise exception 'STORE_NOT_FOUND';
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
   where p.store_id = p_store_id and p.product_type = 'simple' and p.status = 'active';
  if v_valid < v_distinct then
    raise exception 'INVALID_COMPONENT';
  end if;
  perform set_config('app.internal_write', 'on', true);
  insert into public.products (store_id, sku, product_name, product_type, moq, status, push_status)
  values (p_store_id, public.generate_sku('FSB-'), trim(p_name), 'bundle', 1, 'active', 'pending')
  returning * into v_product;
  insert into public.bundle_components (bundle_product_id, component_product_id, quantity)
  select v_product.id, (e->>'product_id')::uuid, greatest(1, (e->>'quantity')::integer)
    from jsonb_array_elements(p_components) e;
  return v_product;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_bundle(p_bundle_id uuid, p_name text, p_components jsonb)
RETURNS products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_bundle public.products%rowtype;
  v_distinct integer;
  v_valid integer;
begin
  select * into v_bundle from public.products where id = p_bundle_id for update;
  if not found or v_bundle.product_type <> 'bundle' then
    raise exception 'BUNDLE_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = v_bundle.store_id and e.account_id = auth.uid()
  ) and not public.has_role(auth.uid(), 'admin'::public.app_role) then
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
   where p.store_id = v_bundle.store_id and p.product_type = 'simple' and p.status <> 'discontinued';
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
$function$;

CREATE OR REPLACE FUNCTION public.validate_bundle_component()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  if v_bundle.store_id <> v_component.store_id then
    raise exception 'BUNDLE_COMPONENT_STORE_MISMATCH';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_product_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  then
    raise exception 'FORBIDDEN_PRODUCT_FIELD';
  end if;
  if new.status is distinct from old.status and new.status <> 'discontinued' then
    raise exception 'FORBIDDEN_STATUS_CHANGE';
  end if;
  return new;
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
   order by wt.created_at desc, wt.id desc
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

CREATE OR REPLACE FUNCTION public.submit_quote_request(p_product_url text DEFAULT NULL::text, p_product_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_target_monthly_volume integer DEFAULT NULL::integer, p_image_urls text[] DEFAULT NULL::text[], p_supersedes_quote_id uuid DEFAULT NULL::uuid, p_on_behalf_of uuid DEFAULT NULL::uuid, p_target_countries text[] DEFAULT NULL::text[], p_store_id uuid DEFAULT NULL::uuid)
RETURNS quote_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_account_id uuid;
  v_store public.stores%rowtype;
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
    v_account_id := p_on_behalf_of;
  else
    v_account_id := v_caller;
  end if;
  if p_store_id is not null then
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where s.id = p_store_id and e.account_id = v_account_id;
    if not found then
      raise exception 'STORE_NOT_FOUND';
    end if;
  end if;
  select array_agg(distinct upper(trim(c))) into v_countries
    from unnest(coalesce(p_target_countries, array[]::text[])) c
   where length(trim(c)) = 2;
  if p_supersedes_quote_id is not null then
    select * into v_original from public.quote_requests where id = p_supersedes_quote_id;
    if not found then
      raise exception 'Original quote not found';
    end if;
    if not exists (
      select 1 from public.stores s
      join public.entities e on e.id = s.entity_id
      where s.id = v_original.store_id and e.account_id = v_account_id
    ) then
      raise exception 'Original quote does not belong to this client';
    end if;
    if v_original.status not in ('closed', 'expired') then
      raise exception 'Only closed or expired quotes can be requoted';
    end if;
    insert into public.quote_requests
      (store_id, product_url, product_name, notes, status, supersedes_quote_id, target_countries)
    values
      (v_original.store_id, v_original.product_url, v_original.product_name, v_original.notes,
       'sourcing', p_supersedes_quote_id, v_original.target_countries)
    returning * into v_row;
    return v_row;
  end if;
  if v_store.id is null then
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where e.account_id = v_account_id
     order by s.created_at
     limit 1;
    if not found then
      raise exception 'NO_STORE: no store registered for this account';
    end if;
  end if;
  if v_countries is null or cardinality(v_countries) = 0 then
    raise exception 'TARGET_COUNTRIES_REQUIRED';
  end if;
  if not (v_is_admin and p_on_behalf_of is not null) then
    perform set_config('app.internal_write', 'on', true);
    if v_store.quotes_period_start < v_month_start then
      update public.stores
         set quotes_used_this_month = 0, quotes_period_start = v_month_start
       where id = v_store.id
      returning quotes_used_this_month, quotes_period_start
         into v_store.quotes_used_this_month, v_store.quotes_period_start;
    end if;
    v_quota := case v_store.subscription_plan when 'basic' then 5 else null end;
    if v_quota is not null and v_store.quotes_used_this_month >= v_quota then
      raise exception 'QUOTE_LIMIT_REACHED: Monthly quote limit of % reached on plan % for this store. Upgrade to Unlimited for uncapped quote requests.', v_quota, v_store.subscription_plan;
    end if;
    update public.stores set quotes_used_this_month = quotes_used_this_month + 1 where id = v_store.id;
  end if;
  if p_product_url is null or length(trim(p_product_url)) = 0 then
    raise exception 'product_url is required';
  end if;
  insert into public.quote_requests
    (store_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, target_countries)
  values
    (v_store.id, p_product_url, p_product_name, p_notes, p_target_monthly_volume, p_image_urls, 'submitted', v_countries)
  returning * into v_row;
  return v_row;
end;
$function$;

-- 5. Drop legacy client_id columns
ALTER TABLE public.wallet_transactions DROP COLUMN client_id;
ALTER TABLE public.quote_requests DROP COLUMN client_id;
ALTER TABLE public.products DROP COLUMN client_id;
ALTER TABLE public.orders DROP COLUMN client_id;
ALTER TABLE public.notifications DROP COLUMN client_id;

-- 6. Slim profiles to account identity
ALTER TABLE public.profiles
  DROP COLUMN company_name,
  DROP COLUMN country,
  DROP COLUMN vat_number,
  DROP COLUMN platform,
  DROP COLUMN store_url,
  DROP COLUMN integration_mode,
  DROP COLUMN subscription_plan,
  DROP COLUMN subscription_status,
  DROP COLUMN stripe_customer_id,
  DROP COLUMN stripe_subscription_id,
  DROP COLUMN pending_plan_change,
  DROP COLUMN pending_plan_change_date,
  DROP COLUMN quotes_used_this_month,
  DROP COLUMN quotes_period_start,
  DROP COLUMN fee_waived,
  DROP COLUMN pricing_tier,
  DROP COLUMN tier_override,
  DROP COLUMN avg_daily_units_30d,
  DROP COLUMN middleware_tenant_id,
  DROP COLUMN provisioning_status,
  DROP COLUMN provisioning_step,
  DROP COLUMN provisioning_error,
  DROP COLUMN approved_at;