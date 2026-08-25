CREATE OR REPLACE FUNCTION public.ingest_middleware_order(p_tenant_id text, p_middleware_order_id text, p_external_ref text, p_destination_country text, p_shipping_address jsonb, p_line_items jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_store_id uuid;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN: middleware intake is internal';
  end if;
  if nullif(p_middleware_order_id, '') is null then
    raise exception 'MIDDLEWARE_ORDER_ID_REQUIRED';
  end if;

  select * into v_order from public.orders
   where middleware_order_id = p_middleware_order_id;
  if found then
    return v_order;
  end if;

  select s.id into v_store_id from public.stores s
   where s.middleware_tenant_id = p_tenant_id;
  if v_store_id is null then
    raise exception 'UNKNOWN_TENANT: no workspace for tenant %', p_tenant_id;
  end if;

  v_order := public.ingest_order(
    v_store_id,
    nullif(p_external_ref, ''),
    nullif(p_external_ref, ''),
    p_destination_country,
    coalesce(p_shipping_address, '{}'::jsonb),
    p_line_items
  );

  perform set_config('app.internal_write', 'on', true);
  -- The order is tagged as middleware-sourced only here, so an order that the
  -- wallet already settled inside ingest_order missed the release trigger
  -- (it fires on the paid transition and requires source = 'middleware').
  -- Queue it explicitly; identifiers only, no money fields touched.
  update public.orders
     set middleware_order_id = p_middleware_order_id,
         source = 'middleware',
         release_status = case
           when paid_at is not null and release_status is null then 'pending'
           else release_status
         end,
         release_attempts = case
           when paid_at is not null and release_status is null then 0
           else release_attempts
         end
   where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$function$;