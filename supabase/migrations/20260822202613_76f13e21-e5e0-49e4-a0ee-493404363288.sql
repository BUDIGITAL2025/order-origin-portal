create sequence if not exists public.document_number_seq;

create type public.document_type as enum ('order_receipt', 'wallet_topup', 'subscription');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  document_type public.document_type not null default 'order_receipt',
  document_number text not null unique,
  order_id uuid references public.orders(id),
  wallet_transaction_id uuid references public.wallet_transactions(id),
  payment_reference text,
  amount numeric not null,
  issued_at timestamptz not null default now(),
  storage_path text,
  external_invoice_id text,
  created_at timestamptz not null default now()
);

-- Idempotency at the database level: one receipt per order, per wallet
-- transaction, per external payment reference (e.g. a Stripe invoice).
create unique index documents_order_unique on public.documents (order_id) where order_id is not null;
create unique index documents_wallet_txn_unique on public.documents (wallet_transaction_id) where wallet_transaction_id is not null;
create unique index documents_payment_reference_unique on public.documents (payment_reference) where payment_reference is not null;
create index documents_client_created_idx on public.documents (client_id, created_at desc);

grant select on public.documents to authenticated;
grant all on public.documents to service_role;

alter table public.documents enable row level security;

create policy "Clients read own documents"
  on public.documents for select to authenticated
  using (auth.uid() = client_id);

create policy "Admins read all documents"
  on public.documents for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Immutability: an issued document stays issued.
create or replace function public.block_document_mutation()
 returns trigger
 language plpgsql
 set search_path = 'public'
as $$
begin
  raise exception 'documents is append-only: updates and deletes are not allowed';
end;
$$;

create trigger documents_no_update
  before update on public.documents
  for each row execute function public.block_document_mutation();

create trigger documents_no_delete
  before delete on public.documents
  for each row execute function public.block_document_mutation();

-- Sequential receipt numbering, FS-R- plus zero-padded sequence value.
create or replace function public.generate_document_number()
 returns text
 language sql
 volatile
 security definer
 set search_path = 'public'
as $$
  select 'FS-R-' || lpad(nextval('public.document_number_seq')::text, 6, '0')
$$;