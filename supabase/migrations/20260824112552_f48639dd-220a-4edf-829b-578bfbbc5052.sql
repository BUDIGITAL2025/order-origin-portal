CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  error text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cron_runs TO authenticated;
GRANT ALL ON public.cron_runs TO service_role;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read cron runs"
  ON public.cron_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx ON public.cron_runs (job, started_at DESC);

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  context jsonb,
  error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.error_logs TO authenticated;
GRANT ALL ON public.error_logs TO service_role;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read error logs"
  ON public.error_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS error_logs_created_idx ON public.error_logs (created_at DESC);

-- Internal settings (scheduler secret + base url). No grants: service_role /
-- security-definer access only.
CREATE TABLE IF NOT EXISTS public.internal_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.internal_settings TO service_role;
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;

-- Fires a protected cron endpoint with the shared secret, and records the
-- attempt so a silent scheduler failure is visible in cron_runs.
CREATE OR REPLACE FUNCTION public.invoke_cron_endpoint(p_job text, p_path text, p_method text DEFAULT 'GET')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_secret text;
  v_base text;
  v_url text;
begin
  select value into v_secret from public.internal_settings where key = 'cron_secret';
  select value into v_base from public.internal_settings where key = 'app_base_url';
  if v_secret is null or v_base is null then
    insert into public.cron_runs (job, started_at, finished_at, ok, error)
    values (p_job, now(), now(), false, 'cron_secret or app_base_url not configured');
    return;
  end if;
  v_url := rtrim(v_base, '/') || p_path;
  if upper(p_method) = 'POST' then
    perform extensions.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  else
    perform extensions.http_get(
      url := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 55000
    );
  end if;
  insert into public.cron_runs (job, started_at, finished_at, ok, error, detail)
  values (p_job || ':dispatch', now(), now(), true, null, jsonb_build_object('url', p_path, 'method', upper(p_method)));
exception when others then
  insert into public.cron_runs (job, started_at, finished_at, ok, error)
  values (p_job || ':dispatch', now(), now(), false, sqlerrm);
end;
$$;
REVOKE ALL ON FUNCTION public.invoke_cron_endpoint(text, text, text) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('flysales-order-expiry','flysales-auto-topup','flysales-documents-sweep','flysales-daily-digest');

SELECT cron.schedule('flysales-order-expiry', '0 * * * *',
  $$select public.invoke_cron_endpoint('order-expiry', '/api/public/cron/order-expiry', 'GET')$$);
SELECT cron.schedule('flysales-auto-topup', '*/30 * * * *',
  $$select public.invoke_cron_endpoint('auto-topup', '/api/public/cron/auto-topup?env=sandbox', 'POST')$$);
SELECT cron.schedule('flysales-documents-sweep', '20 3 * * *',
  $$select public.invoke_cron_endpoint('documents-sweep', '/api/public/cron/documents-sweep', 'GET')$$);
SELECT cron.schedule('flysales-daily-digest', '0 7 * * *',
  $$select public.invoke_cron_endpoint('daily-digest', '/api/public/cron/daily-digest', 'GET')$$);