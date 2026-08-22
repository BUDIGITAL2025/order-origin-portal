# B2B Dropshipping Supplier Portal

A two-sided portal: **clients** (dropshippers) request sourcing quotes and manage a prepaid wallet; **admin** (the supplier) quotes, approves clients, and adjusts wallets. Email/password auth, EUR formatting (`€1.234,56`), DD/MM/YYYY dates, dense neutral B2B design.

## Backend — Lovable Cloud (Supabase)

Step 1 is enabling Lovable Cloud (auth, database, storage). One migration creates everything below.

### Schema

- **user_roles** — `user_id` + `role` enum (`admin`, `client`). Roles live here, not on `profiles` (storing a role on the profile row enables privilege-escalation attacks). A `has_role(user_id, role)` security-definer function backs all admin policies.
- **profiles** — `id` (FK auth.users), `company_name`, `contact_name`, `phone`, `country`, `vat_number`, `shopify_domain`, `markup_tier` enum (`standard`|`volume`|`partner`, default `standard`), `status` enum (`pending`|`active`|`suspended`, default `pending`), plus approval/provisioning columns: `middleware_tenant_id` (text, unique, nullable — set only on approval, never at signup), `provisioning_status` enum (`not_started`|`in_progress`|`complete`|`failed`, default `not_started`), `provisioning_error` (text, nullable), `approved_at` (timestamp, nullable), `created_at`. A signup trigger auto-creates the profile + `client` role row. (The spec's `role` column on profiles is deliberately replaced by `user_roles` above — same behavior, no privilege-escalation vector.)
- **quote_requests** — client-visible columns only: `id`, `client_id`, `product_url`, `product_name`, `notes`, `target_monthly_volume`, `image_urls` (text[]), `status` enum (`submitted`|`sourcing`|`quoted`|`accepted`|`rejected`|`expired`), `quoted_price`, `moq`, `lead_time_days`, `quote_valid_until`, `quoted_at`, `responded_at`, `created_at`.
- **quote_admin_details** — 1:1 with quote_requests holding `cost_price`, `shipping_cost`, `markup_percent`, `admin_notes`.
- **wallet_transactions** — append-only ledger: `id`, `client_id`, `type` enum (`credit`|`debit`|`adjustment`), `amount` (always positive; type sets direction), `balance_after`, `description`, `reference`, `created_by`, `created_at`. Balance is always derived from the latest row's `balance_after` — never stored on profiles.

### Why a separate table for cost/markup (important)

The spec asks for a security-definer view or column-level policy so cost data can't reach clients. Postgres RLS is **row-level only** — it cannot hide columns — and because clients and admins both connect as the same `authenticated` role, a security-definer view would also force every admin read through the service-role key. The stronger, simpler form of the same guarantee: keep `cost_price`, `shipping_cost`, `markup_percent`, and `admin_notes` in `quote_admin_details` with an **admin-only RLS policy**, so `quote_requests` never contains those columns at all. A client cannot read them even with a hand-crafted API call — DB-level enforcement, not UI hiding.

### RLS + enforcement triggers (all tables RLS-enabled, with GRANTs)

- profiles: client selects/updates **own** row; a BEFORE UPDATE trigger blocks non-admins from writing `status`, `markup_tier`, `middleware_tenant_id`, `provisioning_status`, `provisioning_error`, or `approved_at`. Admin: full access via `has_role`.
- **middleware_tenant_id immutability trigger** (exactly per spec): BEFORE UPDATE raises an exception when `OLD.middleware_tenant_id IS NOT NULL AND NEW.middleware_tenant_id IS DISTINCT FROM OLD.middleware_tenant_id` — applies to everyone, including admins.
- quote_requests: client inserts/selects own rows; a trigger restricts client updates to **only** `quoted → accepted|rejected`, and only while `quote_valid_until` has not passed (sets `responded_at`) — every other field is frozen for clients. Admin: full access.
- quote_admin_details: admin-only select/insert/update. No client policy at all.
- wallet_transactions: client selects own rows only. A trigger blocks UPDATE and DELETE for **all** roles (append-only). `authenticated` gets **no INSERT grant** — every write goes through the function below.
- **apply_wallet_transaction(client_id, type, amount, description, reference)** — security-definer Postgres function, the single write path for the ledger: verifies the caller is an admin, locks the client's latest ledger row with `SELECT ... FOR UPDATE`, computes the new balance, rejects any debit that would go below zero, inserts the row. The app never computes balances or inserts directly, so concurrent writes can't corrupt the ledger.
- **handle_new_user** trigger on signup: creates profile + client role, status `pending`, provisioning `not_started`.

### Approval & provisioning flow

- **provisionClient** — implemented as a TanStack server function (this stack runs server logic on its own runtime, so no Supabase edge function is created; the behavior is identical). Invoked when an admin approves a pending client, and by the retry button.
- Flow: verify caller is admin → if `middleware_tenant_id` is already set, keep it (idempotent — never regenerate); otherwise generate `'rs_' + uuid` → write tenant id, `status='active'`, `approved_at=now()`, `provisioning_status='in_progress'` → TODO stubs for the three external-middleware steps (create tenant, grant service-account membership, impersonation health check) as clearly marked comments wrapped in working error handling → on success `provisioning_status='complete'`, on any failure `'failed'` with `provisioning_error`.

### Storage

Private bucket `quote-images`: clients upload/read inside their own `<user_id>/` folder; admin reads all. Images rendered via short-lived signed URLs.

## App structure (TanStack Start)

```text
/                      Public landing — sign-in / request-access CTA
/auth                  Login + signup (email/password, company fields)
_authenticated/        Integration-managed gate (redirects to /auth)
  pending              "Account awaiting approval" screen
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
- Post-login redirect by role: client → `/dashboard`, admin → `/admin/quotes`. `pending`/`suspended` profiles are intercepted to the pending screen.
- Server functions in `src/lib/*.functions.ts` (zod-validated, `requireSupabaseAuth` where needed); admin functions verify `has_role` server-side. Bearer attacher appended in `src/start.ts`.

## Client UI

- **Dashboard**: wallet balance card, quote counts by status, recent activity feed (quotes + transactions merged).
- **Request a Quote**: product URL (required), name, notes, expected monthly volume, multi-image upload to storage. Validated with zod; success toast + redirect to My Quotes.
- **My Quotes**: dense table, status badges, quoted rows show `quoted_price`, MOQ, lead time, validity date, and **Accept / Reject** actions (confirm dialog). Quotes past `quote_valid_until` show an Expired state. No cost/markup data exists client-side.
- **Wallet**: current balance + full transaction history table (type badge, description, reference, running balance).

## Admin UI

- **Quote queue**: all requests, oldest first, status filter tabs + counts, client company column.
- **Quote detail**: full request info, image previews (signed URLs), and **Copy sourcing brief** — copies product URL, client name, and notes as plain text.
- **Quote form**: cost price + shipping cost inputs; markup % select pre-filled from the client's tier (standard 35 / volume 25 / partner 18, editable); live auto-calc `quoted_price = (cost + shipping) × (1 + markup/100)` with a manual-override toggle; MOQ, lead time, validity date, admin notes. Save writes both tables and moves status to `quoted`.
- **Clients**: table with company, contact, country, VAT, tier editor, approve / suspend / reactivate actions, plus read-only `provisioning_status` and `middleware_tenant_id` columns and a **Retry** button when provisioning is `failed`. Approve and retry both call provisionClient.
- **Wallet adjustment**: pick client, credit/debit, amount, description, optional reference → calls `apply_wallet_transaction` (never a direct insert), shows the resulting balance or the insufficient-funds error.

## Design

Neutral B2B: warm-gray surfaces, dark slate primary, restrained status colors (amber sourcing, green quoted/accepted, red rejected, neutral pending). IBM Plex Sans + IBM Plex Mono (numbers/currency) via font link in the root head. Sidebar app shell, dense shadcn tables, small radii. Semantic tokens in `src/styles.css` — no hardcoded colors. Formatting helpers: `Intl.NumberFormat` for `€1.234,56` and DD/MM/YYYY dates. Per-route `head()` metadata (replaces the "Lovable App" defaults); toasts via sonner.

## Build order

1. Enable Lovable Cloud → run the migration (schema + RLS + triggers + functions + storage).
2. Design tokens, fonts, app shell, auth pages, role routing, pending gate.
3. Client features (dashboard, quote form, quotes list, wallet).
4. Admin features (queue, detail + quoting, clients, wallet adjustment).
5. Verify end-to-end in the preview (signup → approve + provisioning → quote → accept → wallet adjustment), plus per-route head metadata.

Note: the admin account itself is bootstrapped by inserting an `admin` row into `user_roles` for your user after you sign up — I'll do that once, after the first account exists.
