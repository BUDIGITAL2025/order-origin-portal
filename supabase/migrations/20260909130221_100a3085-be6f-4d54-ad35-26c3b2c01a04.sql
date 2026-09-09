CREATE TABLE public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  operation text not null,
  pages integer,
  duration_ms integer,
  status text not null default 'ok',
  error text,
  ref_table text,
  ref_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
GRANT SELECT ON public.ai_calls TO authenticated;
GRANT ALL ON public.ai_calls TO service_role;
ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read ai calls" ON public.ai_calls FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.catalog_imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  page_count integer not null default 1,
  status text not null default 'processing',
  error text,
  raw_response text,
  model text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_imports TO authenticated;
GRANT ALL ON public.catalog_imports TO service_role;
ALTER TABLE public.catalog_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage catalog imports" ON public.catalog_imports FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.catalog_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.catalog_imports(id) on delete cascade,
  page_no integer not null default 1,
  row_ref text,
  item_no text,
  description text,
  color text,
  size_text text,
  packaging text,
  inner_qty integer,
  outer_qty integer,
  available_qty integer,
  weight_g numeric(12,2),
  unit_price numeric(12,2),
  bbox jsonb,
  low_confidence text[] not null default '{}',
  image_urls text[] not null default '{}',
  included boolean not null default true,
  converted_quote_id uuid references public.quote_requests(id) on delete set null,
  converted_product_id uuid references public.products(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
CREATE INDEX catalog_import_rows_import_idx ON public.catalog_import_rows(import_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_import_rows TO authenticated;
GRANT ALL ON public.catalog_import_rows TO service_role;
ALTER TABLE public.catalog_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage catalog import rows" ON public.catalog_import_rows FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));