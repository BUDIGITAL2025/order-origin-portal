-- ============ ownership helper ============
CREATE OR REPLACE FUNCTION public.owns_quote(p_quote uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.quote_requests q
    JOIN public.stores s ON s.id = q.store_id
    JOIN public.entities e ON e.id = s.entity_id
    WHERE q.id = p_quote AND e.account_id = auth.uid()
  );
$$;

-- ============ quote_options ============
CREATE TABLE public.quote_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  letter text NOT NULL CHECK (letter IN ('A','B','C')),
  supplier_id uuid REFERENCES public.suppliers(id),
  quality smallint NOT NULL DEFAULT 2 CHECK (quality BETWEEN 1 AND 3),
  recommended boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  accepted_at timestamptz,
  moq integer,
  production_lead_days numeric(6,1),
  shipping_lead_days numeric(6,1),
  margin_pct numeric(6,2) NOT NULL DEFAULT 15,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_request_id, letter)
);
CREATE INDEX quote_options_quote_idx ON public.quote_options(quote_request_id);

GRANT SELECT ON public.quote_options TO authenticated;
GRANT ALL ON public.quote_options TO service_role;
ALTER TABLE public.quote_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read published options of their quotes"
ON public.quote_options FOR SELECT TO authenticated
USING (published AND public.owns_quote(quote_request_id));

CREATE POLICY "Admins read all quote options"
ON public.quote_options FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER quote_options_touch
BEFORE UPDATE ON public.quote_options
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ quote_lines.option_id ============
ALTER TABLE public.quote_lines
  ADD COLUMN option_id uuid REFERENCES public.quote_options(id) ON DELETE SET NULL;
CREATE INDEX quote_lines_option_idx ON public.quote_lines(option_id);

-- Backfill: every existing quote with lines gets its Option A, and all of its
-- current lines belong to it. Nothing about those quotes changes for clients.
INSERT INTO public.quote_options (quote_request_id, letter, supplier_id, published, recommended, moq, production_lead_days, margin_pct)
SELECT q.id,
       'A',
       (SELECT l.supplier_id FROM public.quote_lines l WHERE l.quote_request_id = q.id AND l.supplier_id IS NOT NULL LIMIT 1),
       q.status IN ('quoted','closed','expired'),
       true,
       (SELECT min(l.moq) FROM public.quote_lines l WHERE l.quote_request_id = q.id),
       (SELECT max(l.production_lead_days) FROM public.quote_lines l WHERE l.quote_request_id = q.id),
       COALESCE((SELECT max(l.margin_pct) FROM public.quote_lines l WHERE l.quote_request_id = q.id), 15)
FROM public.quote_requests q
WHERE EXISTS (SELECT 1 FROM public.quote_lines l WHERE l.quote_request_id = q.id);

UPDATE public.quote_lines l
SET option_id = o.id
FROM public.quote_options o
WHERE o.quote_request_id = l.quote_request_id AND o.letter = 'A' AND l.option_id IS NULL;

-- ============ quote_messages ============
CREATE TABLE public.quote_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id),
  author_role text NOT NULL CHECK (author_role IN ('client','admin','system')),
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message','system')),
  system_code text,
  body text,
  attachments text[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  read_by_client_at timestamptz,
  read_by_admin_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_messages_quote_idx ON public.quote_messages(quote_request_id, created_at);

GRANT SELECT, INSERT ON public.quote_messages TO authenticated;
GRANT ALL ON public.quote_messages TO service_role;
ALTER TABLE public.quote_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read their quote thread"
ON public.quote_messages FOR SELECT TO authenticated
USING (public.owns_quote(quote_request_id));

CREATE POLICY "Clients post in their quote thread"
ON public.quote_messages FOR INSERT TO authenticated
WITH CHECK (
  public.owns_quote(quote_request_id)
  AND author_user_id = auth.uid()
  AND author_role = 'client'
  AND kind = 'message'
);

CREATE POLICY "Admins read every quote thread"
ON public.quote_messages FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============ quote_intents ============
CREATE TYPE public.quote_intent_type AS ENUM (
  'price_too_high','add_country','size_chart','factory_photos',
  'materials_list','new_variant','stop_quoting'
);

CREATE TABLE public.quote_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  type public.quote_intent_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  handled_at timestamptz,
  handled_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_intents_status_idx ON public.quote_intents(status, created_at);

GRANT SELECT, INSERT ON public.quote_intents TO authenticated;
GRANT ALL ON public.quote_intents TO service_role;
ALTER TABLE public.quote_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read their own quote requests queue"
ON public.quote_intents FOR SELECT TO authenticated
USING (public.owns_quote(quote_request_id));

CREATE POLICY "Admins read every quote request"
ON public.quote_intents FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER quote_intents_touch
BEFORE UPDATE ON public.quote_intents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ accept one option ============
CREATE OR REPLACE FUNCTION public.accept_quote_option(p_option_id uuid, p_product_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_option public.quote_options%rowtype;
  v_decisions jsonb;
  v_accepted integer;
begin
  select * into v_option from public.quote_options where id = p_option_id;
  if not found or not public.owns_quote(v_option.quote_request_id) then
    raise exception 'OPTION_NOT_FOUND';
  end if;
  if not v_option.published or v_option.archived_at is not null then
    raise exception 'OPTION_NOT_AVAILABLE';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', l.id,
           'accept', l.option_id = p_option_id
         )), '[]'::jsonb)
    into v_decisions
    from public.quote_lines l
   where l.quote_request_id = v_option.quote_request_id
     and l.status = 'pending';

  if jsonb_array_length(v_decisions) = 0 then
    raise exception 'NO_DECISIONS';
  end if;

  v_accepted := public.respond_to_quote_lines(
    v_option.quote_request_id, p_product_name, v_decisions
  );

  update public.quote_options
     set accepted_at = now()
   where id = p_option_id;

  update public.quote_options
     set archived_at = now()
   where quote_request_id = v_option.quote_request_id
     and id <> p_option_id
     and archived_at is null;

  insert into public.quote_messages (quote_request_id, author_role, kind, system_code, body)
  values (v_option.quote_request_id, 'system', 'system', 'option_accepted',
          'Option ' || v_option.letter || ' accepted');

  return v_accepted;
end;
$$;

GRANT EXECUTE ON FUNCTION public.accept_quote_option(uuid, text) TO authenticated;