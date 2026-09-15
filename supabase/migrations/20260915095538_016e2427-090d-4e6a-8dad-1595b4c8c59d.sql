ALTER TABLE public.quote_lines ALTER COLUMN margin_pct SET DEFAULT 10;
INSERT INTO public.internal_settings (key, value) VALUES ('default_margin_pct', '10')
ON CONFLICT (key) DO NOTHING;