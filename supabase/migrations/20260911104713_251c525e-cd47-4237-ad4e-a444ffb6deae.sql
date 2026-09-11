revoke execute on function public.entity_is_test(uuid) from authenticated, anon, public;
grant execute on function public.entity_is_test(uuid) to service_role;