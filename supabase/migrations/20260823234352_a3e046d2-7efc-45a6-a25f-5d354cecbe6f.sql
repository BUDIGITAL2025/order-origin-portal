-- The new 6-arg overload was created with default EXECUTE grants (PUBLIC).
-- Lock it down to match the original function: owner + service_role only.
revoke execute on function public.apply_wallet_transaction(uuid, text, numeric, text, text, uuid) from public, anon, authenticated;

-- Drop the superseded 5-arg overload so there is a single ledger entrypoint.
-- Existing 5-arg callers keep working: p_created_by defaults to null.
drop function public.apply_wallet_transaction(uuid, text, numeric, text, text);