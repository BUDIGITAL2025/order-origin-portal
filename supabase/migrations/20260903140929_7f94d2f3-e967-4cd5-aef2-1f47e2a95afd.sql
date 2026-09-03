ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS weight numeric,
  ADD COLUMN IF NOT EXISTS weight_unit text;

ALTER TABLE public.products
  ADD CONSTRAINT products_weight_unit_check CHECK (weight_unit IS NULL OR weight_unit IN ('g','kg'));

CREATE TABLE public.product_shipping_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  destination text NOT NULL,
  handling_time_days integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.product_shipping_routes TO authenticated;
GRANT ALL ON public.product_shipping_routes TO service_role;

ALTER TABLE public.product_shipping_routes ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX product_shipping_routes_one_default
  ON public.product_shipping_routes (product_id) WHERE is_default;
CREATE INDEX product_shipping_routes_product_idx
  ON public.product_shipping_routes (product_id);

CREATE POLICY "Owners read their product shipping routes"
  ON public.product_shipping_routes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.stores s ON s.id = p.store_id
      JOIN public.entities e ON e.id = s.entity_id
      WHERE p.id = product_shipping_routes.product_id
        AND e.account_id = auth.uid()
    )
  );

CREATE POLICY "Admins read all product shipping routes"
  ON public.product_shipping_routes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE public.manual_stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  in_warehouse integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  incoming integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku)
);

GRANT SELECT ON public.manual_stock_levels TO authenticated;
GRANT ALL ON public.manual_stock_levels TO service_role;

ALTER TABLE public.manual_stock_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their manual stock"
  ON public.manual_stock_levels FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.entities e ON e.id = s.entity_id
      WHERE s.id = manual_stock_levels.store_id
        AND e.account_id = auth.uid()
    )
  );

CREATE POLICY "Admins read all manual stock"
  ON public.manual_stock_levels FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.upsert_manual_inventory_item(
  p_store_id uuid,
  p_sku text,
  p_product_name text,
  p_tags text[],
  p_in_warehouse integer,
  p_reserved integer,
  p_incoming integer,
  p_weight numeric,
  p_weight_unit text,
  p_lead_time_days integer,
  p_routes jsonb
) RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_store public.stores%rowtype;
  v_product public.products%rowtype;
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_name text := nullif(trim(coalesce(p_product_name, '')), '');
  v_default_handling integer := 0;
  v_route jsonb;
  v_has_default boolean := false;
  v_index integer := 0;
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
  if coalesce(p_in_warehouse, -1) < 0 then raise exception 'INVALID_QUANTITY'; end if;
  if coalesce(p_reserved, 0) < 0 or coalesce(p_incoming, 0) < 0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_weight_unit is not null and p_weight_unit not in ('g','kg') then raise exception 'INVALID_WEIGHT_UNIT'; end if;
  if p_routes is null or jsonb_typeof(p_routes) <> 'array' or jsonb_array_length(p_routes) = 0 then
    raise exception 'ROUTE_REQUIRED';
  end if;

  -- Resolve the default route's handling time (first route wins if none flagged).
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

  insert into public.manual_stock_levels (store_id, sku, in_warehouse, reserved, incoming)
  values (p_store_id, v_sku, p_in_warehouse, coalesce(p_reserved, 0), coalesce(p_incoming, 0))
  on conflict (store_id, sku) do update
    set in_warehouse = excluded.in_warehouse,
        reserved = excluded.reserved,
        incoming = excluded.incoming,
        updated_at = now();

  return v_product;
end;
$$;

REVOKE ALL ON FUNCTION public.upsert_manual_inventory_item(uuid, text, text, text[], integer, integer, integer, numeric, text, integer, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upsert_manual_inventory_item(uuid, text, text, text[], integer, integer, integer, numeric, text, integer, jsonb) TO authenticated;