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
       or new.entity_id is distinct from old.entity_id then
      raise exception 'Protected store fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$function$;