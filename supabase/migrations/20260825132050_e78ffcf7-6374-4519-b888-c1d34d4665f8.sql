-- 1. Order provenance + middleware idempotency
alter table public.orders
  add column if not exists source text not null default 'manual';
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders
  add constraint orders_source_check check (source in ('manual','shopify','middleware'));
create unique index if not exists orders_middleware_order_id_key
  on public.orders (middleware_order_id) where middleware_order_id is not null;

-- 2. Inbound event store (append-only)
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  tenant_id text,
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null default false,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
grant select on public.integration_events to authenticated;
grant all on public.integration_events to service_role;
alter table public.integration_events enable row level security;
drop policy if exists "Admins read integration events" on public.integration_events;
create policy "Admins read integration events" on public.integration_events
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role));
create index if not exists integration_events_created_at_idx on public.integration_events (created_at desc);

-- 3. Outbound call audit
create table if not exists public.integration_calls (
  id uuid primary key default gen_random_uuid(),
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  endpoint text not null,
  tenant_id text,
  idempotency_key text,
  status_code integer,
  ok boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
grant select on public.integration_calls to authenticated;
grant all on public.integration_calls to service_role;
alter table public.integration_calls enable row level security;
drop policy if exists "Admins read integration calls" on public.integration_calls;
create policy "Admins read integration calls" on public.integration_calls
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::public.app_role));
create index if not exists integration_calls_created_at_idx on public.integration_calls (created_at desc);

-- 4. Shadow order creation from a middleware order.created event.
-- Idempotent on middleware_order_id; pricing/review/payment reuse ingest_order.
create or replace function public.ingest_middleware_order(
  p_tenant_id text,
  p_middleware_order_id text,
  p_external_ref text,
  p_destination_country text,
  p_shipping_address jsonb,
  p_line_items jsonb
) returns public.orders
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_store_id uuid;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN: middleware intake is internal';
  end if;
  if nullif(p_middleware_order_id, '') is null then
    raise exception 'MIDDLEWARE_ORDER_ID_REQUIRED';
  end if;

  select * into v_order from public.orders
   where middleware_order_id = p_middleware_order_id;
  if found then
    return v_order;
  end if;

  select s.id into v_store_id from public.stores s
   where s.middleware_tenant_id = p_tenant_id;
  if v_store_id is null then
    raise exception 'UNKNOWN_TENANT: no workspace for tenant %', p_tenant_id;
  end if;

  v_order := public.ingest_order(
    v_store_id,
    nullif(p_external_ref, ''),
    nullif(p_external_ref, ''),
    p_destination_country,
    coalesce(p_shipping_address, '{}'::jsonb),
    p_line_items
  );

  perform set_config('app.internal_write', 'on', true);
  update public.orders
     set middleware_order_id = p_middleware_order_id,
         source = 'middleware'
   where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;
revoke all on function public.ingest_middleware_order(text, text, text, text, jsonb, jsonb) from public;
grant execute on function public.ingest_middleware_order(text, text, text, text, jsonb, jsonb) to authenticated, service_role;