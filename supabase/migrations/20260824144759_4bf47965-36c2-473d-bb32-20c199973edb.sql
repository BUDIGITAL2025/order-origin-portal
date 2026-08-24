CREATE TABLE public.spymarket_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL,
  plan text NOT NULL CHECK (plan IN ('starter','plus','max')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','canceled')),
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_end date,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spymarket_subscriptions_account ON public.spymarket_subscriptions(account_id);

GRANT SELECT ON public.spymarket_subscriptions TO authenticated;
GRANT ALL ON public.spymarket_subscriptions TO service_role;

ALTER TABLE public.spymarket_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own spymarket subscription readable"
  ON public.spymarket_subscriptions FOR SELECT TO authenticated
  USING (account_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_spymarket_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_spymarket_subscriptions() FROM PUBLIC;

CREATE TRIGGER update_spymarket_subscriptions_updated_at
  BEFORE UPDATE ON public.spymarket_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_spymarket_subscriptions();