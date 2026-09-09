DROP FUNCTION IF EXISTS public.upsert_manual_inventory_item(uuid, text, text, text[], jsonb, integer, integer, numeric, text, integer, jsonb);

REVOKE ALL ON FUNCTION public.manual_stock_units_sold_since(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_stock_units_sold_since(uuid) TO service_role;