revoke execute on function public.ingest_order(uuid, text, text, text, jsonb, jsonb) from authenticated;
revoke execute on function public.release_awaiting_payment_orders(uuid) from authenticated;