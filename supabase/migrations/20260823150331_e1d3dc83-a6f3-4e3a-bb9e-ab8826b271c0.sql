create or replace function public.submit_quote_request(p_product_url text DEFAULT NULL::text, p_product_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_target_monthly_volume integer DEFAULT NULL::integer, p_image_urls text[] DEFAULT NULL::text[], p_supersedes_quote_id uuid DEFAULT NULL::uuid, p_on_behalf_of uuid DEFAULT NULL::uuid, p_target_countries text[] DEFAULT NULL::text[], p_store_id uuid DEFAULT NULL::uuid)
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
  v_entity public.entities%rowtype;
  v_month_start date := date_trunc('month', current_date)::date;
  v_quota integer;
  v_row public.quote_requests%rowtype;
  v_countries text[];
  v_has_subscription_receipt boolean;
begin
  if v_caller is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Quota bookkeeping below writes protected store columns from inside this
  -- audited definer function; allow it through the store guard trigger.
  perform set_config('app.internal_write', 'on', true);

  v_is_admin := public.has_role(v_caller, 'admin');
  v_account_id := coalesce(p_on_behalf_of, v_caller);
  if p_on_behalf_of is not null and not v_is_admin then
    raise exception 'NOT_AUTHORISED: only admins may submit on behalf of a client';
  end if;

  if p_supersedes_quote_id is null then
    if p_product_url is null or p_target_countries is null or array_length(p_target_countries, 1) is null then
      raise exception 'MISSING_FIELDS: product url and at least one target country are required';
    end if;
  end if;

  if p_store_id is not null then
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where s.id = p_store_id
       and (v_is_admin or e.account_id = v_caller);
    if not found then
      raise exception 'NOT_AUTHORISED: store does not belong to you';
    end if;
    if v_is_admin then
      v_account_id := (select e.account_id from public.entities e where e.id = v_store.entity_id);
    end if;
  else
    select s.* into v_store
      from public.stores s
      join public.entities e on e.id = s.entity_id
     where e.account_id = v_account_id
     order by (s.subscription_status in ('active','past_due') or s.fee_waived) desc,
              s.created_at
     limit 1;

    if not found then
      select e.* into v_entity
        from public.entities e
       where e.account_id = v_account_id
       order by e.created_at
       limit 1;
      if not found then
        insert into public.entities (account_id, legal_name)
        values (
          v_account_id,
          coalesce((select p.contact_name from public.profiles p where p.id = v_account_id), 'My company')
        )
        returning * into v_entity;
      end if;

      select exists (
        select 1 from public.documents d
         where d.entity_id = v_entity.id
           and d.document_type = 'subscription'
      ) into v_has_subscription_receipt;

      insert into public.stores (
        entity_id, platform, store_url, store_name, integration_mode, status,
        subscription_plan, subscription_status
      )
      values (
        v_entity.id, 'other', null, 'My workspace', 'manual', 'draft',
        'basic', case when v_has_subscription_receipt then 'active'::public.subscription_status else 'none'::public.subscription_status end
      )
      returning * into v_store;
    end if;
  end if;

  if p_supersedes_quote_id is null then
    if not v_is_admin then
      if not (v_store.subscription_status in ('active','past_due') or v_store.fee_waived) then
        raise exception 'SUBSCRIPTION_REQUIRED: an active subscription is needed to request quotes';
      end if;
    end if;

    if v_store.quotes_period_start is distinct from v_month_start then
      update public.stores
         set quotes_period_start = v_month_start, quotes_used_this_month = 0
       where id = v_store.id;
      v_store.quotes_used_this_month := 0;
    end if;
    v_quota := case when v_store.subscription_plan = 'unlimited' then null else 5 end;
    if not v_is_admin and v_quota is not null and v_store.quotes_used_this_month >= v_quota then
      raise exception 'QUOTE_LIMIT_REACHED: monthly quote quota used up for this store';
    end if;
  end if;

  if p_supersedes_quote_id is not null then
    insert into public.quote_requests
      (store_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, supersedes_quote_id, target_countries)
    select v_store.id, q.product_url, q.product_name, q.notes, q.target_monthly_volume, q.image_urls, 'submitted', q.id, q.target_countries
      from public.quote_requests q
     where q.id = p_supersedes_quote_id
    returning * into v_row;
    if not found then
      raise exception 'QUOTE_NOT_FOUND';
    end if;
  else
    v_countries := array(select distinct c from unnest(p_target_countries) c order by c);
    insert into public.quote_requests
      (store_id, product_url, product_name, notes, target_monthly_volume, image_urls, status, target_countries)
    values
      (v_store.id, p_product_url, p_product_name, p_notes, p_target_monthly_volume, coalesce(p_image_urls, '{}'), 'submitted', v_countries)
    returning * into v_row;
    update public.stores set quotes_used_this_month = quotes_used_this_month + 1 where id = v_store.id;
  end if;

  return v_row;
end;
$function$;