ALTER TABLE public.wallet_transactions
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX wallet_transactions_entity_seq_idx
  ON public.wallet_transactions (entity_id, created_at DESC, seq DESC);

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
   order by created_at desc, seq desc
   limit 1
   for update;
  v_balance := coalesce(v_balance, 0);
  if p_type = 'debit' then
    v_new_balance := v_balance - p_amount;
    if v_new_balance < 0 then
      raise exception 'Insufficient funds: current balance is %, cannot debit %', v_new_balance + p_amount, p_amount;
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

REVOKE ALL ON SEQUENCE public.wallet_transactions_seq_seq FROM PUBLIC;