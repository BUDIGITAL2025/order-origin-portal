-- ============ Delivery mode on the request ============
do $$ begin
  create type public.delivery_mode as enum ('exw','warehouse','fulfilment');
exception when duplicate_object then null; end $$;

alter table public.quote_requests
  add column if not exists delivery_mode public.delivery_mode not null default 'warehouse',
  add column if not exists delivery_address text,
  add column if not exists revision_number integer not null default 1;

grant select (delivery_mode, delivery_address, revision_number)
  on public.quote_requests to authenticated;

-- ============ Per-variant acceptance quantity ============
alter table public.quote_lines
  add column if not exists accepted_quantity integer;

do $$ begin
  alter table public.quote_lines
    add constraint quote_lines_accepted_quantity_positive
    check (accepted_quantity is null or accepted_quantity > 0);
exception when duplicate_object then null; end $$;

-- ============ Client-safe line reader gains sku qty ============
drop function if exists public.get_client_quote_lines(uuid);
create function public.get_client_quote_lines(p_quote_request_id uuid)
returns table(
  id uuid, quote_request_id uuid, variant_label text, country_code text, sku text,
  unit_price numeric, moq integer, lead_time_days integer,
  accepted_quantity integer, status public.quote_line_status,
  responded_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select ql.id, ql.quote_request_id, ql.variant_label, ql.country_code, ql.sku,
         ql.unit_price, ql.moq, ql.lead_time_days, ql.accepted_quantity, ql.status,
         ql.responded_at, ql.created_at
  from public.quote_lines ql
  join public.quote_requests qr on qr.id = ql.quote_request_id
  join public.stores s on s.id = qr.store_id
  join public.entities e on e.id = s.entity_id
  where ql.quote_request_id = p_quote_request_id
    and e.account_id = auth.uid()
  order by ql.created_at;
$$;
revoke all on function public.get_client_quote_lines(uuid) from public, anon;
grant execute on function public.get_client_quote_lines(uuid) to authenticated, service_role;

-- ============ Accept only the selected variants, with quantities ============
create or replace function public.accept_quote_selection(
  p_option_id uuid,
  p_product_name text,
  p_selections jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_option public.quote_options%rowtype;
  v_sel jsonb;
  v_line public.quote_lines%rowtype;
  v_qty integer;
  v_min integer;
  v_decisions jsonb := '[]'::jsonb;
  v_accepted integer;
begin
  select * into v_option from public.quote_options where id = p_option_id;
  if not found or not public.owns_quote(v_option.quote_request_id) then
    raise exception 'OPTION_NOT_FOUND';
  end if;
  if not v_option.published or v_option.archived_at is not null then
    raise exception 'OPTION_NOT_AVAILABLE';
  end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array'
     or jsonb_array_length(p_selections) = 0 then
    raise exception 'NO_DECISIONS';
  end if;

  -- Validate every selection before anything is written.
  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_line from public.quote_lines
     where id = (v_sel->>'line_id')::uuid
       and quote_request_id = v_option.quote_request_id
       and option_id = p_option_id;
    if not found then
      raise exception 'LINE_NOT_FOUND';
    end if;
    if v_line.status <> 'pending' then
      continue;
    end if;
    v_qty := coalesce((v_sel->>'quantity')::integer, v_line.moq, 1);
    v_min := greatest(coalesce(v_line.moq, 1), 1);
    if v_qty < v_min then
      raise exception 'QTY_BELOW_MOQ:%:%', v_line.variant_label, v_min;
    end if;
    v_decisions := v_decisions || jsonb_build_object('line_id', v_line.id, 'accept', true);
  end loop;

  if jsonb_array_length(v_decisions) = 0 then
    raise exception 'NO_DECISIONS';
  end if;

  -- Only the selected lines are decided; the rest stay pending and available
  -- on this quote until it expires.
  v_accepted := public.respond_to_quote_lines(
    v_option.quote_request_id, p_product_name, v_decisions
  );

  perform set_config('app.internal_write', 'on', true);
  for v_sel in select * from jsonb_array_elements(p_selections) loop
    update public.quote_lines
       set accepted_quantity = greatest(
             coalesce((v_sel->>'quantity')::integer, moq, 1), coalesce(moq, 1))
     where id = (v_sel->>'line_id')::uuid
       and status = 'accepted';
  end loop;

  update public.quote_options set accepted_at = coalesce(accepted_at, now())
   where id = p_option_id;
  update public.quote_options set archived_at = now()
   where quote_request_id = v_option.quote_request_id
     and id <> p_option_id
     and archived_at is null;

  insert into public.quote_messages (quote_request_id, author_role, kind, system_code, body)
  values (v_option.quote_request_id, 'system', 'system', 'option_accepted',
          'Option ' || v_option.letter || ' — ' || v_accepted || ' variant(s) accepted');

  return v_accepted;
end;
$$;
revoke all on function public.accept_quote_selection(uuid, text, jsonb) from public, anon;
grant execute on function public.accept_quote_selection(uuid, text, jsonb) to authenticated, service_role;

-- ============ New structured client request ============
do $$ begin
  alter type public.quote_intent_type add value if not exists 'change_quantity_or_delivery';
exception when others then null; end $$;
