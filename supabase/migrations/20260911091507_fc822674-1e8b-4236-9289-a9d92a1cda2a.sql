CREATE OR REPLACE FUNCTION public.bump_sourcing_transactions(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.sourcing_collaborators
  SET paid_transactions = paid_transactions + 1
  WHERE user_id = p_user_id
  RETURNING paid_transactions;
$$;

REVOKE ALL ON FUNCTION public.bump_sourcing_transactions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_sourcing_transactions(uuid) TO service_role;