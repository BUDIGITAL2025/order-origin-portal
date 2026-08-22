ALTER TABLE public.profiles
  ADD COLUMN pending_plan_change public.subscription_plan,
  ADD COLUMN pending_plan_change_date date,
  ADD COLUMN cancel_notice_sent_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.guard_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.middleware_tenant_id IS NOT NULL
     AND NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id THEN
    RAISE EXCEPTION 'middleware_tenant_id is immutable once set';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.pricing_tier IS DISTINCT FROM OLD.pricing_tier
       OR NEW.tier_override IS DISTINCT FROM OLD.tier_override
       OR NEW.avg_daily_units_30d IS DISTINCT FROM OLD.avg_daily_units_30d
       OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
       OR NEW.quotes_used_this_month IS DISTINCT FROM OLD.quotes_used_this_month
       OR NEW.quotes_period_start IS DISTINCT FROM OLD.quotes_period_start
       OR NEW.fee_waived IS DISTINCT FROM OLD.fee_waived
       OR NEW.integration_mode IS DISTINCT FROM OLD.integration_mode
       OR NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id
       OR NEW.provisioning_status IS DISTINCT FROM OLD.provisioning_status
       OR NEW.provisioning_step IS DISTINCT FROM OLD.provisioning_step
       OR NEW.provisioning_error IS DISTINCT FROM OLD.provisioning_error
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.pending_plan_change IS DISTINCT FROM OLD.pending_plan_change
       OR NEW.pending_plan_change_date IS DISTINCT FROM OLD.pending_plan_change_date
       OR NEW.cancel_notice_sent_at IS DISTINCT FROM OLD.cancel_notice_sent_at THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_awaiting_payment_orders(p_client_id uuid)
 RETURNS TABLE(order_id uuid, amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
  v_order record;
BEGIN
  -- Same gate as apply_wallet_transaction: admins and the service role only.
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Only admins or the service role can release orders';
  END IF;

  -- TODO(orders): the orders table does not exist yet. When it lands, the
  -- loop below settles orders in 'awaiting_payment' state oldest-first
  -- against the wallet balance, debiting through apply_wallet_transaction
  -- with the order id as p_reference (so replays are no-ops). It stops as
  -- soon as the balance no longer covers the next order and leaves the
  -- rest waiting. Until then this function is a safe no-op.
  IF to_regclass('public.orders') IS NULL THEN
    RETURN;
  END IF;

  -- Serialize with concurrent top-ups for this client.
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id::text));

  SELECT wt.balance_after INTO v_balance
    FROM public.wallet_transactions wt
   WHERE wt.client_id = p_client_id
   ORDER BY wt.created_at DESC, wt.id DESC
   LIMIT 1;
  v_balance := COALESCE(v_balance, 0);

  FOR v_order IN
    SELECT o.id, o.total_usd
      FROM public.orders o
     WHERE o.client_id = p_client_id AND o.status = 'awaiting_payment'
     ORDER BY o.created_at ASC, o.id ASC
  LOOP
    EXIT WHEN v_balance < v_order.total_usd;
    PERFORM public.apply_wallet_transaction(
      p_client_id, 'debit', v_order.total_usd,
      'Order payment', v_order.id::text
    );
    UPDATE public.orders SET status = 'paid' WHERE id = v_order.id;
    v_balance := v_balance - v_order.total_usd;
    order_id := v_order.id;
    amount := v_order.total_usd;
    RETURN NEXT;
  END LOOP;
END;
$function$;