REVOKE ALL ON FUNCTION public.owns_quote(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_quote_option(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_quote(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_quote_option(uuid, text) TO authenticated, service_role;