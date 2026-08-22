-- 1. Wallet ledger: allow the Stripe webhook (service role) to credit/debit.
-- Advisory lock, reference uniqueness and non-negative balance are unchanged.
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(p_client_id uuid, p_type text, p_amount numeric, p_description text, p_reference text DEFAULT NULL::text)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
  v_new_balance numeric;
  v_row public.wallet_transactions%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only admins or the service role can create wallet transactions';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_type NOT IN ('credit', 'debit', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_type;
  END IF;
  IF p_reference IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wallet_transactions WHERE reference = p_reference
  ) THEN
    RAISE EXCEPTION 'A transaction with reference % already exists', p_reference;
  END IF;

  -- Serialize concurrent writes for this client within the transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id::text));

  SELECT balance_after INTO v_balance
  FROM public.wallet_transactions
  WHERE client_id = p_client_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  v_balance := COALESCE(v_balance, 0);

  IF p_type = 'debit' THEN
    v_new_balance := v_balance - p_amount;
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Insufficient funds: current balance is %, cannot debit %', v_balance, p_amount;
    END IF;
  ELSE
    v_new_balance := v_balance + p_amount;
  END IF;

  INSERT INTO public.wallet_transactions
    (client_id, type, amount, balance_after, description, reference, created_by)
  VALUES
    (p_client_id, p_type::public.wallet_txn_type, p_amount, v_new_balance, p_description, p_reference, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- 2. Subscription lifecycle state (set by the payment webhook only).
CREATE TYPE public.subscription_status AS ENUM ('none', 'active', 'past_due', 'canceled');

-- 3. Billing fields on profiles.
ALTER TABLE public.profiles
  ADD COLUMN stripe_customer_id text UNIQUE,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_status public.subscription_status NOT NULL DEFAULT 'none',
  ADD COLUMN auto_topup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_topup_threshold numeric,
  ADD COLUMN auto_topup_amount numeric,
  ADD COLUMN default_payment_method_id text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_auto_topup_amount_min CHECK (auto_topup_amount IS NULL OR auto_topup_amount >= 50),
  ADD CONSTRAINT profiles_auto_topup_threshold_min CHECK (auto_topup_threshold IS NULL OR auto_topup_threshold >= 0);

-- 4. Clients must not write payment-system fields; the webhook (service role)
-- and admins can. auto_topup_* stay client-writable (client-controlled).
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
       OR NEW.integration_mode IS DISTINCT FROM OLD.integration_mode
       OR NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id
       OR NEW.provisioning_status IS DISTINCT FROM OLD.provisioning_status
       OR NEW.provisioning_step IS DISTINCT FROM OLD.provisioning_step
       OR NEW.provisioning_error IS DISTINCT FROM OLD.provisioning_error
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
       OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.default_payment_method_id IS DISTINCT FROM OLD.default_payment_method_id THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Payment event log (idempotency gate for the webhook).
CREATE TABLE public.stripe_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  payload jsonb,
  processed_at timestamp with time zone,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.stripe_events TO authenticated;
GRANT ALL ON public.stripe_events TO service_role;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read stripe events"
  ON public.stripe_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));