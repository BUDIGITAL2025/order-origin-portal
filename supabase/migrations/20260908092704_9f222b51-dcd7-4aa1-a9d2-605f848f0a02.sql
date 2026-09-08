alter table public.quote_requests add column if not exists archived_at timestamptz;
alter table public.products add column if not exists archived_at timestamptz;
alter table public.orders add column if not exists archived_at timestamptz;
alter table public.stock_purchases add column if not exists archived_at timestamptz;
alter table public.inbound_shipments add column if not exists archived_at timestamptz;
alter table public.entities add column if not exists archived_at timestamptz;
alter table public.profiles add column if not exists archived_at timestamptz;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

grant select on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;

alter table public.admin_audit_log enable row level security;

create policy "Admins can read the audit log"
on public.admin_audit_log
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

CREATE OR REPLACE FUNCTION public.respond_to_quote_lines(p_quote_id uuid, p_product_name text, p_decisions jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.quote_requests%rowtype;
  v_decision jsonb;
  v_line public.quote_lines%rowtype;
  v_product_id uuid;
  v_accepted integer := 0;
  v_pending integer;
  v_images text[];
begin
  select * into v_request from public.quote_requests where id = p_quote_id for update;
  if not found or not exists (
    select 1 from public.stores s
    join public.entities e on e.id = s.entity_id
    where s.id = v_request.store_id and e.account_id = auth.uid()
  ) then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_request.status <> 'quoted' then
    raise exception 'QUOTE_NOT_OPEN';
  end if;
  if v_request.quote_valid_until is not null and v_request.quote_valid_until < current_date then
    update public.quote_requests set status = 'expired' where id = p_quote_id;
    raise exception 'QUOTE_EXPIRED';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'NO_DECISIONS';
  end if;
  if exists (select 1 from jsonb_array_elements(p_decisions) d where (d->>'accept')::boolean)
     and nullif(trim(coalesce(p_product_name, '')), '') is null then
    raise exception 'PRODUCT_NAME_REQUIRED';
  end if;
  perform set_config('app.internal_write', 'on', true);
  for v_decision in select * from jsonb_array_elements(p_decisions) loop
    select * into v_line from public.quote_lines
     where id = (v_decision->>'line_id')::uuid and quote_request_id = p_quote_id;
    if not found then
      raise exception 'LINE_NOT_FOUND';
    end if;
    if v_line.status <> 'pending' then
      continue;
    end if;
    update public.quote_lines set
      status = case when (v_decision->>'accept')::boolean
                    then 'accepted'::public.quote_line_status
                    else 'rejected'::public.quote_line_status end,
      responded_at = now()
    where id = v_line.id;
    if (v_decision->>'accept')::boolean then
      v_accepted := v_accepted + 1;
      -- Photos travel with the product: sourcing photos first, then the
      -- client's own reference images, capped at 5.
      v_images := (
        select coalesce(array_agg(u), '{}'::text[]) from (
          select distinct on (u) u, ord from unnest(
            coalesce(v_line.sourcing_image_urls, '{}'::text[]) || coalesce(v_request.image_urls, '{}'::text[])
          ) with ordinality as t(u, ord)
          order by u, ord
        ) d
      );
      v_images := (select coalesce(array_agg(u order by ord), '{}'::text[])
                   from (select u, ord from unnest(
                          coalesce(v_line.sourcing_image_urls, '{}'::text[]) || coalesce(v_request.image_urls, '{}'::text[])
                        ) with ordinality as t(u, ord)
                        where u = any(v_images)
                        limit 5) x);
      select p.id into v_product_id from public.products p
       where p.store_id = v_request.store_id and p.sku = v_line.sku;
      if v_product_id is null then
        insert into public.products (
          store_id, quote_line_id, sku, product_name, variant_label,
          product_type, moq, status, push_status, image_urls
        ) values (
          v_request.store_id, v_line.id, v_line.sku, trim(p_product_name), v_line.variant_label,
          'simple', v_line.moq, 'active', 'pending', v_images
        ) returning id into v_product_id;
      else
        update public.products
           set image_urls = case when coalesce(array_length(image_urls, 1), 0) = 0
                                 then v_images else image_urls end
         where id = v_product_id;
      end if;
      insert into public.product_country_prices (product_id, country_code, unit_price, lead_time_days)
      values (v_product_id, v_line.country_code, v_line.unit_price, v_line.lead_time_days)
      on conflict (product_id, country_code) do nothing;
    end if;
  end loop;
  select count(*) into v_pending from public.quote_lines
   where quote_request_id = p_quote_id and status = 'pending';
  if v_pending = 0 then
    update public.quote_requests set status = 'closed' where id = p_quote_id;
  end if;
  return v_accepted;
end;
$function$;