-- 1. Draft store state: a store that exists for subscription/quota purposes
-- before any Shopify URL is connected.
ALTER TYPE public.profile_status ADD VALUE IF NOT EXISTS 'draft';

-- Draft stores have no URL until the client connects one.
ALTER TABLE public.stores ALTER COLUMN store_url DROP NOT NULL;

-- 2. Client connects a draft store: fills the URL, provisions locally and
-- activates. Ownership is verified via the entity chain; the URL pattern is
-- enforced here too (not just in the UI).
CREATE OR REPLACE FUNCTION public.connect_draft_store(
  p_store_id uuid,
  p_store_url text,
  p_store_name text DEFAULT NULL::text
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_store public.stores%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  select s.* into v_store
    from public.stores s
    join public.entities e on e.id = s.entity_id
   where s.id = p_store_id and e.account_id = v_caller;
  if not found then
    raise exception 'STORE_NOT_FOUND';
  end if;
  if v_store.status <> 'draft' then
    raise exception 'STORE_NOT_DRAFT: only a draft store can be connected';
  end if;
  if p_store_url is null
     or lower(trim(p_store_url)) !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then
    raise exception 'INVALID_STORE_URL: must be a valid *.myshopify.com domain';
  end if;
  perform set_config('app.internal_write', 'on', true);
  update public.stores set
    store_url = lower(trim(p_store_url)),
    store_name = coalesce(nullif(trim(p_store_name), ''), store_name),
    platform = 'shopify',
    middleware_tenant_id = coalesce(middleware_tenant_id, 'rs_' || replace(gen_random_uuid()::text, '-', '')),
    status = 'active',
    approved_at = coalesce(approved_at, now()),
    provisioning_status = 'complete',
    provisioning_step = 'connected',
    provisioning_error = null
  where id = v_store.id
  returning * into v_store;
  return v_store;
end;
$function$;

-- 3. Quote submission requires an active subscription (or a fee waiver) —
-- the paywall. Admins submitting on behalf of a client bypass it.
CREATE OR REPLACE FUNCTION public.submit_quote_request(p_product_url text DEFAULT NULL::text, p_product_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_target_monthly_volume integer DEFAULT NULL::integer, p_image_urls text[] DEFAULT NULL::text[], p_supersedes_quote_id uuid DEFAULT NULL::uuid, p_on_behalf_of uuid DEFAULT NULL::uuid, p_target_countries text[] DEFAULT NULL::text[], p_store_id uuid DEFAULT NULL::uuid)
 RETURNS quote_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_account_id uuid;
  v_store public.stores%rowtype;
  v_original public.quote_requests%rowtype;
  v_month_start date := date_trunc('month', current_date)::date;
  v_quota integer;
  v_row public.quote_requests%rowtype;
  v_countries text[];
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  v_is_admin := public.has_role(v_caller, 'admin');
  if p_on_behalf_of is not null then
    if not v_is_admin then
      raise exception 'Only admins can submit quotes on behalf of a client';
    end if;
    v_account_id := p_on_behalf_of;
  else
    v_account_id := v_caller;
  end if;
  if p_store_id is not null then
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where s.id = p_store_id and e.account_id = v_account_id;
    if not found then
      raise exception 'STORE_NOT_FOUND';
    end if;
  end if;
  select array_agg(distinct upper(trim(c))) into v_countries
    from unnest(coalesce(p_target_countries, array[]::text[])) c
   where length(trim(c)) = 2;
  if p_supersedes_quote_id is not null then
    select * into v_original from public.quote_requests where id = p_supersedes_quote_id;
    if not found then
      raise exception 'Original quote not found';
    end if;
    if not exists (
      select 1 from public.stores s
      join public.entities e on e.id = s.entity_id
      where s.id = v_original.store_id and e.account_id = v_account_id
    ) then
      raise exception 'Original quote does not belong to this client';
    end if;
    if v_original.status not in ('closed', 'expired') then
      raise exception 'Only closed or expired quotes can be requoted';
    end if;
    insert into public.quote_requests
      (store_id, product_url, product_name, notes, status, supersedes_quote_id, target_countries)
    values
      (v_original.store_id, v_original.product_url, v_original.product_name, v_original.notes,
       'sourcing', p_supersedes_quote_id, v_original.target_countries)
    returning * into v_row;
    return v_row;
  end if;
  if v_store.id is null then
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where e.account_id = v_account_id
     order by s.created_at
     limit 1;
    if not found then
      raise exception 'NO_STORE: no store registered for this account';
    end if;
  end if;
  if v_countries is null or cardinality(v_countries) = 0 then
    raise exception 'TARGET_COUNTRIES_REQUIRED';
  end if;
  if not (v_is_admin and p_on_behalf_of is not null) then
    -- Paywall: submitting a quote needs an active subscription (draft stores
    -- included) or a fee waiver. Everything up to submission stays open.
    if v_store.subscription_status not in ('active', 'past_due') and not v_store.fee_waived then
      raise exception 'SUBSCRIPTION_REQUIRED: an active subscription is needed to submit quote requests';
    end if;
    perform set_config('app.internal_write', 'on', true);
    if v_store.quotes_period_start < v_month_start then
      update public.stores
         set quotes_used_this_month = 0, quotes_period_start = v_month_start
       where id = v_store.id
      returning quotes_used_this_month, quotes_period_start
         into v_store.quotes_used_this_month, v_store.quotes_period_start;
    end if;
    v_quota := case v_store.subscription_plan when 'basic' then 5 else null end;
    if v_quota is not null and v_store.quotes_used_this_month >= v_quota then
      raise exception 'QUOTE_LIMIT_REACHED: Monthly quote limit of % reached on plan % for this store. Upgrade to Unlimited for uncapped quote requests.', v_quota, v_store.subscription_plan;
    end if;
    update public.stores set quotes_used_this_month = quotes_used_this_month + 1 where id = v_store.id;
  end if;
  if p_product_url is null or length(trim(p_product_url)) = 0 then
    raise exception 'product_url is required';
  end if;
  insert into public.quote_requests
    (store_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, target_countries)
  values
    (v_store.id, p_product_url, p_product_name, p_notes, p_target_monthly_volume, p_image_urls, 'submitted', v_countries)
  returning * into v_row;
  return v_row;
end;
$function$;

-- 4. Accepting a quote requires a connected store — acceptance creates
-- catalogue products that must live somewhere. Rejections stay open.
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
  -- Accepting creates products on the quote's store — it must be connected.
  if exists (select 1 from jsonb_array_elements(p_decisions) d where (d->>'accept')::boolean)
     and not exists (
       select 1 from public.stores s
       where s.id = v_request.store_id and s.status <> 'draft' and s.store_url is not null
     ) then
    raise exception 'STORE_NOT_CONNECTED: connect your Shopify store before accepting a quote';
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
      select p.id into v_product_id from public.products p
       where p.store_id = v_request.store_id and p.sku = v_line.sku;
      if v_product_id is null then
        insert into public.products (
          store_id, quote_line_id, sku, product_name, variant_label,
          product_type, moq, status, push_status
        ) values (
          v_request.store_id, v_line.id, v_line.sku, trim(p_product_name), v_line.variant_label,
          'simple', v_line.moq, 'active', 'pending'
        ) returning id into v_product_id;
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