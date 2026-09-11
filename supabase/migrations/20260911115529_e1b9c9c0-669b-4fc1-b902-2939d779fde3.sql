create or replace function public.admin_set_fulfilment_model(p_product_id uuid, p_model public.fulfilment_model)
returns public.products
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_product public.products;
  v_stock integer;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  if v_product.fulfilment_model = p_model then
    return v_product;
  end if;

  if p_model = 'per_order' then
    select coalesce((
      select i.quantity from public.inventory_snapshots i
       where i.store_id = v_product.store_id
         and i.sku = v_product.sku
         and i.location = 'Fulfilment center'
       order by i.captured_at desc limit 1
    ), 0) into v_stock;
    if v_stock > 0 then
      raise exception 'STOCK_EXISTS:%', v_stock;
    end if;
  end if;

  perform set_config('app.internal_write', 'on', true);
  update public.products set fulfilment_model = p_model
   where id = p_product_id
  returning * into v_product;
  perform set_config('app.internal_write', 'off', true);

  return v_product;
end;
$$;

revoke all on function public.admin_set_fulfilment_model(uuid, public.fulfilment_model) from public, anon, authenticated;
grant execute on function public.admin_set_fulfilment_model(uuid, public.fulfilment_model) to service_role;