ALTER TABLE public.quote_requests ADD COLUMN IF NOT EXISTS client_site boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.url_host(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(
    regexp_replace(
      lower(split_part(regexp_replace(coalesce(p_url,''), '^[a-zA-Z]+://', ''), '/', 1)),
      '^www\.', ''
    ), '');
$$;

CREATE OR REPLACE FUNCTION public.detect_client_site(p_store_id uuid, p_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host text := public.url_host(p_url);
  v_store_host text;
  v_frag text;
  v_names text[];
BEGIN
  IF v_host IS NULL OR p_store_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT public.url_host(s.store_url),
         array_remove(ARRAY[s.store_name, e.legal_name], NULL)
    INTO v_store_host, v_names
  FROM public.stores s
  LEFT JOIN public.entities e ON e.id = s.entity_id
  WHERE s.id = p_store_id;

  IF v_store_host IS NOT NULL AND (v_host = v_store_host
      OR v_host LIKE '%.' || v_store_host
      OR v_store_host LIKE '%.' || v_host) THEN
    RETURN true;
  END IF;

  -- Heuristic: the workspace / company name appears inside the domain.
  FOREACH v_frag IN ARRAY coalesce(v_names, ARRAY[]::text[]) LOOP
    v_frag := regexp_replace(lower(v_frag), '[^a-z0-9]', '', 'g');
    IF length(v_frag) >= 5 AND position(v_frag in regexp_replace(v_host, '[^a-z0-9]', '', 'g')) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_quote_client_site()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.client_site := public.detect_client_site(NEW.store_id, NEW.product_url);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_requests_stamp_client_site ON public.quote_requests;
CREATE TRIGGER quote_requests_stamp_client_site
BEFORE INSERT OR UPDATE OF product_url, store_id ON public.quote_requests
FOR EACH ROW EXECUTE FUNCTION public.stamp_quote_client_site();

UPDATE public.quote_requests q
SET client_site = public.detect_client_site(q.store_id, q.product_url)
WHERE q.client_site IS DISTINCT FROM public.detect_client_site(q.store_id, q.product_url);

ALTER TYPE public.quote_intent_type ADD VALUE IF NOT EXISTS 'need_product_details';