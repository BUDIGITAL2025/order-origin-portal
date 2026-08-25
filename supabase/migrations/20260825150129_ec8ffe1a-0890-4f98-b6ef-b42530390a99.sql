ALTER TABLE public.integration_events
  ADD COLUMN IF NOT EXISTS entry_path text NOT NULL DEFAULT 'webhook';

ALTER TABLE public.integration_events
  DROP CONSTRAINT IF EXISTS integration_events_entry_path_check;

ALTER TABLE public.integration_events
  ADD CONSTRAINT integration_events_entry_path_check
  CHECK (entry_path IN ('webhook', 'poll'));

CREATE INDEX IF NOT EXISTS integration_events_tenant_path_idx
  ON public.integration_events (tenant_id, event_type, entry_path, created_at DESC);