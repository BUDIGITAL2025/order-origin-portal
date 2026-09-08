
-- 1. Mapping: which Meta ad account belongs to which workspace. Admin-managed.
CREATE TABLE public.workspace_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  platform text NOT NULL DEFAULT 'meta',
  label text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_ad_accounts_platform_chk CHECK (platform IN ('meta','google')),
  CONSTRAINT workspace_ad_accounts_unique UNIQUE (platform, ad_account_id)
);
CREATE INDEX workspace_ad_accounts_workspace_idx ON public.workspace_ad_accounts (workspace_id);

GRANT SELECT ON public.workspace_ad_accounts TO authenticated;
GRANT ALL ON public.workspace_ad_accounts TO service_role;
ALTER TABLE public.workspace_ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all ad account mappings"
  ON public.workspace_ad_accounts FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Clients read own workspace ad accounts"
  ON public.workspace_ad_accounts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stores s
    JOIN public.entities e ON e.id = s.entity_id
    WHERE s.id = workspace_ad_accounts.workspace_id AND e.account_id = auth.uid()
  ));

CREATE TRIGGER workspace_ad_accounts_touch
  BEFORE UPDATE ON public.workspace_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Call log for the ads gateway. Admin-readable, service-role written.
CREATE TABLE public.ads_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'meta',
  tool text NOT NULL,
  ad_account_id text,
  params_hash text NOT NULL,
  status_code integer,
  ok boolean NOT NULL,
  cached boolean NOT NULL DEFAULT false,
  rows_returned integer NOT NULL DEFAULT 0,
  duration_ms integer,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  called_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ads_api_calls_created_idx ON public.ads_api_calls (created_at DESC);
CREATE INDEX ads_api_calls_workspace_idx ON public.ads_api_calls (workspace_id, created_at DESC);

GRANT SELECT ON public.ads_api_calls TO authenticated;
GRANT ALL ON public.ads_api_calls TO service_role;
ALTER TABLE public.ads_api_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read ads api calls"
  ON public.ads_api_calls FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. Response cache. Server-only: no grants, no policies.
CREATE TABLE public.ads_cache (
  cache_key text PRIMARY KEY,
  tool text NOT NULL,
  ad_account_id text,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ads_cache_expires_idx ON public.ads_cache (expires_at);
GRANT ALL ON public.ads_cache TO service_role;
ALTER TABLE public.ads_cache ENABLE ROW LEVEL SECURITY;

-- 4. "Notify us" activation requests from clients with no mapped account.
CREATE TABLE public.ads_activation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'open',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ads_activation_requests_status_chk CHECK (status IN ('open','done'))
);
CREATE INDEX ads_activation_requests_workspace_idx ON public.ads_activation_requests (workspace_id, created_at DESC);

GRANT SELECT ON public.ads_activation_requests TO authenticated;
GRANT ALL ON public.ads_activation_requests TO service_role;
ALTER TABLE public.ads_activation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all ads activation requests"
  ON public.ads_activation_requests FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Clients read own ads activation requests"
  ON public.ads_activation_requests FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stores s
    JOIN public.entities e ON e.id = s.entity_id
    WHERE s.id = ads_activation_requests.workspace_id AND e.account_id = auth.uid()
  ));
