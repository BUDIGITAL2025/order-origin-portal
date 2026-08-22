-- 1. Drop the profile self-insert policy (references the old enum literal)
DROP POLICY IF EXISTS "Users create their own pending profile" ON public.profiles;

-- 2. Migrate the subscription_plan enum: basic_49/pro_99 -> basic/unlimited
ALTER TYPE public.subscription_plan RENAME TO subscription_plan_old;
CREATE TYPE public.subscription_plan AS ENUM ('basic', 'unlimited');

ALTER TABLE public.profiles ALTER COLUMN subscription_plan DROP DEFAULT;
ALTER TABLE public.profiles
  ALTER COLUMN subscription_plan TYPE public.subscription_plan
  USING (CASE WHEN subscription_plan::text = 'pro_99' THEN 'unlimited' ELSE 'basic' END)::public.subscription_plan;
ALTER TABLE public.profiles ALTER COLUMN subscription_plan SET DEFAULT 'basic'::public.subscription_plan;
DROP TYPE public.subscription_plan_old;

-- 3. Fee waiver flag (admin-only, enforced by guard_profile_update below)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS fee_waived boolean NOT NULL DEFAULT false;

-- 4. Recreate the self-insert policy with the new plan literal and waiver check
CREATE POLICY "Users create their own pending profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = id
  AND status = 'pending'::public.profile_status
  AND pricing_tier = 'starter'::public.pricing_tier
  AND tier_override IS NULL
  AND avg_daily_units_30d = 0
  AND subscription_plan = 'basic'::public.subscription_plan
  AND quotes_used_this_month = 0
  AND fee_waived = false
  AND middleware_tenant_id IS NULL
  AND provisioning_status = 'not_started'::public.provisioning_status
  AND provisioning_step IS NULL
  AND provisioning_error IS NULL
  AND approved_at IS NULL
);

-- 5. Protect fee_waived from client self-edits
CREATE OR REPLACE FUNCTION public.guard_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- 6. Quote submission with the new quota model:
--    monthly reset -> basic capped at 5 -> unlimited uncapped ->
--    requotes and admin-on-behalf submissions bypass the quota.
CREATE OR REPLACE FUNCTION public.submit_quote_request(p_product_url text DEFAULT NULL::text, p_product_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_target_monthly_volume integer DEFAULT NULL::integer, p_image_urls text[] DEFAULT NULL::text[], p_supersedes_quote_id uuid DEFAULT NULL::uuid, p_on_behalf_of uuid DEFAULT NULL::uuid)
 RETURNS quote_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Requotes never count against the quota.
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
    -- 1. Reset the counter when the calendar month has rolled over.
    IF v_profile.quotes_period_start < v_month_start THEN
      UPDATE public.profiles
      SET quotes_used_this_month = 0,
          quotes_period_start = v_month_start
      WHERE id = v_client_id
      RETURNING quotes_used_this_month, quotes_period_start
      INTO v_profile.quotes_used_this_month, v_profile.quotes_period_start;
    END IF;

    -- 2. basic is capped at 5/month; unlimited has no cap.
    v_quota := CASE v_profile.subscription_plan
      WHEN 'basic' THEN 5
      ELSE NULL
    END;

    IF v_quota IS NOT NULL AND v_profile.quotes_used_this_month >= v_quota THEN
      RAISE EXCEPTION 'QUOTE_LIMIT_REACHED: Monthly quote limit of % reached on plan %. Upgrade to Unlimited for uncapped quote requests.',
        v_quota, v_profile.subscription_plan;
    END IF;

    -- 3. Count this request.
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
$function$;