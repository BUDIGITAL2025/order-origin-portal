-- ============ Batch payment + disputes ============

create type public.dispute_reason as enum ('not_delivered', 'damaged', 'wrong_product');
create type public.dispute_status as enum ('open', 'investigating', 'approved', 'rejected', 'closed');
create type public.dispute_resolution as enum ('wallet_credit', 'reshipped', 'rejected');
create type public.dispute_author_role as enum ('client', 'admin');

-- Delivery timestamps drive the dispute eligibility windows.
alter table public.orders add column shipped_at timestamptz;
alter table public.orders add column delivered_at timestamptz;

create or replace function public.stamp_order_fulfillment_dates()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' and new.shipped_at is null then
    new.shipped_at := now();
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$;

create trigger orders_stamp_fulfillment_dates
before update on public.orders
for each row execute function public.stamp_order_fulfillment_dates();

-- ============ disputes ============

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  store_id uuid not null references public.stores(id),
  opened_by uuid not null references public.profiles(id),
  reason public.dispute_reason not null,
  description text not null,
  evidence_urls text[] not null default '{}',
  status public.dispute_status not null default 'open',
  resolution public.dispute_resolution,
  credit_amount numeric,
  admin_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open dispute per order at a time.
create unique index disputes_one_open_per_order
  on public.disputes (order_id)
  where status in ('open', 'investigating');

grant select on public.disputes to authenticated;
grant all on public.disputes to service_role;

alter table public.disputes enable row level security;

create policy "Clients read own disputes"
  on public.disputes for select to authenticated
  using (exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = disputes.store_id and e.account_id = auth.uid()
  ));

create policy "Admins read all disputes"
  on public.disputes for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============ dispute_messages (append-only) ============

create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  author_role public.dispute_author_role not null,
  body text not null,
  created_at timestamptz not null default now()
);

grant select on public.dispute_messages to authenticated;
grant all on public.dispute_messages to service_role;

alter table public.dispute_messages enable row level security;

create policy "Participants read dispute messages"
  on public.dispute_messages for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or exists (
      select 1 from public.disputes d
      join public.stores s on s.id = d.store_id
      join public.entities e on e.id = s.entity_id
      where d.id = dispute_messages.dispute_id and e.account_id = auth.uid()
    )
  );

create or replace function public.block_dispute_message_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'dispute_messages is append-only: updates and deletes are not allowed';
end;
$$;

create trigger dispute_messages_no_update
before update on public.dispute_messages
for each row execute function public.block_dispute_message_mutation();

create trigger dispute_messages_no_delete
before delete on public.dispute_messages
for each row execute function public.block_dispute_message_mutation();

-- ============ order_batch_payments ============
-- Persists the exact order selection behind a card checkout so the webhook
-- settles those orders (not oldest-first) when the payment confirms.

create table public.order_batch_payments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  order_ids uuid[] not null,
  amount numeric not null,
  stripe_session_id text,
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'settled', 'expired')),
  settled_count integer,
  leftover_credited numeric,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create unique index order_batch_payments_session_key
  on public.order_batch_payments (stripe_session_id)
  where stripe_session_id is not null;

grant select on public.order_batch_payments to authenticated;
grant all on public.order_batch_payments to service_role;

alter table public.order_batch_payments enable row level security;

create policy "Clients read own batch payments"
  on public.order_batch_payments for select to authenticated
  using (exists (
    select 1 from public.entities e
    where e.id = order_batch_payments.entity_id and e.account_id = auth.uid()
  ));

-- ============ dispute evidence storage policies (bucket created separately) ============

create policy "Clients upload dispute evidence to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dispute-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Clients read own dispute evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'dispute-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Admins read all dispute evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'dispute-evidence' and public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============ open_dispute: eligibility enforced here, not in the form ============

