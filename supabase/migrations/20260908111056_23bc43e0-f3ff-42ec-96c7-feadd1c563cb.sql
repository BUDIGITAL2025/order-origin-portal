-- lovable-cron-fallback-reviewed: 1440 runs/day; async multi-phase SEO study job must advance within the promised 5-15 min window and includes an external OnPage crawl that must be polled until it finishes; each tick is a single bounded lease query that no-ops when no study is queued.
select cron.schedule(
  'flysales-seo-study-tick',
  '* * * * *',
  $$ SELECT public.invoke_cron_endpoint('seo-study-tick', '/api/public/cron/seo-study-tick', 'GET'); $$
);