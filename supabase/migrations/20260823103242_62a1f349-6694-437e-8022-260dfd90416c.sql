-- Hard lockdown: no SECURITY DEFINER function is callable anonymously.
-- Every one of these already rejects unauthenticated calls internally;
-- this removes the grant so the API refuses them outright.
revoke execute on function public.admin_resolve_order_item(uuid, uuid) from anon;
revoke execute on function public.apply_wallet_transaction(uuid, text, numeric, text, text) from anon;
revoke execute on function public.block_last_component_delete() from anon;
revoke execute on function public.create_bundle(uuid, text, jsonb) from anon;
revoke execute on function public.flag_bundles_on_component_discontinued() from anon;
revoke execute on function public.guard_product_update() from anon;
revoke execute on function public.ingest_order(uuid, text, text, text, jsonb, jsonb) from anon;
revoke execute on function public.open_dispute(uuid, public.dispute_reason, text, text[]) from anon;
revoke execute on function public.pay_orders_from_wallet(uuid[]) from anon;
revoke execute on function public.post_dispute_message(uuid, text) from anon;
revoke execute on function public.release_awaiting_payment_orders(uuid) from anon;
revoke execute on function public.resolve_dispute(uuid, public.dispute_resolution, numeric, text, text) from anon;
revoke execute on function public.submit_quote_request(text, text, text, integer, text[], uuid, uuid, text[], uuid) from anon;
revoke execute on function public.validate_bundle_component() from anon;
revoke execute on function public.has_role(uuid, public.app_role) from anon;

-- Trigger-only helpers are never called over the API — drop the signed-in grant too.
revoke execute on function public.block_last_component_delete() from authenticated;
revoke execute on function public.flag_bundles_on_component_discontinued() from authenticated;
revoke execute on function public.guard_product_update() from authenticated;
revoke execute on function public.validate_bundle_component() from authenticated;