CREATE TYPE public.spymarket_plan AS ENUM ('starter', 'plus', 'max');

CREATE TABLE public.spymarket_interest (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  plan_interest public.spymarket_plan NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

GRANT SELECT, INSERT, UPDATE ON public.spymarket_interest TO authenticated;
GRANT ALL ON public.spymarket_interest TO service_role;

ALTER TABLE public.spymarket_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own spymarket interest"
  ON public.spymarket_interest FOR SELECT TO authenticated
  USING (account_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients register own spymarket interest"
  ON public.spymarket_interest FOR INSERT TO authenticated
  WITH CHECK (account_id = auth.uid());

CREATE POLICY "Clients change own spymarket plan"
  ON public.spymarket_interest FOR UPDATE TO authenticated
  USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());