-- ===== Enums =====
CREATE TYPE public.app_role AS ENUM ('admin', 'client');
CREATE TYPE public.markup_tier AS ENUM ('standard', 'volume', 'partner');
CREATE TYPE public.profile_status AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE public.provisioning_status AS ENUM ('not_started', 'in_progress', 'complete', 'failed');
CREATE TYPE public.quote_status AS ENUM ('submitted', 'sourcing', 'quoted', 'accepted', 'rejected', 'expired');
CREATE TYPE public.wallet_txn_type AS ENUM ('credit', 'debit', 'adjustment');

-- ===== user_roles =====
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can read their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- Users may self-assign only the client role at signup; admin rows are written by the service role.
CREATE POLICY "Users can self-assign the client role" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND role = 'client');

-- ===== profiles =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  contact_name text NOT NULL,
  phone text NOT NULL,
  country text NOT NULL,
  vat_number text NOT NULL,
  shopify_domain text NOT NULL,
  markup_tier public.markup_tier NOT NULL DEFAULT 'standard',
  status public.profile_status NOT NULL DEFAULT 'pending',
  middleware_tenant_id text UNIQUE,
  provisioning_status public.provisioning_status NOT NULL DEFAULT 'not_started',
  provisioning_step text,
  provisioning_error text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopify_domain_must_be_myshopify CHECK (shopify_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  CONSTRAINT middleware_tenant_id_format CHECK (middleware_tenant_id IS NULL OR middleware_tenant_id ~ '^rs_[0-9a-f]{32}$')
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users create their own pending profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = id
    AND status = 'pending'
    AND markup_tier = 'standard'
    AND middleware_tenant_id IS NULL
    AND provisioning_status = 'not_started'
    AND provisioning_step IS NULL
    AND provisioning_error IS NULL
    AND approved_at IS NULL
  );
CREATE POLICY "Clients update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins have full access to profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Protected profile fields + middleware_tenant_id immutability
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Immutable for everyone, including admins and the service role.
  IF OLD.middleware_tenant_id IS NOT NULL
     AND NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id THEN
    RAISE EXCEPTION 'middleware_tenant_id is immutable once set';
  END IF;

  -- Authenticated non-admins cannot write privileged fields.
  -- auth.uid() is null for the service role, which is fully trusted.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.markup_tier IS DISTINCT FROM OLD.markup_tier
       OR NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id
       OR NEW.provisioning_status IS DISTINCT FROM OLD.provisioning_status
       OR NEW.provisioning_step IS DISTINCT FROM OLD.provisioning_step
       OR NEW.provisioning_error IS DISTINCT FROM OLD.provisioning_error
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by an admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_guard_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- ===== quote_requests =====
CREATE TABLE public.quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_url text NOT NULL,
  product_name text,
  notes text,
  target_monthly_volume integer,
  image_urls text[],
  status public.quote_status NOT NULL DEFAULT 'submitted',
  cost_price numeric,
  shipping_cost numeric,
  markup_percent numeric,
  admin_notes text,
  quoted_price numeric,
  moq integer,
  lead_time_days integer,
  quote_valid_until date,
  quoted_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_requests_client_id_idx ON public.quote_requests (client_id, created_at DESC);
CREATE INDEX quote_requests_status_idx ON public.quote_requests (status, created_at ASC);

-- Clients can only create rows; they get NO table-level read access, so the
-- admin-only pricing columns can never reach them. Client reads go through the
-- quote_requests_client view below. All admin access uses the service role.
GRANT INSERT, SELECT (client_id) ON public.quote_requests TO authenticated;
GRANT ALL ON public.quote_requests TO service_role;
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients create own quote requests" ON public.quote_requests
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = client_id);

-- Security-definer view (owned by postgres, which bypasses RLS): exposes only
-- safe columns and only the caller's own rows. This is the client read path.
CREATE OR REPLACE VIEW public.quote_requests_client AS
SELECT id, client_id, product_url, product_name, notes, target_monthly_volume,
       image_urls, status, quoted_price, moq, lead_time_days, quote_valid_until,
       quoted_at, responded_at, created_at
FROM public.quote_requests
WHERE client_id = auth.uid();

GRANT SELECT ON public.quote_requests_client TO authenticated;
GRANT SELECT ON public.quote_requests_client TO service_role;

-- Client quote responses: the ONLY way a client can change a quote row.
CREATE OR REPLACE FUNCTION public.respond_to_quote(p_quote_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q record;
BEGIN
  SELECT id, client_id, status, quote_valid_until INTO q
  FROM public.quote_requests WHERE id = p_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF q.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only respond to your own quotes';
  END IF;
  IF q.status <> 'quoted' THEN
    RAISE EXCEPTION 'This quote is not awaiting your response';
  END IF;
  IF q.quote_valid_until IS NOT NULL AND q.quote_valid_until < current_date THEN
    RAISE EXCEPTION 'This quote has expired';
  END IF;

  UPDATE public.quote_requests
  SET status = CASE WHEN p_accept THEN 'accepted'::public.quote_status ELSE 'rejected'::public.quote_status END,
      responded_at = now()
  WHERE id = p_quote_id;
END;
$$;

-- ===== wallet_transactions (append-only ledger) =====
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type public.wallet_txn_type NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  balance_after numeric NOT NULL,
  description text NOT NULL,
  reference text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wallet_transactions_reference_unique
  ON public.wallet_transactions (reference) WHERE reference IS NOT NULL;
CREATE INDEX wallet_transactions_client_idx
  ON public.wallet_transactions (client_id, created_at DESC);

GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients read own wallet transactions" ON public.wallet_transactions
  FOR SELECT TO authenticated USING (auth.uid() = client_id);
CREATE POLICY "Admins read all wallet transactions" ON public.wallet_transactions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Ledger immutability for ALL roles (including service role).
CREATE OR REPLACE FUNCTION public.block_wallet_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet_transactions is append-only: updates and deletes are not allowed';
END;
$$;

CREATE TRIGGER wallet_transactions_no_update
  BEFORE UPDATE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.block_wallet_mutation();
CREATE TRIGGER wallet_transactions_no_delete
  BEFORE DELETE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.block_wallet_mutation();

-- Single write path for the ledger.
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_client_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_reference text DEFAULT NULL
)
RETURNS public.wallet_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_new_balance numeric;
  v_row public.wallet_transactions%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can create wallet transactions';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_type NOT IN ('credit', 'debit', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_type;
  END IF;
  IF p_reference IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wallet_transactions WHERE reference = p_reference
  ) THEN
    RAISE EXCEPTION 'A transaction with reference % already exists', p_reference;
  END IF;

  -- Serialize concurrent writes for this client within the transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id::text));

  SELECT balance_after INTO v_balance
  FROM public.wallet_transactions
  WHERE client_id = p_client_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  v_balance := COALESCE(v_balance, 0);

  IF p_type = 'debit' THEN
    v_new_balance := v_balance - p_amount;
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Insufficient funds: current balance is %, cannot debit %', v_balance, p_amount;
    END IF;
  ELSE
    v_new_balance := v_balance + p_amount;
  END IF;

  INSERT INTO public.wallet_transactions
    (client_id, type, amount, balance_after, description, reference, created_by)
  VALUES
    (p_client_id, p_type::public.wallet_txn_type, p_amount, v_new_balance, p_description, p_reference, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ===== Storage policies for the private quote-images bucket =====
CREATE POLICY "Clients upload to their own quote-images folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'quote-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Clients read their own quote-images folder"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'quote-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Admins read all quote images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'quote-images' AND public.has_role(auth.uid(), 'admin'));