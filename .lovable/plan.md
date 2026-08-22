# B2B Dropshipping Supplier Portal

A two-sided portal: **clients** (dropshippers) request sourcing quotes and manage a prepaid wallet; **admin** (the supplier) quotes, approves clients, and adjusts wallets. Email/password auth, EUR formatting (`€1.234,56`), DD/MM/YYYY dates, dense neutral B2B design.

## Backend — Lovable Cloud (Supabase)

Step 1 is enabling Lovable Cloud (auth, database, storage). One migration creates everything below.

### Schema

- **user_roles** — `user_id` + `role` enum (`admin`, `client`). Roles live here, not on `profiles` (a role column on the profile row is a privilege-escalation vector). A `has_role(user_id, role)` security-definer function backs all admin policies. This replaces the spec's `role` column on profiles — same behavior, safer.
- **profiles** — `id` (FK auth.users), `company_name`, `contact_name`, `phone`, `country`, `vat_number`, `shopify_domain` (NOT NULL, valid `*.myshopify.com` — validated on signup and by a CHECK constraint), `markup_tier` enum (`standard`|`volume`|`partner`, default `standard`), `status` enum (`pending`|`active`|`suspended`, default `pending`), `middleware_tenant_id` (text, unique, nullable — set only on approval), `provisioning_status` enum (`not_started`|`in_progress`|`complete`|`failed`, default `not_started`), `provisioning_step` (text, nullable), `provisioning_error` (text, nullable), `approved_at` (timestamp, nullable), `created_at`.
  - CHECK: `middleware_tenant_id ~ '^rs_[0-9a-f]{32}$'` (35 chars total, no dashes).
  - Signup trigger auto-creates the profile + `client` role row (status `pending`).
- **quote_requests** — single table exactly as specified, including the admin-only columns (`cost_price`, `shipping_cost`, `markup_percent`, `admin_notes`) plus `quoted_price`, `moq`, `lead_time_days`, `quote_valid_until`, `quoted_at`, `responded_at`, and the status enum (`submitted`|`sourcing`|`quoted`|`accepted`|`rejected`|`expired`).
- **wallet_transactions** — append-only ledger: `id`, `client_id`, `type` enum (`credit`|`debit`|`adjustment`), `amount` (always positive; type sets direction), `balance_after`, `description`, `reference` (text, **unique when not null** — idempotency key, enforced by a partial unique index), `created_by`, `created_at`. Balance is always the latest row's `balance_after` — never stored on profiles.

### Hiding cost/markup from clients (DB-level, per spec)

Client reads go through a **security-definer view** `quote_requests_client` that projects only the safe columns and filters `WHERE client_id = auth.uid()`:

