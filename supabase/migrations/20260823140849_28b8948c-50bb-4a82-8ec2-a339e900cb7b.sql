
-- 1. Admin-only tables for internal fields -------------------------------------

CREATE TABLE public.quote_request_internal (
  quote_request_id uuid PRIMARY KEY REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  admin_notes text,
  internal_reference text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_request_internal TO authenticated;
GRANT ALL ON public.quote_request_internal TO service_role;
ALTER TABLE public.quote_request_internal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage quote request internals"
ON public.quote_request_internal FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE public.dispute_internal_notes (
  dispute_id uuid PRIMARY KEY REFERENCES public.disputes(id) ON DELETE CASCADE,
  admin_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispute_internal_notes TO authenticated;
GRANT ALL ON public.dispute_internal_notes TO service_role;
ALTER TABLE public.dispute_internal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage dispute internal notes"
ON public.dispute_internal_notes FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2. Migrate existing internal data --------------------------------------------

INSERT INTO public.quote_request_internal (quote_request_id, admin_notes, internal_reference)
SELECT id, admin_notes, internal_reference FROM public.quote_requests
WHERE admin_notes IS NOT NULL OR internal_reference IS NOT NULL;

INSERT INTO public.dispute_internal_notes (dispute_id, admin_notes)
SELECT id, admin_notes FROM public.disputes
WHERE admin_notes IS NOT NULL;

-- 3. Rewrite admin functions to use the internal tables ------------------------

CREATE OR REPLACE FUNCTION public.admin_save_quote_lines(p_quote_id uuid, p_lines jsonb, p_internal_reference text DEFAULT NULL::text, p_quote_valid_until date DEFAULT NULL::date, p_admin_notes text DEFAULT NULL::text)
 RETURNS SETOF quote_lines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.quote_requests%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_unit numeric;
  v_label text;
  v_country text;
  v_sku text;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'FORBIDDEN: admin access required';
  end if;
  select * into v_request from public.quote_requests where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_request.status not in ('submitted', 'sourcing', 'quoted') then
    raise exception 'QUOTE_NOT_EDITABLE';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'AT_LEAST_ONE_LINE_REQUIRED';
  end if;
  delete from public.quote_lines ql
   where ql.quote_request_id = p_quote_id and ql.status = 'pending'
     and not exists (
       select 1 from jsonb_array_elements(p_lines) e
       where e ? 'id' and e->>'id' is not null and (e->>'id')::uuid = ql.id
     );
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_label := trim(coalesce(v_line->>'variant_label', ''));
    if v_label = '' then
      raise exception 'VARIANT_LABEL_REQUIRED';
    end if;
    v_country := upper(trim(coalesce(v_line->>'country_code', '')));
    if length(v_country) <> 2 then
      raise exception 'COUNTRY_CODE_REQUIRED';
    end if;
    if not (v_country = any(v_request.target_countries)) then
      raise exception 'COUNTRY_NOT_IN_REQUEST: %', v_country;
    end if;
    v_unit := round(
        coalesce((v_line->>'supplier_cogs')::numeric, 0)
      + coalesce((v_line->>'supplier_shipping')::numeric, 0)
      + coalesce((v_line->>'supplier_tax')::numeric, 0)
      + coalesce((v_line->>'markup_product')::numeric, 0)
      + coalesce((v_line->>'markup_shipping')::numeric, 0)
    , 2);
    if v_line ? 'id' and v_line->>'id' is not null then
      v_line_id := (v_line->>'id')::uuid;
      update public.quote_lines set
        variant_label = v_label,
        country_code = v_country,
        supplier_cogs = coalesce((v_line->>'supplier_cogs')::numeric, 0),
        supplier_shipping = coalesce((v_line->>'supplier_shipping')::numeric, 0),
        supplier_tax = coalesce((v_line->>'supplier_tax')::numeric, 0),
        markup_product = coalesce((v_line->>'markup_product')::numeric, 0),
        markup_shipping = coalesce((v_line->>'markup_shipping')::numeric, 0),
        unit_price = v_unit,
        moq = (v_line->>'moq')::integer,
        lead_time_days = (v_line->>'lead_time_days')::integer
      where id = v_line_id and quote_request_id = p_quote_id and status = 'pending';
      if not found then
        raise exception 'LINE_NOT_EDITABLE';
      end if;
    else
      select ql.sku into v_sku
        from public.quote_lines ql
       where ql.quote_request_id = p_quote_id and ql.variant_label = v_label
       order by ql.created_at
       limit 1;
      if v_sku is null then
        v_sku := public.generate_sku('FS-');
      end if;
      insert into public.quote_lines (
        quote_request_id, variant_label, country_code, sku,
        supplier_cogs, supplier_shipping, supplier_tax, markup_product, markup_shipping,
        unit_price, moq, lead_time_days
      ) values (
        p_quote_id, v_label, v_country, v_sku,
        coalesce((v_line->>'supplier_cogs')::numeric, 0),
        coalesce((v_line->>'supplier_shipping')::numeric, 0),
        coalesce((v_line->>'supplier_tax')::numeric, 0),
        coalesce((v_line->>'markup_product')::numeric, 0),
        coalesce((v_line->>'markup_shipping')::numeric, 0),
        v_unit,
        (v_line->>'moq')::integer,
        (v_line->>'lead_time_days')::integer
      ) returning id into v_line_id;
    end if;
  end loop;
  update public.quote_requests set
    status = 'quoted',
    quoted_at = now(),
    quoted_by = auth.uid(),
    quote_valid_until = p_quote_valid_until
  where id = p_quote_id;
  insert into public.quote_request_internal (quote_request_id, admin_notes, internal_reference, updated_at)
  values (p_quote_id, nullif(p_admin_notes, ''), nullif(p_internal_reference, ''), now())
  on conflict (quote_request_id) do update set
    admin_notes = excluded.admin_notes,
    internal_reference = excluded.internal_reference,
    updated_at = now();
  return query select * from public.quote_lines where quote_request_id = p_quote_id order by created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_dispute(p_dispute_id uuid, p_resolution dispute_resolution, p_credit_amount numeric DEFAULT NULL::numeric, p_admin_notes text DEFAULT NULL::text, p_client_message text DEFAULT NULL::text)
 RETURNS disputes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dispute public.disputes%rowtype;
  v_entity_id uuid;
  v_order_number text;
  v_new_status public.dispute_status;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'FORBIDDEN: admin access required';
  end if;

  select * into v_dispute from public.disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'DISPUTE_NOT_FOUND';
  end if;
  if v_dispute.status not in ('open', 'investigating') then
    raise exception 'DISPUTE_ALREADY_RESOLVED';
  end if;

  select s.entity_id into v_entity_id from public.stores s where s.id = v_dispute.store_id;
  select o.external_order_number into v_order_number from public.orders o where o.id = v_dispute.order_id;

  if p_resolution = 'wallet_credit' then
    if p_credit_amount is null or p_credit_amount <= 0 then
      raise exception 'CREDIT_AMOUNT_REQUIRED';
    end if;
    perform public.apply_wallet_transaction(
      v_entity_id,
      'credit',
      p_credit_amount,
      'Dispute credit — order ' || coalesce(v_order_number, v_dispute.order_id::text),
      p_dispute_id::text
    );
    v_new_status := 'approved'::public.dispute_status;
  elsif p_resolution = 'reshipped' then
    v_new_status := 'approved'::public.dispute_status;
    p_credit_amount := null;
  else
    if nullif(trim(coalesce(p_client_message, '')), '') is null then
      raise exception 'REJECT_REASON_REQUIRED: give the client a reason';
    end if;
    v_new_status := 'rejected'::public.dispute_status;
    p_credit_amount := null;
  end if;

  update public.disputes set
    status = v_new_status,
    resolution = p_resolution,
    credit_amount = p_credit_amount,
    resolved_at = now()
  where id = p_dispute_id
  returning * into v_dispute;

  insert into public.dispute_internal_notes (dispute_id, admin_notes, updated_at, updated_by)
  values (p_dispute_id, nullif(p_admin_notes, ''), now(), auth.uid())
  on conflict (dispute_id) do update set
    admin_notes = excluded.admin_notes,
    updated_at = now(),
    updated_by = auth.uid();

  if p_resolution = 'rejected' then
    insert into public.dispute_messages (dispute_id, author_id, author_role, body)
    values (p_dispute_id, auth.uid(), 'admin'::public.dispute_author_role, trim(p_client_message));
  end if;

  insert into public.notifications (entity_id, store_id, kind, title, body)
  values (
    v_entity_id,
    v_dispute.store_id,
    'dispute_resolved',
    case when v_new_status = 'approved'::public.dispute_status then 'Dispute approved' else 'Dispute rejected' end,
    case
      when p_resolution = 'wallet_credit' then
        format('Your dispute for order %s was approved — $%s was credited to your wallet.',
          coalesce(v_order_number, ''), to_char(p_credit_amount, 'FM999999990.00'))
      when p_resolution = 'reshipped' then
        format('Your dispute for order %s was approved — a replacement is being shipped.',
          coalesce(v_order_number, ''))
      else
        format('Your dispute for order %s was rejected — see the dispute thread for details.',
          coalesce(v_order_number, ''))
    end
  );

  return v_dispute;
end;
$function$;

-- 4. Drop the exposed internal columns -----------------------------------------

ALTER TABLE public.quote_requests DROP COLUMN admin_notes;
ALTER TABLE public.quote_requests DROP COLUMN internal_reference;
ALTER TABLE public.disputes DROP COLUMN admin_notes;

-- 5. Replace the security definer view with an ownership-checked function ------

DROP VIEW public.quote_lines_client;

CREATE OR REPLACE FUNCTION public.get_client_quote_lines(p_quote_request_id uuid)
 RETURNS TABLE (
   id uuid,
   quote_request_id uuid,
   variant_label text,
   country_code text,
   sku text,
   unit_price numeric,
   moq integer,
   lead_time_days integer,
   status public.quote_line_status,
   responded_at timestamptz,
   created_at timestamptz
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ql.id, ql.quote_request_id, ql.variant_label, ql.country_code, ql.sku,
         ql.unit_price, ql.moq, ql.lead_time_days, ql.status, ql.responded_at, ql.created_at
  from public.quote_lines ql
  join public.quote_requests qr on qr.id = ql.quote_request_id
  join public.stores s on s.id = qr.store_id
  join public.entities e on e.id = s.entity_id
  where ql.quote_request_id = p_quote_request_id
    and e.account_id = auth.uid()
  order by ql.created_at;
$function$;

REVOKE ALL ON FUNCTION public.get_client_quote_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_quote_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_quote_lines(uuid) TO service_role;

-- 6. Tighten EXECUTE grants on privileged / internal functions ------------------

DO $do$
DECLARE
  f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.apply_wallet_transaction(uuid,text,numeric,text,text)'::regprocedure,
    'public.create_manual_order_internal(uuid,jsonb,jsonb,text,jsonb)'::regprocedure,
    'public.admin_resolve_order_item(uuid,uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.connect_draft_store(uuid,text,text)'::regprocedure,
    'public.create_manual_order(uuid,jsonb,jsonb,text,jsonb)'::regprocedure,
    'public.import_manual_orders(uuid,jsonb)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$do$;
