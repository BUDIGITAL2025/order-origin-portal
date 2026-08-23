-- SpyMarket internal research tool: usage log + response cache.
-- Both tables are service-role only (like url_previews): RLS enabled, no
-- client policies; admin UI reads through audited server functions.

create table public.spymarket_usage_log (
  id uuid primary key default gen_random_uuid(),
  called_by uuid references public.profiles(id) on delete set null,
  endpoint text not null,
  query_summary jsonb not null default '{}'::jsonb,
  rows_returned integer not null default 0,
  credits_cost integer not null default 0,
  credits_remaining integer,
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.spymarket_usage_log is 'One row per Trendtrack API call (or cache hit). Negotiation data for the Enterprise conversation — every call recorded.';

create index spymarket_usage_log_user_day_idx on public.spymarket_usage_log (called_by, created_at desc);
create index spymarket_usage_log_created_idx on public.spymarket_usage_log (created_at desc);

grant all on public.spymarket_usage_log to service_role;
alter table public.spymarket_usage_log enable row level security;

create table public.spymarket_cache (
  cache_key text primary key,
  endpoint text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

comment on table public.spymarket_cache is 'Server-side cache of Trendtrack API responses. Key = endpoint + normalized params. Entries fresher than 24h are served at zero credit cost.';

create index spymarket_cache_fetched_idx on public.spymarket_cache (fetched_at desc);

grant all on public.spymarket_cache to service_role;
alter table public.spymarket_cache enable row level security;