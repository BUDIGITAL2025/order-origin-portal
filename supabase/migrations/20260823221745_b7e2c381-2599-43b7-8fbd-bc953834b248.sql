-- 1) Drop dead legacy billing columns from profiles — billing reads these
-- from entities only (verified: no code, DB function, trigger, or view reads
-- the profiles-level copies).
ALTER TABLE public.profiles
  DROP COLUMN default_payment_method_id,
  DROP COLUMN auto_topup_enabled,
  DROP COLUMN auto_topup_threshold,
  DROP COLUMN auto_topup_amount;

-- 2) guard_store_update: add integration_mode + created_at to the admin-only set
CREATE OR REPLACE FUNCTION public.guard_store_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       or new.created_at is distinct from old.created_at then
      raise exception 'Protected store fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$function$;

-- 3) guard_entity_update: add cancel_notice_sent_at + created_at
CREATE OR REPLACE FUNCTION public.guard_entity_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    if new.max_stores is distinct from old.max_stores
       or new.status is distinct from old.status
       or new.account_id is distinct from old.account_id
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.default_payment_method_id is distinct from old.default_payment_method_id
       or new.cancel_notice_sent_at is distinct from old.cancel_notice_sent_at
       or new.created_at is distinct from old.created_at then
      raise exception 'Protected entity fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$function$;

-- 4) guard_profile_update: add created_at
CREATE OR REPLACE FUNCTION public.guard_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancel_notice_sent_at IS DISTINCT FROM OLD.cancel_notice_sent_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;