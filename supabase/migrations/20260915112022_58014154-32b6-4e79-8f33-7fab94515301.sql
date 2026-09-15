SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'flysales-purchase-expiry';
SELECT cron.schedule('flysales-purchase-expiry', '30 6 * * *',
  $$select public.invoke_cron_endpoint('purchase-expiry', '/api/public/cron/purchase-expiry', 'GET')$$);