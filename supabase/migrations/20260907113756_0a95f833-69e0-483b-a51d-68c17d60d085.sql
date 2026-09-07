revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.decrement_stock_in_on_ship() from public, anon, authenticated;
revoke all on function public.stock_in_available(uuid, text) from public, anon, authenticated;
revoke all on function public.create_client_product(uuid, text, jsonb, text[]) from anon;
revoke all on function public.declare_inbound_shipment(uuid, boolean, jsonb) from anon;
revoke all on function public.set_inbound_tracking(uuid, text, text) from anon;
revoke all on function public.admin_confirm_inbound_receipt(uuid, jsonb) from anon, authenticated;
revoke all on function public.admin_refuse_inbound(uuid, text) from anon, authenticated;