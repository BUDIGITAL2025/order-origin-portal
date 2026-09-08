-- ============================================================
-- Data Lake foundation: generic async jobs + artifacts
-- ============================================================

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  module text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','partial')),
  phase text,
  progress_pct integer NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  error text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_cost numeric(12,6) NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read jobs"
  ON public.jobs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX jobs_module_kind_created_idx
  ON public.jobs (module, kind, created_at DESC);
CREATE INDEX jobs_pending_idx
  ON public.jobs (created_at)
  WHERE status IN ('queued','running');

CREATE TRIGGER jobs_touch_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------

CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  module text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'building'
    CHECK (status IN ('building','ready','failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind)
);

GRANT SELECT ON public.artifacts TO authenticated;
GRANT ALL ON public.artifacts TO service_role;

ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read artifacts"
  ON public.artifacts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX artifacts_job_idx ON public.artifacts (job_id);
CREATE INDEX artifacts_module_kind_idx ON public.artifacts (module, kind, created_at DESC);

CREATE TRIGGER artifacts_touch_updated_at
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();