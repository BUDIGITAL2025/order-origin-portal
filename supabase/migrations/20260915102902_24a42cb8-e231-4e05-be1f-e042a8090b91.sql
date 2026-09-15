-- Column-level read grants: clients (authenticated role via PostgREST) may only
-- read client-safe columns. Staff/admin paths use the service role and are
-- unaffected.

REVOKE SELECT ON public.products FROM authenticated, anon;
GRANT SELECT (
  id, quote_line_id, sku, product_name, variant_label, product_type,
  price_override, moq, status, created_at, store_id,
  production_lead_days, transit_lead_days, safety_margin_days,
  tags, weight, weight_unit, fulfilment_model, client_owned,
  image_urls, image_url, weight_grams, archived_at
) ON public.products TO authenticated;

REVOKE SELECT ON public.orders FROM authenticated, anon;
GRANT SELECT (
  id, external_order_id, external_order_number, status, payment_method,
  total_amount, destination_country, shipping_address, paid_at, cancelled_at,
  created_at, store_id, shipped_at, delivered_at, tracking_number,
  tracking_carrier, source, archived_at
) ON public.orders TO authenticated;

REVOKE SELECT ON public.quote_requests FROM authenticated, anon;
GRANT SELECT (
  id, product_url, product_name, notes, target_monthly_volume, image_urls,
  status, quote_valid_until, quoted_at, responded_at, created_at,
  supersedes_quote_id, target_countries, store_id, quote_due_at,
  sourcing_submitted_at, archived_at
) ON public.quote_requests TO authenticated;

GRANT ALL ON public.products TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.quote_requests TO service_role;