create or replace function public.open_dispute(
  p_order_id uuid,
  p_reason public.dispute_reason,
  p_description text,
  p_evidence_urls text[] default null
)
returns public.disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_lead integer;
  v_estimated date;
  v_row public.disputes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found or not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = v_order.store_id and e.account_id = auth.uid()
  ) then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Only orders that reached paid can be disputed.
  if v_order.status not in ('paid', 'processing', 'shipped', 'delivered') then
    raise exception 'ORDER_NOT_PAID: only paid orders can be disputed';
  end if;

  if nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if p_reason = 'not_delivered' then
    if v_order.status = 'delivered' then
      raise exception 'ORDER_DELIVERED: this order is marked as delivered';
    end if;
    -- Estimated delivery = payment date + longest quoted lead time to the
    -- destination country (14 days when no lead time is on file).
    select max(coalesce(pcp.lead_time_days, 14)) into v_lead
      from public.order_items oi
      left join public.product_country_prices pcp
        on pcp.product_id = oi.product_id
       and pcp.country_code = v_order.destination_country
     where oi.order_id = v_order.id;
    v_estimated := (coalesce(v_order.paid_at, v_order.created_at)
      + make_interval(days => coalesce(v_lead, 14)))::date;
    if current_date > v_estimated + 30 then
      raise exception 'DISPUTE_WINDOW_CLOSED: not-delivered disputes open within 30 days of the estimated delivery date (%)', v_estimated;
    end if;
  else
    -- damaged / wrong_product
    if v_order.status <> 'delivered' or v_order.delivered_at is null then
      raise exception 'ORDER_NOT_DELIVERED: damage and wrong-product disputes require a delivered order';
    end if;
    if current_date > v_order.delivered_at::date + 7 then
      raise exception 'DISPUTE_WINDOW_CLOSED: disputes on delivered orders open within 7 days of delivery (%)', v_order.delivered_at::date;
    end if;
    if p_evidence_urls is null or cardinality(p_evidence_urls) = 0 then
      raise exception 'EVIDENCE_REQUIRED: attach at least one photo';
    end if;
  end if;

  insert into public.disputes (order_id, store_id, opened_by, reason, description, evidence_urls)
  values (v_order.id, v_order.store_id, auth.uid(), p_reason, trim(p_description), coalesce(p_evidence_urls, '{}'))
  returning * into v_row;
  return v_row;
exception
  when unique_violation then
    raise exception 'DISPUTE_ALREADY_OPEN: this order already has an open dispute';
end;
$$;

-- ============ post_dispute_message: participants only, while unresolved ============

create or replace function public.post_dispute_message(p_dispute_id uuid, p_body text)
returns public.dispute_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute public.disputes%rowtype;
  v_is_admin boolean;
  v_row public.dispute_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_dispute from public.disputes where id = p_dispute_id;
  if not found then
    raise exception 'DISPUTE_NOT_FOUND';
  end if;

  v_is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);
  if not v_is_admin and not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = v_dispute.store_id and e.account_id = auth.uid()
  ) then
    raise exception 'DISPUTE_NOT_FOUND';
  end if;

  if v_dispute.status not in ('open', 'investigating') then
    raise exception 'DISPUTE_CLOSED: this dispute is already resolved';
  end if;

  if nullif(trim(coalesce(p_body, '')), '') is null then
    raise exception 'MESSAGE_REQUIRED';
  end if;

  insert into public.dispute_messages (dispute_id, author_id, author_role, body)
  values (
    p_dispute_id,
    auth.uid(),
    case when v_is_admin then 'admin'::public.dispute_author_role else 'client'::public.dispute_author_role end,
    trim(p_body)
  )
  returning * into v_row;

  -- An admin reply moves the dispute into investigating.
  if v_is_admin and v_dispute.status = 'open' then
    update public.disputes set status = 'investigating' where id = p_dispute_id;
  end if;

  return v_row;
end;
$$;

-- ============ resolve_dispute: admin only ============

create or replace function public.resolve_dispute(
  p_dispute_id uuid,
  p_resolution public.dispute_resolution,
  p_credit_amount numeric default null,
  p_admin_notes text default null,
  p_client_message text default null
)
returns public.disputes
language plpgsql
security definer
set search_path = public
as $$
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
    -- Reference = dispute id: the wallet ledger's reference uniqueness rule
    -- makes a second credit for the same dispute impossible.
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
    -- rejected: the client must see why.
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
    admin_notes = nullif(p_admin_notes, ''),
    resolved_at = now()
  where id = p_dispute_id
  returning * into v_dispute;

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
$$;

-- ============ pay_orders_from_wallet: batch settle from the entity wallet ============

create or replace function public.pay_orders_from_wallet(p_order_ids uuid[])
returns table(order_id uuid, amount numeric)
language plpgsql
security definer
set search_path = public
as $$
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

  -- Only the caller's own, still-payable orders participate.
  select count(distinct s.entity_id), min(s.entity_id)
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
$$;