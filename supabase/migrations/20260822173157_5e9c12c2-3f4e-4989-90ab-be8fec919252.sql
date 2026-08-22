-- ===== New enums =====
CREATE TYPE public.store_platform AS ENUM ('shopify', 'woocommerce', 'other');
CREATE TYPE public.integration_mode AS ENUM ('automatic', 'manual');

-- ===== Add new columns (store_url nullable until backfilled) =====
ALTER TABLE public.profiles
  ADD COLUMN platform public.store_platform NOT NULL DEFAULT 'shopify',
  ADD COLUMN store_url text,
  ADD COLUMN integration_mode public.integration_mode NOT NULL DEFAULT 'manual';

-- ===== Backfill from shopify_domain before dropping it =====
UPDATE public.profiles
SET store_url = shopify_domain,
    platform = 'shopify',
    integration_mode = 'manual';

ALTER TABLE public.profiles ALTER COLUMN store_url SET NOT NULL;

-- ===== Drop the old column and its check =====
ALTER TABLE public.profiles DROP CONSTRAINT shopify_domain_must_be_myshopify;
ALTER TABLE public.profiles DROP COLUMN shopify_domain;

-- ===== Database-enforced validation =====
ALTER TABLE public.profiles
  ADD CONSTRAINT store_url_shopify_pattern
    CHECK (platform <> 'shopify' OR store_url ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  ADD CONSTRAINT non_shopify_requires_manual
    CHECK (platform = 'shopify' OR integration_mode = 'manual');

-- ===== integration_mode is admin-only on updates =====
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
       OR NEW.fee_waived IS DISTINCT FROM OLD.fee_waived
       OR NEW.integration_mode IS DISTINCT FROM OLD.integration_mode
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

-- ===== New signups always start in manual mode =====
DROP POLICY "Users create their own pending profile" ON public.profiles;
CREATE POLICY "Users create their own pending profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = id
    AND status = 'pending'
    AND pricing_tier = 'starter'
    AND tier_override IS NULL
    AND avg_daily_units_30d = 0
    AND subscription_plan = 'basic'
    AND quotes_used_this_month = 0
    AND fee_waived = false
    AND integration_mode = 'manual'
    AND middleware_tenant_id IS NULL
    AND provisioning_status = 'not_started'
    AND provisioning_step IS NULL
    AND provisioning_error IS NULL
    AND approved_at IS NULL
  );