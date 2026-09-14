CREATE TABLE public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date date NOT NULL UNIQUE,
  base text NOT NULL DEFAULT 'USD',
  eur numeric NOT NULL,
  cny numeric NOT NULL,
  source text NOT NULL DEFAULT 'frankfurter.app',
  manual boolean NOT NULL DEFAULT false,
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read fx rates" ON public.fx_rates FOR SELECT TO authenticated USING (true);

CREATE TABLE public.fx_fetch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date date,
  source text NOT NULL,
  status text NOT NULL,
  error text,
  duration_ms integer,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fx_fetch_log TO authenticated;
GRANT ALL ON public.fx_fetch_log TO service_role;
ALTER TABLE public.fx_fetch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read fx fetch log" ON public.fx_fetch_log FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TRIGGER fx_rates_touch BEFORE UPDATE ON public.fx_rates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.quote_lines
  ADD COLUMN IF NOT EXISTS supplier_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS supplier_cogs_original numeric,
  ADD COLUMN IF NOT EXISTS supplier_shipping_original numeric,
  ADD COLUMN IF NOT EXISTS fx_rate_used numeric,
  ADD COLUMN IF NOT EXISTS fx_rate_date date;

ALTER TABLE public.catalog_import_rows
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS remark text,
  ADD COLUMN IF NOT EXISTS unavailable boolean NOT NULL DEFAULT false;

ALTER TABLE public.catalog_imports
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'ai_file',
  ADD COLUMN IF NOT EXISTS column_mapping jsonb;