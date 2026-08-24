CREATE OR REPLACE FUNCTION public.invoke_cron_endpoint(p_job text, p_path text, p_method text DEFAULT 'GET')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
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
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  else
    perform net.http_get(
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