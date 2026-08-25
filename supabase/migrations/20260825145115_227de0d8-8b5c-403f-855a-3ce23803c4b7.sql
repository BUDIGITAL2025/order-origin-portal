CREATE TABLE public.middleware_sync_state (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  last_synced_at timestamptz,
  last_success_at timestamptz,
  last_seen_order_ids text[] NOT NULL DEFAULT '{}',
  orders_ingested integer NOT NULL DEFAULT 0,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  first_failure_at timestamptz,
  sample_logged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.middleware_sync_state TO service_role;

ALTER TABLE public.middleware_sync_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_middleware_sync_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER update_middleware_sync_state_updated_at
BEFORE UPDATE ON public.middleware_sync_state
FOR EACH ROW EXECUTE FUNCTION public.touch_middleware_sync_state();

SELECT cron.schedule(
  'middleware-order-sync',
  '*/5 * * * *',
  $$ SELECT public.invoke_cron_endpoint('middleware-order-sync', '/api/public/cron/middleware-order-sync', 'GET'); $$
);