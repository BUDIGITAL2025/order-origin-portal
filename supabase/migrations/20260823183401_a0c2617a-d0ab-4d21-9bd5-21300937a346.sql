CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(p_entity_id uuid, p_type text, p_amount numeric, p_description text, p_reference text DEFAULT NULL::text)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_new_balance numeric;
  v_row public.wallet_transactions%rowtype;
begin
  -- Trusted audited definer functions (pay_orders_from_wallet,
  -- create_manual_order_internal, ingest_order, release_awaiting_payment_orders)
  -- set app.internal_write before delegating the wallet write here.
  if not public.has_role(auth.uid(), 'admin') and auth.role() <> 'service_role'
     and current_setting('app.internal_write', true) is distinct from 'on' then
    raise exception 'Only admins or the service role can create wallet transactions';
  end if;
  if not exists (select 1 from public.entities where id = p_entity_id) then
    raise exception 'ENTITY_NOT_FOUND';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  if p_type not in ('credit', 'debit', 'adjustment') then
    raise exception 'Invalid transaction type: %', p_type;
  end if;
  if p_reference is not null and exists (
    select 1 from public.wallet_transactions where reference = p_reference
  ) then
    raise exception 'A transaction with reference % already exists', p_reference;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_entity_id::text));
  select balance_after into v_balance
    from public.wallet_transactions
   where entity_id = p_entity_id
   order by created_at desc, id desc
   limit 1
   for update;
  v_balance := coalesce(v_balance, 0);
  if p_type = 'debit' then
    v_new_balance := v_balance - p_amount;
    if v_new_balance < 0 then
      raise exception 'Insufficient funds: current balance is %, cannot debit %', v_balance, p_amount;
    end if;
  else
    v_new_balance := v_balance + p_amount;
  end if;
  insert into public.wallet_transactions
    (entity_id, type, amount, balance_after, description, reference, created_by)
  values
    (p_entity_id, p_type::public.wallet_txn_type, p_amount, v_new_balance, p_description, p_reference, auth.uid())
  returning * into v_row;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pay_orders_from_wallet(p_order_ids uuid[])
RETURNS TABLE(order_id uuid, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_entity_count integer;
  v_entity_id uuid;
  v_total numeric;
  v_balance numeric;
  v_order record;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'NO_ORDERS_SELECTED';
  end if;

  -- Wallet writes below go through apply_wallet_transaction on the caller's
  -- behalf; mark this audited function as an internal writer.
  perform set_config('app.internal_write', 'on', true);

  -- Only the caller's own, still-payable orders participate.
  select count(distinct s.entity_id), min(s.entity_id::text)::uuid
    into v_entity_count, v_entity_id
    from public.orders o
    join public.stores s on s.id = o.store_id
    join public.entities e on e.id = s.entity_id
   where o.id = any (p_order_ids)
     and o.status = 'awaiting_payment'
     and o.total_amount is not null
     and e.account_id = auth.uid();

  if v_entity_count = 0 then
    raise exception 'NO_PAYABLE_ORDERS: none of the selected orders are awaiting payment';
  end if;
  if v_entity_count > 1 then
    raise exception 'MIXED_ENTITIES: pay orders one entity at a time';
  end if;

  -- Frozen while suspended: awaiting_payment orders cannot be paid until the
  -- account is reactivated. They are NOT cancelled here — the normal 7-day
  -- expiry cycle still applies.
  if exists (
    select 1
      from public.entities e
      join public.profiles p on p.id = e.account_id
     where e.id = v_entity_id
       and (e.status = 'suspended' or p.status = 'suspended')
  ) then
    raise exception 'ACCOUNT_SUSPENDED: payments are frozen while this account is suspended';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_entity_id::text));

  -- Totals are re-read from the database — never trusted from the client.
  select coalesce(sum(o.total_amount), 0) into v_total
    from public.orders o
    join public.stores s on s.id = o.store_id
    join public.entities e on e.id = s.entity_id
   where o.id = any (p_order_ids)
     and o.status = 'awaiting_payment'
     and o.total_amount is not null
     and e.account_id = auth.uid();

  select wt.balance_after into v_balance
    from public.wallet_transactions wt
   where wt.entity_id = v_entity_id
   order by wt.created_at desc, wt.id desc
   limit 1;
  v_balance := coalesce(v_balance, 0);

  if v_balance < v_total then
    raise exception 'INSUFFICIENT_BALANCE: the selected orders total $% but the wallet balance is $%',
      to_char(v_total, 'FM999999990.00'), to_char(v_balance, 'FM999999990.00');
  end if;

  for v_order in
    select o.id, o.total_amount, o.external_order_number
      from public.orders o
      join public.stores s on s.id = o.store_id
      join public.entities e on e.id = s.entity_id
     where o.id = any (p_order_ids)
       and o.status = 'awaiting_payment'
       and o.total_amount is not null
       and e.account_id = auth.uid()
     order by o.created_at asc, o.id asc
  loop
    begin
      perform public.apply_wallet_transaction(
        v_entity_id,
        'debit',
        v_order.total_amount,
        'Order payment ' || coalesce(v_order.external_order_number, v_order.id::text),
        v_order.id::text
      );
    exception when raise_exception then
      -- Reference clash = paid through another path in the meantime; skip.
      continue;
    end;
    update public.orders
       set status = 'paid', payment_method = 'wallet', paid_at = now()
     where id = v_order.id and status = 'awaiting_payment';
    if found then
      perform public.release_order_to_fulfilment(v_order.id);
      order_id := v_order.id;
      amount := v_order.total_amount;
      return next;
    end if;
  end loop;
end;
$function$;