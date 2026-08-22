-- ============================================================================
-- Pricing overhaul: tiers, subscriptions, quotas, new quote pricing model
-- ============================================================================

-- 1. New enum types
CREATE TYPE public.pricing_tier AS ENUM ('starter', 'growth', 'scale');
CREATE TYPE public.subscription_plan AS ENUM ('basic_49', 'pro_99');

-- 2. Rebuild the profile-update guard WITHOUT markup_tier (column is dropped below)
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.middleware_tenant_id IS NOT NULL
     AND NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id THEN
    RAISE EXCEPTION 'middleware_tenant_id is immutable once set';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.pricing_tier IS DISTINCT FROM OLD.pricing_tier
       OR NEW.tier_override IS DISTINCT FROM OLD.tier_override
       OR NEW.avg_daily_units_30d IS DISTINCT FROM OLD.avg_daily_units_30d
       OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
       OR NEW.quotes_used_this_month IS DISTINCT FROM OLD.quotes_used_this_month
       OR NEW.quotes_period_start IS DISTINCT FROM OLD.quotes_period_start
       OR NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id
       OR NEW.provisioning_status IS DISTINCT FROM OLD.provisioning_status
       OR NEW.provisioning_step IS DISTINCT FROM OLD.provisioning_step
       OR NEW.provisioning_error IS DISTINCT FROM OLD.provisioning_error
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Drop dependent objects BEFORE altering columns
DROP POLICY "Users create their own pending profile" ON public.profiles;
DROP VIEW public.quote_requests_client;

-- 4. profiles: drop markup_tier, add new columns
ALTER TABLE public.profiles DROP COLUMN markup_tier;
DROP TYPE public.markup_tier;

ALTER TABLE public.profiles
  ADD COLUMN pricing_tier public.pricing_tier NOT NULL DEFAULT 'starter',
  ADD COLUMN tier_override public.pricing_tier,
  ADD COLUMN avg_daily_units_30d numeric NOT NULL DEFAULT 0,
  ADD COLUMN subscription_plan public.subscription_plan NOT NULL DEFAULT 'basic_49',
  ADD COLUMN quotes_used_this_month integer NOT NULL DEFAULT 0,
  ADD COLUMN quotes_period_start date NOT NULL DEFAULT current_date;

-- 5. Recreate the self-signup policy with the new protected defaults
CREATE POLICY "Users create their own pending profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = id
  AND status = 'pending'
  AND pricing_tier = 'starter'
  AND tier_override IS NULL
  AND avg_daily_units_30d = 0
  AND subscription_plan = 'basic_49'
  AND quotes_used_this_month = 0
  AND middleware_tenant_id IS NULL
  AND provisioning_status = 'not_started'
  AND provisioning_step IS NULL
  AND provisioning_error IS NULL
  AND approved_at IS NULL
);

-- 6. Auto-calculate pricing_tier from avg_daily_units_30d.
--    Boundaries: < 10 starter, 10-29.99 growth, >= 30 scale.
CREATE OR REPLACE FUNCTION public.recalc_pricing_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.avg_daily_units_30d IS DISTINCT FROM OLD.avg_daily_units_30d THEN
    NEW.pricing_tier := CASE
      WHEN NEW.avg_daily_units_30d < 10 THEN 'starter'::public.pricing_tier
      WHEN NEW.avg_daily_units_30d < 30 THEN 'growth'::public.pricing_tier
      ELSE 'scale'::public.pricing_tier
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_recalc_pricing_tier
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.recalc_pricing_tier();

-- 7. quote_requests: swap pricing columns (view already dropped)
ALTER TABLE public.quote_requests
  DROP COLUMN cost_price,
  DROP COLUMN shipping_cost,
  DROP COLUMN markup_percent,
  DROP COLUMN quoted_price,
  ADD COLUMN supplier_cogs numeric,
  ADD COLUMN supplier_shipping numeric,
  ADD COLUMN supplier_tax numeric,
  ADD COLUMN markup_product numeric,
  ADD COLUMN markup_shipping numeric,
  ADD COLUMN tier_at_quote text,
  ADD COLUMN quoted_price_total numeric,
  ADD COLUMN supersedes_quote_id uuid REFERENCES public.quote_requests(id);

