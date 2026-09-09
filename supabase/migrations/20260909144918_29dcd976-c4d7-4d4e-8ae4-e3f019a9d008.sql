
ALTER TABLE public.quote_messages
  DROP CONSTRAINT IF EXISTS quote_messages_author_role_check;
ALTER TABLE public.quote_messages
  ADD CONSTRAINT quote_messages_author_role_check
  CHECK (author_role = ANY (ARRAY['client'::text, 'admin'::text, 'system'::text, 'sourcing'::text]));

ALTER TABLE public.quote_messages
  ADD COLUMN IF NOT EXISTS read_by_sourcer_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.is_assigned_sourcer(p_quote uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.quote_requests q
    JOIN public.sourcing_collaborators c
      ON c.user_id = auth.uid() AND c.active = true
    WHERE q.id = p_quote
      AND q.assigned_sourcer = auth.uid()
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_assigned_sourcer(uuid) TO authenticated;

DROP POLICY IF EXISTS "Sourcers read their assigned quote thread" ON public.quote_messages;
CREATE POLICY "Sourcers read their assigned quote thread"
ON public.quote_messages FOR SELECT
TO authenticated
USING (public.is_assigned_sourcer(quote_request_id));

DROP POLICY IF EXISTS "Sourcers post in their assigned quote thread" ON public.quote_messages;
CREATE POLICY "Sourcers post in their assigned quote thread"
ON public.quote_messages FOR INSERT
TO authenticated
WITH CHECK (
  public.is_assigned_sourcer(quote_request_id)
  AND author_role = 'sourcing'
  AND author_user_id = auth.uid()
  AND kind = 'message'
);

DROP POLICY IF EXISTS "Sourcers read requests on their quotes" ON public.quote_intents;
CREATE POLICY "Sourcers read requests on their quotes"
ON public.quote_intents FOR SELECT
TO authenticated
USING (public.is_assigned_sourcer(quote_request_id));
