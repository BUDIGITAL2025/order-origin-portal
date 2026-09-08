CREATE TABLE public.spy_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  endpoint text NOT NULL,
  credits_cost numeric NOT NULL DEFAULT 0,
  credits_remaining numeric,
  status_code integer,
  ok boolean NOT NULL DEFAULT true,
  cached boolean NOT NULL DEFAULT false,
  rows_returned integer NOT NULL DEFAULT 0,
  duration_ms integer,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  called_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.spy_api_calls TO authenticated;
GRANT ALL ON public.spy_api_calls TO service_role;

ALTER TABLE public.spy_api_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read spy api calls"
ON public.spy_api_calls
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX spy_api_calls_provider_created_idx
  ON public.spy_api_calls (provider, created_at DESC);
CREATE INDEX spy_api_calls_called_by_created_idx
  ON public.spy_api_calls (called_by, created_at DESC);

ALTER TABLE public.spymarket_cache
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'trendtrack';