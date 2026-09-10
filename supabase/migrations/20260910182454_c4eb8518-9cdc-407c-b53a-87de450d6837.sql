CREATE TABLE public.workspace_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'stripe',
  environment text NOT NULL DEFAULT 'sandbox',
  stripe_customer_id text,
  stripe_subscription_id text,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_end date,
  granted_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, module_key, environment)
);

CREATE INDEX workspace_modules_sub_idx ON public.workspace_modules (stripe_subscription_id);

GRANT SELECT ON public.workspace_modules TO authenticated;
GRANT ALL ON public.workspace_modules TO service_role;

ALTER TABLE public.workspace_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their workspace modules"
ON public.workspace_modules FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.stores s
    JOIN public.entities e ON e.id = s.entity_id
    WHERE s.id = workspace_modules.store_id AND e.account_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE TRIGGER workspace_modules_touch
BEFORE UPDATE ON public.workspace_modules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Never strand live stock behind a paywall: every workspace that already
-- holds stock with us, or has an inbound shipment in flight, is granted the
-- fulfilment module by the platform.
INSERT INTO public.workspace_modules (store_id, module_key, source, status, notes)
SELECT DISTINCT s.id, 'fulfilment', 'admin_grant', 'active',
       'Automatic grant: workspace already using the warehouse service'
FROM public.stores s
WHERE EXISTS (
        SELECT 1 FROM public.inbound_shipments i
        WHERE i.store_id = s.id AND i.status <> 'refused'
      )
   OR EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.store_id = s.id AND p.fulfilment_model = 'stock_in'
      )
   OR EXISTS (
        SELECT 1 FROM public.stock_purchases sp
        WHERE sp.store_id = s.id AND sp.path = 'flysales'
      )
ON CONFLICT (store_id, module_key, environment) DO NOTHING;