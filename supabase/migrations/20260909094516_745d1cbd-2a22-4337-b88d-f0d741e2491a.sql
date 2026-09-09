ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_grams integer;
ALTER TABLE public.inbound_shipments
  ADD COLUMN IF NOT EXISTS declared_cartons integer,
  ADD COLUMN IF NOT EXISTS counted_cartons integer,
  ADD COLUMN IF NOT EXISTS expected_arrival_date date;

DROP FUNCTION IF EXISTS public.declare_inbound_shipment(uuid, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.declare_inbound_shipment(
  p_store_id uuid,
  p_qc boolean,
  p_lines jsonb,
  p_cartons integer DEFAULT NULL,
  p_expected_arrival date DEFAULT NULL
)
RETURNS inbound_shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_entity_id uuid;
  v_shipment public.inbound_shipments%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_total integer := 0;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;

  select e.id into v_entity_id
    from public.stores s join public.entities e on e.id = s.entity_id
   where s.id = p_store_id and e.account_id = auth.uid();
  if v_entity_id is null then raise exception 'STORE_NOT_FOUND'; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'LINES_REQUIRED';
  end if;

  insert into public.inbound_shipments (store_id, entity_id, qc, created_by, declared_cartons, expected_arrival_date)
  values (p_store_id, v_entity_id, coalesce(p_qc, false), auth.uid(),
          nullif(greatest(coalesce(p_cartons, 0), 0), 0), p_expected_arrival)
  returning * into v_shipment;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'quantity')::integer, 0);
    select * into v_product from public.products
     where id = (v_line->>'product_id')::uuid and store_id = p_store_id;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if v_product.fulfilment_model <> 'stock_in' then raise exception 'NOT_STOCK_IN'; end if;
    if v_qty < 10 then raise exception 'MIN_10_UNITS'; end if;
    v_total := v_total + v_qty;
    insert into public.inbound_shipment_lines
      (shipment_id, product_id, sku, product_name, declared_qty)
    values
      (v_shipment.id, v_product.id, v_product.sku,
       v_product.product_name || coalesce(' — ' || v_product.variant_label, ''), v_qty);
  end loop;

  update public.inbound_shipments set declared_pieces = v_total
   where id = v_shipment.id returning * into v_shipment;

  return v_shipment;
end;
$function$;

DROP FUNCTION IF EXISTS public.admin_confirm_inbound_receipt(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.admin_confirm_inbound_receipt(
  p_shipment_id uuid,
  p_counts jsonb,
  p_counted_cartons integer DEFAULT NULL
)
RETURNS inbound_shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_shipment public.inbound_shipments%rowtype;
  v_count jsonb;
  v_line public.inbound_shipment_lines%rowtype;
  v_qty integer;
  v_total integer := 0;
  v_discrepancy boolean := false;
  v_fee numeric;
  v_reference text;
  v_existing integer;
begin
  if not (public.has_role(auth.uid(), 'admin') or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_shipment from public.inbound_shipments where id = p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status in ('completed', 'refused') then raise exception 'ALREADY_CLOSED'; end if;

  if p_counts is not null and jsonb_typeof(p_counts) = 'array' then
    for v_count in select * from jsonb_array_elements(p_counts) loop
      update public.inbound_shipment_lines
         set counted_qty = greatest(coalesce((v_count->>'counted_qty')::integer, 0), 0)
       where id = (v_count->>'line_id')::uuid and shipment_id = p_shipment_id;
    end loop;
  end if;

  update public.inbound_shipment_lines
     set counted_qty = declared_qty
   where shipment_id = p_shipment_id and counted_qty is null;

  for v_line in select * from public.inbound_shipment_lines where shipment_id = p_shipment_id loop
    v_qty := coalesce(v_line.counted_qty, 0);
    v_total := v_total + v_qty;
    if v_qty <> v_line.declared_qty then v_discrepancy := true; end if;

    insert into public.inventory_snapshots (store_id, sku, location, quantity, captured_at)
    values (
      v_shipment.store_id,
      v_line.sku,
      'Fulfilment center',
      coalesce((
        select i.quantity from public.inventory_snapshots i
         where i.store_id = v_shipment.store_id and i.sku = v_line.sku
           and i.location = 'Fulfilment center'
         order by i.captured_at desc limit 1
      ), 0) + v_qty,
      now()
    );
  end loop;

  if p_counted_cartons is not null
     and v_shipment.declared_cartons is not null
     and p_counted_cartons <> v_shipment.declared_cartons then
    v_discrepancy := true;
  end if;

  v_fee := round(v_total * (v_shipment.service_fee_per_piece + case when v_shipment.qc then v_shipment.qc_fee_per_piece else 0 end), 2);
  v_reference := 'inbound:' || p_shipment_id::text;

  select count(*) into v_existing from public.wallet_transactions where reference = v_reference;

  if v_existing = 0 and v_fee > 0 then
    perform public.apply_wallet_transaction(
      v_shipment.entity_id,
      'debit',
      v_fee,
      'Inbound service fee — ' || v_total || ' pieces',
      v_reference,
      auth.uid()
    );
  end if;

  update public.inbound_shipments
     set status = 'completed',
         counted_pieces = v_total,
         counted_cartons = coalesce(p_counted_cartons, counted_cartons),
         has_discrepancy = v_discrepancy,
         fee_charged = v_fee,
         wallet_reference = v_reference,
         received_at = coalesce(received_at, now()),
         completed_at = now()
   where id = p_shipment_id
  returning * into v_shipment;

  return v_shipment;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_inbound_expected_arrival(
  p_shipment_id uuid,
  p_expected_arrival date,
  p_cartons integer DEFAULT NULL
)
RETURNS inbound_shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_shipment public.inbound_shipments%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;

  select s.* into v_shipment from public.inbound_shipments s
    join public.entities e on e.id = s.entity_id
   where s.id = p_shipment_id
     and (e.account_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_shipment.status not in ('declared', 'in_transit') then raise exception 'INVALID_STATUS'; end if;

  update public.inbound_shipments
     set expected_arrival_date = p_expected_arrival,
         declared_cartons = coalesce(nullif(greatest(coalesce(p_cartons, 0), 0), 0), declared_cartons)
   where id = p_shipment_id
  returning * into v_shipment;

  return v_shipment;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_inbound_expected_arrival(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_inbound_expected_arrival(uuid, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_inbound_shipment(uuid, boolean, jsonb, integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_inbound_receipt(uuid, jsonb, integer) TO authenticated, service_role;