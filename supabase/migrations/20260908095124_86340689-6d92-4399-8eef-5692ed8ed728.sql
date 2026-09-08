ALTER TABLE public.quote_lines
  ADD COLUMN IF NOT EXISTS fee_included boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quote_lines.fee_included IS
  'True when the entered supplier price already contains the sourcing fee; sourcing_cost then equals supplier_unit_price and no fee is applied again.';

-- Legacy admin-entered lines (markup model, no sourcing layer): the entered
-- cost carried no sourcing fee, so treat it as the sourcing cost directly and
-- fold both markups into a single margin percentage.
UPDATE public.quote_lines
SET
  supplier_unit_price = round(coalesce(supplier_cogs, 0) + coalesce(supplier_shipping, 0), 2),
  sourcing_cost       = round(coalesce(supplier_cogs, 0) + coalesce(supplier_shipping, 0), 2),
  sourcing_fee_rate   = coalesce(sourcing_fee_rate, 0),
  fee_included        = true,
  margin_pct = CASE
    WHEN coalesce(supplier_cogs, 0) + coalesce(supplier_shipping, 0) > 0
      THEN round(
        (coalesce(markup_product, 0) + coalesce(markup_shipping, 0))
        / (coalesce(supplier_cogs, 0) + coalesce(supplier_shipping, 0)) * 100, 2)
    ELSE 0
  END
WHERE sourcing_cost IS NULL;

-- Lines already entered through the sourcing layer had the 8% fee baked into
-- the supplier price by hand; flag them so the fee is not applied twice.
UPDATE public.quote_lines
SET
  fee_included      = true,
  sourcing_cost     = supplier_unit_price,
  supplier_cogs     = coalesce(supplier_cogs, supplier_unit_price),
  supplier_shipping = coalesce(supplier_shipping, 0),
  supplier_tax      = coalesce(supplier_tax, 0)
WHERE sourcing_cost IS NOT NULL
  AND supplier_unit_price IS NOT NULL
  AND fee_included = false;

DROP FUNCTION IF EXISTS public.admin_save_quote_lines(uuid, jsonb, text, date, text);

ALTER TABLE public.quote_lines
  DROP COLUMN IF EXISTS markup_product,
  DROP COLUMN IF EXISTS markup_shipping;