ALTER TABLE public.integration_events ADD COLUMN IF NOT EXISTS simulator boolean NOT NULL DEFAULT false;
ALTER TABLE public.integration_calls ADD COLUMN IF NOT EXISTS simulator boolean NOT NULL DEFAULT false;

CREATE TABLE public.simulator_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint text NOT NULL,
  action text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb,
  response jsonb,
  replay_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.simulator_calls TO service_role;
ALTER TABLE public.simulator_calls ENABLE ROW LEVEL SECURITY;