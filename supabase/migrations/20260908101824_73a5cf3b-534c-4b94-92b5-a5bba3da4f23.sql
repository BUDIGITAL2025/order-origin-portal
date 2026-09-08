CREATE TABLE public.seo_api_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  cached BOOLEAN NOT NULL DEFAULT false,
  duration_ms INTEGER,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  called_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seo_api_calls_created_idx ON public.seo_api_calls (created_at DESC);
CREATE INDEX seo_api_calls_user_day_idx ON public.seo_api_calls (called_by, created_at DESC);
GRANT SELECT ON public.seo_api_calls TO authenticated;
GRANT ALL ON public.seo_api_calls TO service_role;
ALTER TABLE public.seo_api_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read seo api calls"
  ON public.seo_api_calls FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.seo_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endpoint, payload_hash)
);
CREATE INDEX seo_cache_expires_idx ON public.seo_cache (expires_at);
GRANT SELECT ON public.seo_cache TO authenticated;
GRANT ALL ON public.seo_cache TO service_role;
ALTER TABLE public.seo_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read seo cache"
  ON public.seo_cache FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));