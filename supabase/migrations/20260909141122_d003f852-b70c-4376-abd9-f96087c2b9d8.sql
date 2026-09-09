ALTER TABLE public.quote_lines DROP CONSTRAINT IF EXISTS quote_lines_variant_country_unique;
CREATE UNIQUE INDEX IF NOT EXISTS quote_lines_option_variant_country_unique
  ON public.quote_lines (quote_request_id, option_id, variant_label, country_code);