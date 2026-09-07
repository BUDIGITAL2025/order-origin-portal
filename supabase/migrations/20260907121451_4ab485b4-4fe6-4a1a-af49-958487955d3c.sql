alter table public.entities
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_exp_month smallint,
  add column if not exists card_exp_year smallint;

create or replace function public.guard_entity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    if new.max_stores is distinct from old.max_stores
       or new.status is distinct from old.status
       or new.account_id is distinct from old.account_id
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.default_payment_method_id is distinct from old.default_payment_method_id
       or new.card_brand is distinct from old.card_brand
       or new.card_last4 is distinct from old.card_last4
       or new.card_exp_month is distinct from old.card_exp_month
       or new.card_exp_year is distinct from old.card_exp_year then
      raise exception 'Protected entity fields can only be changed by an admin';
    end if;
  end if;
  return new;
end;
$$;