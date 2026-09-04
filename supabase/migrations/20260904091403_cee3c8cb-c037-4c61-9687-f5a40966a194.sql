ALTER TABLE public.manual_stock_levels
  ADD COLUMN IF NOT EXISTS locations jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.manual_stock_levels
   SET locations = jsonb_build_array(jsonb_build_object('location', 'Warehouse', 'quantity', in_warehouse))
 WHERE locations = '[]'::jsonb AND in_warehouse > 0;

DROP FUNCTION IF EXISTS public.upsert_manual_inventory_item(uuid, text, text, text[], integer, integer, integer, numeric, text, integer, jsonb);

CREATE OR REPLACE FUNCTION public.upsert_manual_inventory_item(
  p_store_id uuid,
  p_sku text,
  p_product_name text,
  p_tags text[],
  p_warehouses jsonb,
  p_reserved integer,
  p_incoming integer,
  p_weight numeric,
  p_weight_unit text,
  p_lead_time_days integer,
  p_routes jsonb
)
RETURNS products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_store public.stores%rowtype;
  v_product public.products%rowtype;
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_name text := nullif(trim(coalesce(p_product_name, '')), '');
  v_default_handling integer := 0;
  v_route jsonb;
  v_wh jsonb;
  v_has_default boolean := false;
  v_index integer := 0;
  v_total integer := 0;
  v_locations jsonb := '[]'::jsonb;
  v_names text[] := '{}';
  v_loc text;
  v_qty integer;
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

  if v_sku is null then raise exception 'SKU_REQUIRED'; end if;
  if v_name is null then raise exception 'NAME_REQUIRED'; end if;
  if coalesce(p_lead_time_days, -1) < 0 then raise exception 'LEAD_TIME_REQUIRED'; end if;
  if coalesce(p_reserved, 0) < 0 or coalesce(p_incoming, 0) < 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_weight_unit is not null and p_weight_unit not in ('g','kg') then raise exception 'INVALID_WEIGHT_UNIT'; end if;

  if p_warehouses is null or jsonb_typeof(p_warehouses) <> 'array' or jsonb_array_length(p_warehouses) = 0 then
    raise exception 'WAREHOUSE_REQUIRED';
  end if;

  for v_wh in select * from jsonb_array_elements(p_warehouses) loop
    v_loc := nullif(trim(coalesce(v_wh->>'location','')), '');
    v_qty := coalesce((v_wh->>'quantity')::integer, -1);
    if v_loc is null then raise exception 'WAREHOUSE_NAME_REQUIRED'; end if;
    if v_qty < 0 then raise exception 'INVALID_QUANTITY'; end if;
    if lower(v_loc) = any (select lower(x) from unnest(v_names) x) then
      raise exception 'DUPLICATE_WAREHOUSE';
    end if;
    v_names := v_names || v_loc;
    v_total := v_total + v_qty;
    v_locations := v_locations || jsonb_build_object('location', v_loc, 'quantity', v_qty);
  end loop;

  if p_routes is null or jsonb_typeof(p_routes) <> 'array' or jsonb_array_length(p_routes) = 0 then
    raise exception 'ROUTE_REQUIRED';
  end if;

  for v_route in select * from jsonb_array_elements(p_routes) loop
    v_index := v_index + 1;
    if nullif(trim(coalesce(v_route->>'destination','')), '') is null then
      raise exception 'ROUTE_DESTINATION_REQUIRED';
    end if;
    if coalesce((v_route->>'handling_time_days')::integer, -1) < 0 then
      raise exception 'ROUTE_HANDLING_REQUIRED';
    end if;
    if coalesce((v_route->>'is_default')::boolean, false) and not v_has_default then
      v_has_default := true;
      v_default_handling := (v_route->>'handling_time_days')::integer;
    end if;
    if v_index = 1 and not v_has_default then
      v_default_handling := (v_route->>'handling_time_days')::integer;
    end if;
  end loop;

  perform set_config('app.internal_write', 'on', true);

  select * into v_product from public.products
   where store_id = p_store_id and sku = v_sku
   limit 1;

  if found then
    update public.products
       set product_name = v_name,
           tags = coalesce(p_tags, '{}'),
           weight = p_weight,
           weight_unit = p_weight_unit,
           production_lead_days = p_lead_time_days,
           transit_lead_days = v_default_handling,
           status = case when status = 'discontinued' then 'active'::public.product_status else status end
     where id = v_product.id
     returning * into v_product;
  else
    insert into public.products (
      store_id, sku, product_name, product_type, status, push_status,
      tags, weight, weight_unit, production_lead_days, transit_lead_days
    ) values (
      p_store_id, v_sku, v_name, 'simple', 'active', 'pending',
      coalesce(p_tags, '{}'), p_weight, p_weight_unit, p_lead_time_days, v_default_handling
    ) returning * into v_product;
  end if;

  delete from public.product_shipping_routes where product_id = v_product.id;

  v_index := 0;
  v_has_default := false;
  for v_route in select * from jsonb_array_elements(p_routes) loop
    v_index := v_index + 1;
    insert into public.product_shipping_routes (product_id, destination, handling_time_days, is_default)
    values (
      v_product.id,
      trim(v_route->>'destination'),
      (v_route->>'handling_time_days')::integer,
      case
        when coalesce((v_route->>'is_default')::boolean, false) and not v_has_default then true
        else false
      end
    );
    if coalesce((v_route->>'is_default')::boolean, false) and not v_has_default then
      v_has_default := true;
    end if;
  end loop;

  if not v_has_default then
    update public.product_shipping_routes
       set is_default = true
     where id = (
       select id from public.product_shipping_routes
        where product_id = v_product.id
        order by created_at, destination
        limit 1
     );
  end if;

  insert into public.manual_stock_levels (store_id, sku, in_warehouse, reserved, incoming, locations)
  values (p_store_id, v_sku, v_total, coalesce(p_reserved, 0), coalesce(p_incoming, 0), v_locations)
  on conflict (store_id, sku) do update
    set in_warehouse = excluded.in_warehouse,
        reserved = excluded.reserved,
        incoming = excluded.incoming,
        locations = excluded.locations,
        updated_at = now();

  return v_product;
end;
$function$;

REVOKE ALL ON FUNCTION public.upsert_manual_inventory_item(uuid, text, text, text[], jsonb, integer, integer, numeric, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_manual_inventory_item(uuid, text, text, text[], jsonb, integer, integer, numeric, text, integer, jsonb) TO authenticated;