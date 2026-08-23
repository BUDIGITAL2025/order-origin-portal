CREATE TABLE public.spymarket_endpoint_costs (
  endpoint text PRIMARY KEY,
  credits_per_row numeric NOT NULL,
  last_observed_at timestamptz,
  sample_count integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.spymarket_endpoint_costs TO service_role;
ALTER TABLE public.spymarket_endpoint_costs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.spymarket_endpoint_costs (endpoint, credits_per_row, last_observed_at, sample_count) VALUES
  ('shops/query', 4, now(), 1),
  ('shops/detail', 1, NULL, 0),
  ('shops/products', 1, NULL, 0),
  ('shops/advertisers', 1, NULL, 0),
  ('shops/tiktok', 1, NULL, 0),
  ('shops/similar', 1, NULL, 0),
  ('ads', 1, NULL, 0),
  ('ads/query', 1, NULL, 0);