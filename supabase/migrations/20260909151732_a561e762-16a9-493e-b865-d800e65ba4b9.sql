REVOKE EXECUTE ON FUNCTION public.detect_client_site(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_quote_client_site() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.url_host(text) FROM PUBLIC, anon, authenticated;