DROP POLICY IF EXISTS "Users create their own pending profile" ON public.profiles;
CREATE POLICY "Users create their own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);