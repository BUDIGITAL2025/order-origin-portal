select cron.unschedule('flysales-middleware-retry')
where exists (select 1 from cron.job where jobname = 'flysales-middleware-retry');

select cron.schedule('flysales-middleware-retry', '*/15 * * * *',
  $$select public.invoke_cron_endpoint('middleware-retry', '/api/public/cron/middleware-retry', 'GET')$$);