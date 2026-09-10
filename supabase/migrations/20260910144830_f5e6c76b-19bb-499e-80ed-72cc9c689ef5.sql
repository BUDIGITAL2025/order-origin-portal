CREATE OR REPLACE FUNCTION public.sync_sourcing_collaborator_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active THEN
    DELETE FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'client';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, 'sourcing')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'sourcing';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_sourcing_collaborator_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_sourcing_collaborator_role() TO service_role;

DROP TRIGGER IF EXISTS sync_sourcing_collaborator_role_trigger ON public.sourcing_collaborators;
CREATE TRIGGER sync_sourcing_collaborator_role_trigger
AFTER INSERT OR UPDATE OF user_id, active ON public.sourcing_collaborators
FOR EACH ROW
EXECUTE FUNCTION public.sync_sourcing_collaborator_role();

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'sourcing'::public.app_role
FROM public.sourcing_collaborators
WHERE active
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles ur
USING public.sourcing_collaborators sc
WHERE ur.user_id = sc.user_id
  AND sc.active
  AND ur.role = 'client';