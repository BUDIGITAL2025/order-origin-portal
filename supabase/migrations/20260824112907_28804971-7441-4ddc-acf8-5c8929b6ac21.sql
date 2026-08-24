SELECT cron.schedule('flysales-cron-selftest', '* * * * *',
  $$select public.invoke_cron_endpoint('selftest', '/api/public/cron/documents-sweep', 'GET')$$);