do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  loop
    execute format('revoke execute on function public.%I(%s) from public', f.proname, f.args);
    execute format('revoke execute on function public.%I(%s) from anon', f.proname, f.args);
  end loop;
end $$;

-- The app calls these as the signed-in user; the functions enforce
-- ownership / admin role internally. Keep the explicit grants.
grant execute on function public.open_dispute(uuid, public.dispute_reason, text, text[]) to authenticated;
grant execute on function public.post_dispute_message(uuid, text) to authenticated;
grant execute on function public.resolve_dispute(uuid, public.dispute_resolution, numeric, text, text) to authenticated;
grant execute on function public.pay_orders_from_wallet(uuid[]) to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;