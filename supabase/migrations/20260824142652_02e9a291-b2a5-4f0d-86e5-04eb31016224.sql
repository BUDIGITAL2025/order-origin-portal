ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_source jsonb;

CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancel_notice_sent_at IS DISTINCT FROM OLD.cancel_notice_sent_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.signup_source IS DISTINCT FROM OLD.signup_source THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;