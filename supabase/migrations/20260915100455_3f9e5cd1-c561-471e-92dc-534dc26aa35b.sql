-- Clients must never be able to read quote_options directly: the row carries
-- internal_notes, margin_pct and supplier_id. The app already serves offers
-- through server code that selects client-safe columns only, so the direct
-- read policy is removed and replaced by a SECURITY DEFINER function that
-- returns exactly the client-facing fields.
DROP POLICY IF EXISTS "Clients read published options of their quotes" ON public.quote_options;

CREATE OR REPLACE FUNCTION public.get_client_quote_options(p_quote_request_id uuid)
RETURNS TABLE (
  id uuid,
  letter text,
  quality smallint,
  recommended boolean,
  moq integer,
  production_lead_days numeric,
  shipping_lead_days numeric,
  accepted_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.letter, o.quality, o.recommended, o.moq,
         o.production_lead_days, o.shipping_lead_days, o.accepted_at
  FROM public.quote_options o
  WHERE o.quote_request_id = p_quote_request_id
    AND o.published
    AND o.archived_at IS NULL
    AND public.owns_quote(o.quote_request_id)
  ORDER BY o.letter
$$;

REVOKE ALL ON FUNCTION public.get_client_quote_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_quote_options(uuid) TO authenticated, service_role;