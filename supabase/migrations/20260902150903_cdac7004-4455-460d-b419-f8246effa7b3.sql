-- ============= Suppliers (admin-only) =============
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  notes text,
  default_production_lead_days integer,
  default_transit_lead_days integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage suppliers"
  ON public.suppliers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============= Planning fields on products and stores =============
ALTER TABLE public.products
  ADD COLUMN supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN production_lead_days integer,
  ADD COLUMN transit_lead_days integer,
  ADD COLUMN safety_margin_days integer;

CREATE INDEX idx_products_supplier ON public.products(supplier_id);

ALTER TABLE public.stores
  ADD COLUMN default_production_lead_days integer NOT NULL DEFAULT 14,
  ADD COLUMN default_transit_lead_days integer NOT NULL DEFAULT 21,
  ADD COLUMN default_safety_margin_days integer NOT NULL DEFAULT 7;

-- ============= Inventory snapshots (append-only) =============
CREATE TABLE public.inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  location text NOT NULL DEFAULT 'default',
  quantity integer NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_snapshots_lookup
  ON public.inventory_snapshots(store_id, sku, captured_at DESC);
CREATE INDEX idx_inventory_snapshots_captured
  ON public.inventory_snapshots(store_id, captured_at DESC);

GRANT SELECT ON public.inventory_snapshots TO authenticated;
GRANT ALL ON public.inventory_snapshots TO service_role;

ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own inventory snapshots"
  ON public.inventory_snapshots FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.entities e ON e.id = s.entity_id
      WHERE s.id = inventory_snapshots.store_id AND e.account_id = auth.uid()
    )
  );

-- ============= SKU velocity =============
CREATE TABLE public.sku_velocity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  units_7d integer NOT NULL DEFAULT 0,
  units_30d integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku)
);

GRANT SELECT ON public.sku_velocity TO authenticated;
GRANT ALL ON public.sku_velocity TO service_role;

ALTER TABLE public.sku_velocity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own velocity"
  ON public.sku_velocity FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.stores s
      JOIN public.entities e ON e.id = s.entity_id
      WHERE s.id = sku_velocity.store_id AND e.account_id = auth.uid()
    )
  );

-- ============= Alert state (one email per transition) =============
CREATE TABLE public.sku_alert_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  state text NOT NULL,
  notified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku)
);

GRANT SELECT ON public.sku_alert_state TO authenticated;
GRANT ALL ON public.sku_alert_state TO service_role;

ALTER TABLE public.sku_alert_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read alert state"
  ON public.sku_alert_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============= Velocity recompute (from our own shadow orders) =============
