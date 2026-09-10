-- Supplier contact details (used on purchase orders)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS country text;

-- Purchase-order + supplier-invoice layer on a paid stock purchase
ALTER TABLE public.stock_purchases
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS po_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS po_document_path text,
  ADD COLUMN IF NOT EXISTS po_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS po_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS po_sent_channel text,
  ADD COLUMN IF NOT EXISTS po_payment_terms text,
  ADD COLUMN IF NOT EXISTS po_lead_days integer,
  ADD COLUMN IF NOT EXISTS reveal_consignee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_invoice_path text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_number text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_currency text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS supplier_invoice_extract jsonb,
  ADD COLUMN IF NOT EXISTS supplier_invoice_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_invoice_state text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_note text,
  ADD COLUMN IF NOT EXISTS supplier_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_payment_method text,
  ADD COLUMN IF NOT EXISTS supplier_payment_reference text,
  ADD COLUMN IF NOT EXISTS supplier_payment_proof_path text,
  ADD COLUMN IF NOT EXISTS supplier_paid_by uuid;

CREATE INDEX IF NOT EXISTS stock_purchases_sourced_by_idx ON public.stock_purchases (sourced_by);

CREATE SEQUENCE IF NOT EXISTS public.purchase_order_seq START 1;
CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'FS-PO-' || lpad(nextval('public.purchase_order_seq')::text, 4, '0');
$$;
REVOKE ALL ON FUNCTION public.generate_po_number() FROM public;
REVOKE ALL ON FUNCTION public.generate_po_number() FROM anon;
REVOKE ALL ON FUNCTION public.generate_po_number() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_po_number() TO service_role;

CREATE TABLE IF NOT EXISTS public.purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.stock_purchases(id) ON DELETE CASCADE,
  event text NOT NULL,
  detail text,
  actor_id uuid,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_events_purchase_idx ON public.purchase_events (purchase_id, created_at DESC);

GRANT SELECT ON public.purchase_events TO authenticated;
GRANT ALL ON public.purchase_events TO service_role;
ALTER TABLE public.purchase_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read purchase events" ON public.purchase_events;
CREATE POLICY "Admins read purchase events" ON public.purchase_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Sourcing agents read their purchase events" ON public.purchase_events;
CREATE POLICY "Sourcing agents read their purchase events" ON public.purchase_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stock_purchases sp
    WHERE sp.id = purchase_events.purchase_id AND sp.sourced_by = auth.uid()
  ));

DROP POLICY IF EXISTS "Sourcing agents read their purchases" ON public.stock_purchases;
CREATE POLICY "Sourcing agents read their purchases" ON public.stock_purchases
  FOR SELECT TO authenticated
  USING (sourced_by = auth.uid());

INSERT INTO public.internal_settings (key, value)
VALUES ('po_payment_terms', '30% deposit on order confirmation, 70% balance before shipment.')
ON CONFLICT (key) DO NOTHING;