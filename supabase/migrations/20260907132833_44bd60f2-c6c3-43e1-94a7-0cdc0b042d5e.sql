-- ============ A. Sourcing collaborator role ============
CREATE TABLE public.sourcing_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  fee_rate numeric NOT NULL DEFAULT 0.08 CHECK (fee_rate >= 0 AND fee_rate <= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sourcing_collaborators TO authenticated;
GRANT ALL ON public.sourcing_collaborators TO service_role;
ALTER TABLE public.sourcing_collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own row or admin" ON public.sourcing_collaborators
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_sourcing_collaborators BEFORE UPDATE ON public.sourcing_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.is_sourcing(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sourcing_collaborators
    WHERE user_id = _user_id AND active
  );
$$;
REVOKE ALL ON FUNCTION public.is_sourcing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_sourcing(uuid) TO authenticated, service_role;

-- ============ B. Pricing chain on quote lines ============
ALTER TABLE public.quote_lines
  ADD COLUMN supplier_id uuid REFERENCES public.suppliers(id),
  ADD COLUMN supplier_unit_price numeric,
  ADD COLUMN production_lead_days integer,
  ADD COLUMN sourcing_notes text,
  ADD COLUMN sourcing_image_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN sourced_by uuid REFERENCES auth.users(id),
  ADD COLUMN sourcing_fee_rate numeric,
  ADD COLUMN sourcing_cost numeric,
  ADD COLUMN margin_pct numeric NOT NULL DEFAULT 15,
  ADD COLUMN sourced_at timestamptz;

ALTER TABLE public.quote_requests
  ADD COLUMN assigned_sourcer uuid REFERENCES auth.users(id),
  ADD COLUMN sourcing_submitted_at timestamptz;

-- ============ D. Stock purchases ============
CREATE TYPE public.stock_purchase_path AS ENUM ('flysales', 'direct');
CREATE TYPE public.stock_purchase_status AS ENUM (
  'requested', 'freight_quoted', 'paid', 'in_production', 'shipped', 'delivered', 'cancelled'
);

CREATE TABLE public.stock_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  quote_request_id uuid REFERENCES public.quote_requests(id),
  quote_line_id uuid REFERENCES public.quote_lines(id),
  product_id uuid REFERENCES public.products(id),
  path public.stock_purchase_path NOT NULL,
  status public.stock_purchase_status NOT NULL DEFAULT 'requested',
  product_name text NOT NULL,
  variant_label text,
  sku text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  goods_total numeric NOT NULL CHECK (goods_total >= 0),
  freight_cost numeric,
  total_amount numeric,
  delivery_address jsonb,
  inbound_shipment_id uuid,
  tracking_number text,
  tracking_carrier text,
  supplier_unit_price numeric,
  sourcing_fee_rate numeric,
  sourced_by uuid REFERENCES auth.users(id),
  wallet_reference text,
  admin_notes text,
  created_by uuid REFERENCES public.profiles(id),
  paid_at timestamptz,
  freight_quoted_at timestamptz,
  in_production_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_purchases_store_idx ON public.stock_purchases(store_id, created_at DESC);
CREATE INDEX stock_purchases_status_idx ON public.stock_purchases(status);

GRANT SELECT ON public.stock_purchases TO authenticated;
GRANT ALL ON public.stock_purchases TO service_role;
ALTER TABLE public.stock_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients read own workspace purchases" ON public.stock_purchases
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stores s
    JOIN public.entities e ON e.id = s.entity_id
    WHERE s.id = stock_purchases.store_id AND e.account_id = auth.uid()
  ));
CREATE POLICY "Admins read all purchases" ON public.stock_purchases
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_stock_purchases BEFORE UPDATE ON public.stock_purchases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Inbound shipments created by a FlySales-sourced stock purchase
ALTER TABLE public.inbound_shipments
  ADD COLUMN source text NOT NULL DEFAULT 'client',
  ADD COLUMN stock_purchase_id uuid REFERENCES public.stock_purchases(id);

ALTER TABLE public.stock_purchases
  ADD CONSTRAINT stock_purchases_inbound_fkey
  FOREIGN KEY (inbound_shipment_id) REFERENCES public.inbound_shipments(id);

-- ============ E. Sourcing earnings ledger ============
CREATE TABLE public.sourcing_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  quote_line_id uuid REFERENCES public.quote_lines(id),
  stock_purchase_id uuid REFERENCES public.stock_purchases(id),
  order_id uuid REFERENCES public.orders(id),
  description text NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  fee_rate numeric NOT NULL,
  supplier_unit_price numeric NOT NULL,
  amount numeric NOT NULL,
  accrued_at timestamptz NOT NULL DEFAULT now(),
  settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sourcing_earnings_collab_idx
  ON public.sourcing_earnings(collaborator_user_id, accrued_at DESC);

GRANT SELECT ON public.sourcing_earnings TO authenticated;
GRANT ALL ON public.sourcing_earnings TO service_role;
ALTER TABLE public.sourcing_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Collaborators read own earnings" ON public.sourcing_earnings
  FOR SELECT TO authenticated
  USING (collaborator_user_id = auth.uid());
CREATE POLICY "Admins read all earnings" ON public.sourcing_earnings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ Receipts ============
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'stock_purchase';