- The `authenticated` role gets **no SELECT grant** on the base table — only INSERT and UPDATE(status), both guarded by RLS (`client_id = auth.uid()`) and the transition trigger below. A hand-crafted API call against the base table returns nothing.
- The view is owned by the postgres role (RLS-bypassing owner); its own WHERE clause scopes rows, and the sensitive columns are never in its projection. Clients query the view exactly like a table.
- Consequence: admin reads of cost data go through server functions using the service role **after** a `has_role` check (Postgres privileges apply to the shared `authenticated` role, so admins can't read the hidden columns as themselves either). All admin reads/writes already flow through server functions in this design, so this adds no client-facing complexity.

### RLS + enforcement triggers (all tables RLS-enabled, with GRANTs)

- profiles: client selects/updates **own** row; a BEFORE UPDATE trigger blocks non-admins from writing `status`, `markup_tier`, `middleware_tenant_id`, `provisioning_status`, `provisioning_step`, `provisioning_error`, or `approved_at`. Admin: full access via `has_role`.
- **middleware_tenant_id immutability trigger** (exactly per spec): BEFORE UPDATE raises an exception when `OLD.middleware_tenant_id IS NOT NULL AND NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id` — applies to everyone, including admins and service role.
- quote_requests: clients insert/select own rows (select via the view). A BEFORE UPDATE trigger restricts client updates to **only** `quoted → accepted|rejected`, only while `quote_valid_until` has not passed (sets `responded_at`); every other field is frozen for clients. Admin: full access via service-role server functions.
- wallet_transactions: clients select own rows only. Triggers block UPDATE and DELETE for **all** roles (append-only). `authenticated` gets **no INSERT grant** — every write goes through the function below.
- **apply_wallet_transaction(p_client_id uuid, p_type text, p_amount numeric, p_description text, p_reference text)** — security-definer Postgres function, the ledger's single write path. In one transaction: verifies the caller is an admin, locks the client's ledger (`SELECT ... FOR UPDATE` on the latest row, `pg_advisory_xact_lock` on the client id when no rows exist), rejects a duplicate `p_reference`, rejects a debit that would take the balance below zero, computes `balance_after`, inserts. The app never inserts directly — concurrent writes can't corrupt the balance.
- **handle_new_user** trigger on signup: creates profile + client role, status `pending`, provisioning `not_started`.

### Approval & provisioning flow

- **provisionClient** — implemented as a TanStack server function (this stack runs server logic on its own runtime, so no Supabase edge function is created; behavior and security are identical). Invoked by the admin's Approve and Retry actions. Reads `MIDDLEWARE_URL`, `MIDDLEWARE_SERVICE_USER`, `MIDDLEWARE_SERVICE_PASSWORD`, `SERVICE_USER_ID` from server secrets inside the handler — never exposed to the browser; the client app never calls the middleware.
- Preconditions: `status = 'pending'` (or retry from `failed`) AND `shopify_domain IS NOT NULL` — refuses otherwise with a clear error.
- Steps, each persisting `provisioning_step` before attempting:
  1. `generate_tenant_id` — if `middleware_tenant_id` is null, generate `'rs_' + 32 hex chars` and persist it with `status='active'`, `approved_at=now()`, `provisioning_status='in_progress'`. If set, keep it and continue (idempotent).
  2. `create_tenant` — TODO: `POST {MIDDLEWARE_URL}/api/admin/tenants/create` with `{ name, shop_domain, tenant_id }`.
  3. `grant_membership` — TODO: `PUT {MIDDLEWARE_URL}/api/admin/auth/users/{SERVICE_USER_ID}/memberships/{middleware_tenant_id}` with `{ role: "operator" }` (mandatory — without it the client is provisioned locally but unreachable externally).
  4. `select_tenant` — TODO: `POST {MIDDLEWARE_URL}/api/admin/auth/select-tenant` with `{ tenant_id }` → tenant-scoped JWT for remaining calls.
  5. `health_check` — TODO: `GET {MIDDLEWARE_URL}/api/admin/tenants/shops` with the tenant JWT.
  6. Success: `provisioning_status='complete'`, clear `provisioning_error`.
- Failure handling: set `provisioning_status='failed'`, store the step in `provisioning_step` and the message in `provisioning_error`, stop — never left in `in_progress`. Re-running resumes safely: the tenant id is never regenerated, and each external call is written to tolerate the resource already existing (the TODO stubs are wrapped in this working control flow now).

### Storage

Private bucket `quote-images`: clients upload/read inside their own `<user_id>/` folder; admin reads all. Images rendered via short-lived signed URLs.

## App structure (TanStack Start)

```text
/                      Public landing — sign-in / request-access CTA
/auth                  Login + signup
_authenticated/        Integration-managed gate (redirects to /auth)
  pending              "Account awaiting approval" holding screen
  dashboard            Client home
  quotes               Client: my quotes list
  quotes/new           Client: request-a-quote form
  wallet               Client: balance + history
  _admin/              Role-gated layout (has_role check, redirects non-admins)
    admin/quotes       Quote queue
    admin/quotes/$id   Detail + quoting form
    admin/clients      Client management
    admin/wallet       Manual adjustments
```

- Auth-aware header: signed-in users see account menu + sign out; signed-out see Sign in. Sign-out clears the query cache and history-replaces to `/auth`.
- Post-login redirect by role: client → `/dashboard`, admin → `/admin/quotes`. `pending`/`suspended` profiles are intercepted to the holding screen.
- Server functions in `src/lib/*.functions.ts` (zod-validated, `requireSupabaseAuth` where needed); admin functions verify `has_role` via the caller's own session before touching the service role. Bearer attacher appended in `src/start.ts`.

## Client UI

- **Signup/login** (email + password). Signup collects company name, contact name, phone, country, VAT number, and Shopify domain — all required; the domain is validated as `*.myshopify.com` client-side (zod) and again by the DB CHECK. New signups land in `pending` and see the holding screen.
- **Dashboard**: wallet balance, quote counts by status, recent activity (quotes + transactions merged).
- **Request a Quote**: product URL (required), name, notes, expected monthly volume, multi-image upload to storage. Zod-validated; success toast + redirect to My Quotes.
- **My Quotes**: dense table, status badges. Quoted rows show final price, MOQ, lead time, validity date, and **Accept / Reject** (confirm dialog). Quotes past `quote_valid_until` show as expired with no actions; the DB trigger also rejects late responses.
- **Wallet**: current balance + full transaction history (type badge, description, reference, running balance).

## Admin UI

- **Quote queue**: all requests, oldest first, status filter tabs + counts, client company column.
- **Quote detail**: full request info, image previews (signed URLs), and **Copy sourcing brief** — copies product URL, client name, and notes as plain text.
- **Quote form**: cost price + shipping cost inputs; markup % pre-filled from the client's tier (standard 35 / volume 25 / partner 18, editable); live auto-calc `quoted_price = (cost + shipping) × (1 + markup/100)` with manual override; MOQ, lead time, validity date, admin notes. Save writes the row and moves status to `quoted`.
- **Clients**: table with company, contact, country, VAT, Shopify domain, tier editor, approve / suspend / reactivate actions; read-only `middleware_tenant_id`, `provisioning_status`, `provisioning_step` columns; **Retry** button when provisioning is `failed`. Approve and Retry call provisionClient.
- **Wallet adjustment**: pick client, credit/debit, amount, description, optional reference → calls `apply_wallet_transaction` (never a direct insert); shows the resulting balance or the insufficient-funds / duplicate-reference error.

## Design

Neutral B2B: warm-gray surfaces, dark slate primary, restrained status colors (amber sourcing, green quoted/accepted, red rejected, neutral pending). IBM Plex Sans + IBM Plex Mono (numbers/currency) via font link in the root head. Sidebar app shell, dense shadcn tables, small radii. Semantic tokens in `src/styles.css` — no hardcoded colors. Formatting helpers: `Intl.NumberFormat` for `€1.234,56` and DD/MM/YYYY dates. Per-route `head()` metadata (replaces the "Lovable App" defaults); toasts via sonner.

## Build order

1. Enable Lovable Cloud → run the migration (schema + view + RLS + triggers + ledger function + storage), store the four middleware secrets as placeholders.
2. Design tokens, fonts, app shell, auth pages, role routing, pending gate.
3. Client features (dashboard, quote form, quotes list, wallet).
4. Admin features (queue, detail + quoting, clients + provisioning, wallet adjustment).
5. Verify end-to-end in the preview (signup → approve + provisioning → quote → accept → wallet adjustment), plus per-route head metadata.

Note: the admin account is bootstrapped by inserting an `admin` row into `user_roles` for your user after you sign up — I'll do that once, after the first account exists.
