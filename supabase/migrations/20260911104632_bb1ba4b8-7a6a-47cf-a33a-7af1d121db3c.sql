alter table public.stores add column if not exists is_test boolean not null default false;

update public.stores set is_test = true where store_name = 'Workspace — Testes';

create or replace function public.entity_is_test(p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores
     where entity_id = p_entity_id and is_test
  )
$$;

grant execute on function public.entity_is_test(uuid) to authenticated, service_role;

create or replace function public.guard_store_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('app.internal_write', true) = 'on' then
    return new;
  end if;
  if old.middleware_tenant_id is not null
     and new.middleware_tenant_id is distinct from old.middleware_tenant_id then
    raise exception 'middleware_tenant_id is immutable once set';
  end if;
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    if new.middleware_tenant_id is distinct from old.middleware_tenant_id
       or new.integration_mode is distinct from old.integration_mode
       or new.subscription_plan is distinct from old.subscription_plan
       or new.subscription_status is distinct from old.subscription_status
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.pending_plan_change is distinct from old.pending_plan_change
       or new.pending_plan_change_date is distinct from old.pending_plan_change_date
       or new.quotes_used_this_month is distinct from old.quotes_used_this_month
       or new.quotes_period_start is distinct from old.quotes_period_start
       or new.fee_waived is distinct from old.fee_waived
       or new.pricing_tier is distinct from old.pricing_tier
       or new.tier_override is distinct from old.tier_override
       or new.avg_daily_units_30d is distinct from old.avg_daily_units_30d
       or new.provisioning_status is distinct from old.provisioning_status
       or new.provisioning_step is distinct from old.provisioning_step
       or new.provisioning_error is distinct from old.provisioning_error
       or new.status is distinct from old.status
       or new.approved_at is distinct from old.approved_at
       or new.entity_id is distinct from old.entity_id
       or new.created_at is distinct from old.created_at
       or new.is_test is distinct from old.is_test
       or new.default_production_lead_days is distinct from old.default_production_lead_days
       or new.default_transit_lead_days is distinct from old.default_transit_lead_days
       or new.default_safety_margin_days is distinct from old.default_safety_margin_days then
      raise exception 'Protected store fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$function$;

drop function if exists public.apply_wallet_transaction(uuid, text, numeric, text, text, uuid);

create or replace function public.apply_wallet_transaction(
  p_entity_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_reference text default null::text,
  p_created_by uuid default null::uuid,
  p_simulator boolean default false
)
returns wallet_transactions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance numeric;
  v_new_balance numeric;
  v_row public.wallet_transactions%rowtype;
  v_simulated boolean;
begin
  if not public.has_role(auth.uid(), 'admin') and auth.role() <> 'service_role'
     and current_setting('app.internal_write', true) is distinct from 'on' then
    raise exception 'Only admins or the service role can create wallet transactions';
  end if;
  if not exists (select 1 from public.entities where id = p_entity_id) then
    raise exception 'ENTITY_NOT_FOUND';
  end if;

  -- Defense in depth: anything marked as simulator-originated may only move
  -- money inside a workspace explicitly flagged as a test workspace.
  v_simulated := coalesce(p_simulator, false)
    or coalesce(p_reference, '') like 'sim:%'
    or coalesce(p_reference, '') like 'sim-%'
    or current_setting('app.simulator', true) = 'on';
  if v_simulated and not public.entity_is_test(p_entity_id) then
    raise exception 'SIMULATOR_BLOCKED: simulator-originated wallet movements are only allowed on test workspaces';
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
    (p_entity_id, p_type::public.wallet_txn_type, p_amount, v_new_balance, p_description, p_reference, coalesce(p_created_by, auth.uid()))
  returning * into v_row;
  return v_row;
end;
$function$;

grant execute on function public.apply_wallet_transaction(uuid, text, numeric, text, text, uuid, boolean) to authenticated, service_role;