-- 8. Client-safe view: only quoted_price_total + logistics, never supplier_*/markup_*
CREATE VIEW public.quote_requests_client
WITH (security_invoker = false) AS
SELECT
  id,
  client_id,
  product_url,
  product_name,
  notes,
  target_monthly_volume,
  image_urls,
  status,
  quoted_price_total,
  moq,
  lead_time_days,
  quote_valid_until,
  quoted_at,
  responded_at,
  supersedes_quote_id,
  created_at
FROM public.quote_requests;

GRANT SELECT ON public.quote_requests_client TO authenticated;
GRANT SELECT ON public.quote_requests_client TO service_role;

-- 9. All quote inserts go through submit_quote_request so the monthly quota
--    cannot be bypassed. Remove the direct client INSERT path.
DROP POLICY "Clients create own quote requests" ON public.quote_requests;
REVOKE INSERT ON public.quote_requests FROM authenticated;

-- 10. Quota-enforcing submit function
CREATE OR REPLACE FUNCTION public.submit_quote_request(
  p_product_url text DEFAULT NULL,
  p_product_name text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_target_monthly_volume integer DEFAULT NULL,
  p_image_urls text[] DEFAULT NULL,
  p_supersedes_quote_id uuid DEFAULT NULL,
  p_on_behalf_of uuid DEFAULT NULL
)
RETURNS public.quote_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_client_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_original public.quote_requests%ROWTYPE;
  v_month_start date := date_trunc('month', current_date)::date;
  v_quota integer;
  v_row public.quote_requests%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_admin := public.has_role(v_caller, 'admin');

  IF p_on_behalf_of IS NOT NULL THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only admins can submit quotes on behalf of a client';
    END IF;
    v_client_id := p_on_behalf_of;
  ELSE
    v_client_id := v_caller;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client profile not found';
  END IF;

  IF p_supersedes_quote_id IS NOT NULL THEN
    SELECT * INTO v_original FROM public.quote_requests WHERE id = p_supersedes_quote_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Original quote not found';
    END IF;
    IF v_original.client_id <> v_client_id THEN
      RAISE EXCEPTION 'Original quote does not belong to this client';
    END IF;
    IF v_original.status NOT IN ('accepted', 'expired') THEN
      RAISE EXCEPTION 'Only accepted or expired quotes can be requoted';
    END IF;

    INSERT INTO public.quote_requests
      (client_id, product_url, product_name, notes, status, supersedes_quote_id)
    VALUES
      (v_client_id, v_original.product_url, v_original.product_name, v_original.notes,
       'sourcing', p_supersedes_quote_id)
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  -- Fresh submission: admins on behalf bypass the quota entirely.
  IF NOT (v_is_admin AND p_on_behalf_of IS NOT NULL) THEN
    IF v_profile.quotes_period_start < v_month_start THEN
      UPDATE public.profiles
      SET quotes_used_this_month = 0,
          quotes_period_start = v_month_start
      WHERE id = v_client_id
      RETURNING quotes_used_this_month, quotes_period_start
      INTO v_profile.quotes_used_this_month, v_profile.quotes_period_start;
    END IF;

    v_quota := CASE v_profile.subscription_plan
      WHEN 'basic_49' THEN 15
      WHEN 'pro_99' THEN 60
    END;

    IF v_profile.quotes_used_this_month >= v_quota THEN
      RAISE EXCEPTION 'QUOTE_LIMIT_REACHED: Monthly quote limit of % reached on plan %. Upgrade to request more quotes.',
        v_quota, v_profile.subscription_plan;
    END IF;

    UPDATE public.profiles
    SET quotes_used_this_month = quotes_used_this_month + 1
    WHERE id = v_client_id;
  END IF;

  IF p_product_url IS NULL OR length(trim(p_product_url)) = 0 THEN
    RAISE EXCEPTION 'product_url is required';
  END IF;

  INSERT INTO public.quote_requests
    (client_id, product_url, product_name, notes, target_monthly_volume, image_urls, status)
  VALUES
    (v_client_id, p_product_url, p_product_name, p_notes, p_target_monthly_volume,
     p_image_urls, 'submitted')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quote_request(text, text, text, integer, text[], uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_quote_request(text, text, text, integer, text[], uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_quote_request(text, text, text, integer, text[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quote_request(text, text, text, integer, text[], uuid, uuid) TO service_role;