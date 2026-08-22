ALTER FUNCTION public.block_wallet_mutation() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.respond_to_quote(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_quote(uuid, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, text, numeric, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.guard_profile_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_wallet_mutation() FROM PUBLIC, anon, authenticated;