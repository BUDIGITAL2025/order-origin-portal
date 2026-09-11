ALTER TABLE public.sourcing_collaborators
  ADD COLUMN IF NOT EXISTS fee_tiers jsonb NOT NULL
    DEFAULT '[{"upto":500,"rate":0.08},{"upto":1000,"rate":0.05},{"upto":null,"rate":0.03}]'::jsonb,
  ADD COLUMN IF NOT EXISTS paid_transactions integer NOT NULL DEFAULT 0;

UPDATE public.sourcing_collaborators c
SET paid_transactions = COALESCE((
  SELECT count(*) FROM public.sourcing_earnings e
  WHERE e.collaborator_user_id = c.user_id
), 0);