CREATE OR REPLACE FUNCTION public.recompute_sku_velocity(p_store_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_count integer := 0;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN: velocity recompute is internal';
  end if;

  with sold as (
    select oi.sku,
           sum(case when o.created_at >= now() - interval '7 days'
                    then coalesce(oi.quantity, 0) else 0 end) as units_7d,
           sum(case when o.created_at >= now() - interval '30 days'
                    then coalesce(oi.quantity, 0) else 0 end) as units_30d
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
     where o.store_id = p_store_id
       and o.status in ('paid', 'processing', 'shipped', 'delivered')
       and o.created_at >= now() - interval '30 days'
       and oi.sku is not null
     group by oi.sku
  )
  insert into public.sku_velocity (store_id, sku, units_7d, units_30d, computed_at)
  select p_store_id, sold.sku, sold.units_7d::integer, sold.units_30d::integer, now()
    from sold
  on conflict (store_id, sku) do update
    set units_7d = excluded.units_7d,
        units_30d = excluded.units_30d,
        computed_at = now();

  get diagnostics v_count = row_count;

  -- SKUs with no sales in the window fall back to zero so cover reads "no recent sales".
  update public.sku_velocity v
     set units_7d = 0, units_30d = 0, computed_at = now()
   where v.store_id = p_store_id
     and v.computed_at < now() - interval '1 second';

  return v_count;
end;
$$;

REVOKE ALL ON FUNCTION public.recompute_sku_velocity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_sku_velocity(uuid) TO authenticated, service_role;

-- ============= Lead-time resolution cascade =============
-- Returns resolved days plus a one-letter origin (P product / S supplier /
-- W workspace). Never returns supplier identity, so clients can call it.
CREATE OR REPLACE FUNCTION public.resolved_lead_times(p_store_id uuid)
RETURNS TABLE(
  product_id uuid,
  sku text,
  product_name text,
  production_lead integer,
  production_origin text,
  transit_lead integer,
  transit_origin text,
  safety_margin integer,
  safety_origin text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or auth.role() = 'service_role'
    or exists (
      select 1 from public.stores s
      join public.entities e on e.id = s.entity_id
      where s.id = p_store_id and e.account_id = auth.uid()
    )
  ) then
    raise exception 'STORE_NOT_FOUND';
  end if;

  return query
  select p.id,
         p.sku,
         p.product_name,
         coalesce(p.production_lead_days, sup.default_production_lead_days, s.default_production_lead_days),
         case when p.production_lead_days is not null then 'P'
              when sup.default_production_lead_days is not null then 'S'
              else 'W' end,
         coalesce(p.transit_lead_days, sup.default_transit_lead_days, s.default_transit_lead_days),
         case when p.transit_lead_days is not null then 'P'
              when sup.default_transit_lead_days is not null then 'S'
              else 'W' end,
         coalesce(p.safety_margin_days, s.default_safety_margin_days),
         case when p.safety_margin_days is not null then 'P' else 'W' end
    from public.products p
    join public.stores s on s.id = p.store_id
    left join public.suppliers sup on sup.id = p.supplier_id
   where p.store_id = p_store_id
     and p.status <> 'discontinued';
end;
$$;

REVOKE ALL ON FUNCTION public.resolved_lead_times(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolved_lead_times(uuid) TO authenticated, service_role;

-- ============= Guard triggers: new columns are admin-only =============
CREATE OR REPLACE FUNCTION public.guard_product_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  then
    raise exception 'FORBIDDEN_PRODUCT_FIELD';
  end if;
  if new.status is distinct from old.status and new.status <> 'discontinued' then
    raise exception 'FORBIDDEN_STATUS_CHANGE';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.guard_store_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if current_setting('app.internal_write', true) = 'on' then
    return new;
  end if;
  if old.middleware_tenant_id is not null
     and new.middleware_tenant_id is distinct from old.middleware_tenant_id then
    raise exception 'middleware_tenant_id is immutable once set';
  end if;
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    if new.middleware_tenant_id is distinct from old.middleware_tenant_id
       or new.integration_mode is distinct from old.integration_mode
       or new.subscription_plan is distinct from old.subscription_plan
       or new.subscription_status is distinct from old.subscription_status
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.pending_plan_change is distinct from old.pending_plan_change
       or new.pending_plan_change_date is distinct from old.pending_plan_change_date
       or new.quotes_used_this_month is distinct from old.quotes_used_this_month
       or new.quotes_period_start is distinct from old.quotes_period_start
       or new.fee_waived is distinct from old.fee_waived
       or new.pricing_tier is distinct from old.pricing_tier
       or new.tier_override is distinct from old.tier_override
       or new.avg_daily_units_30d is distinct from old.avg_daily_units_30d
       or new.provisioning_status is distinct from old.provisioning_status
       or new.provisioning_step is distinct from old.provisioning_step
       or new.provisioning_error is distinct from old.provisioning_error
       or new.status is distinct from old.status
       or new.approved_at is distinct from old.approved_at
       or new.entity_id is distinct from old.entity_id
       or new.created_at is distinct from old.created_at
       or new.default_production_lead_days is distinct from old.default_production_lead_days
       or new.default_transit_lead_days is distinct from old.default_transit_lead_days
       or new.default_safety_margin_days is distinct from old.default_safety_margin_days then
      raise exception 'Protected store fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;

-- Keep suppliers.updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_suppliers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

CREATE TRIGGER trg_touch_suppliers
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_suppliers();