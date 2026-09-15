CREATE TABLE public.sourcing_client_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  paid_units integer NOT NULL DEFAULT 0,
  fee_tiers jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_user_id, entity_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sourcing_client_tiers TO authenticated;
GRANT ALL ON public.sourcing_client_tiers TO service_role;

ALTER TABLE public.sourcing_client_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage sourcing client tiers"
  ON public.sourcing_client_tiers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Agents read their own client tiers"
  ON public.sourcing_client_tiers FOR SELECT TO authenticated
  USING (collaborator_user_id = auth.uid());

CREATE TRIGGER touch_sourcing_client_tiers
  BEFORE UPDATE ON public.sourcing_client_tiers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Recompute the counters under the per-client model from the paid history.
INSERT INTO public.sourcing_client_tiers (collaborator_user_id, entity_id, paid_units)
SELECT e.collaborator_user_id, x.entity_id, SUM(e.units)::int
FROM public.sourcing_earnings e
JOIN LATERAL (
  SELECT COALESCE(sp.entity_id, st.entity_id) AS entity_id
  FROM (SELECT 1) z
  LEFT JOIN public.stock_purchases sp ON sp.id = e.stock_purchase_id
  LEFT JOIN public.orders o ON o.id = e.order_id
  LEFT JOIN public.stores st ON st.id = o.store_id
) x ON x.entity_id IS NOT NULL
GROUP BY e.collaborator_user_id, x.entity_id
ON CONFLICT (collaborator_user_id, entity_id) DO UPDATE SET paid_units = EXCLUDED.paid_units;