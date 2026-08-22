# B2B Dropshipping Supplier Portal

A two-sided portal: **clients** (dropshippers) request sourcing quotes and manage a prepaid wallet; **admin** (the supplier) quotes, approves clients, and adjusts wallets. Email/password auth, EUR formatting (`€1.234,56`), DD/MM/YYYY dates, dense neutral B2B design.

## Backend — Lovable Cloud (Supabase)

Step 1 is enabling Lovable Cloud (auth, database, storage). One migration creates everything below.

### Schema

- **user_roles** — `user_id` + `role` enum (`admin`, `client`). Roles live here, not on `profiles` (storing a role on the profile row enables privilege-escalation attacks). A `has_role(user_id, role)` security-definer function backs all admin policies.
- **profiles** — `id` (FK auth.users), `company_name`, `contact_name`, `phone`, `country`, `vat_number`, `shopify_domain`, `markup_tier` enum (`standard`|`volume`|`partner`, default `standard`), `status` enum (`pending`|`active`|`suspended`, default `pending`), `created_at`. A signup trigger auto-creates the profile + `client` role row.
- **quote_requests** — client-visible columns only: `id`, `client_id`, `product_url`, `product_name`, `notes`, `target_monthly_volume`, `image_urls` (text[]), `status` enum (`submitted`|`sourcing`|`quoted`|`accepted`|`rejected`|`expired`), `quoted_price`, `moq`, `lead_time_days`, `quote_valid_until`, `quoted_at`, `responded_at`, `created_at`.
- **quote_admin_details** — 1:1 with quote_requests holding `cost_price`, `shipping_cost`, `markup_percent`, `admin_notes`.
- **wallet_transactions** — `id`, `client_id`, `type` enum (`credit`|`debit`|`adjustment`), `amount`, `balance_after`, `description`, `reference`, `created_by`, `created_at`.

### Why a separate table for cost/markup (important)

Postgres RLS is **row-level only** — it cannot hide individual columns, and both roles connect as the same `authenticated` role, so column grants can't split them either. The only way to guarantee `cost_price`, `shipping_cost`, `markup_percent`, and `admin_notes` can never reach a client (even via a hand-crafted API call) is to keep them in `quote_admin_details` with an **admin-only RLS policy**. `quote_requests` simply never contains those columns, so any client-side leak is impossible by construction. This is stricter than the literal schema and fulfills the "NEVER visible to clients" requirement at the database level.

### RLS + enforcement triggers (all tables RLS-enabled, with GRANTs)

- profiles: client selects/updates **own** row; a trigger blocks non-admins from changing `status` or `markup_tier`. Admin: full access via `has_role`.
- quote_requests: client inserts/selects own rows; a trigger restricts client updates to **only** `quoted → accepted|rejected` (sets `responded_at`) — every other field is frozen for clients. Admin: full access.
- quote_admin_details: admin-only select/insert/update. No client policy at all.
- wallet_transactions: client selects own rows only (no insert/update/delete). Admin: full access.
- **adjust_wallet** security-definer SQL function: verifies caller is admin, computes `balance_after` from the latest balance inside one transaction (atomic, no race), inserts the row.
- **handle_new_user** trigger on signup: creates profile + client role, status `pending`.

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
- **Clients**: table with company, contact, country, VAT, tier editor, and approve / suspend / reactivate actions.
- **Wallet adjustment**: pick client, credit/debit, amount, description, optional reference → calls `adjust_wallet`, shows resulting balance.

## Design

Neutral B2B: warm-gray surfaces, dark slate primary, restrained status colors (amber sourcing, green quoted/accepted, red rejected, neutral pending). IBM Plex Sans + IBM Plex Mono (numbers/currency) via font link in the root head. Sidebar app shell, dense shadcn tables, small radii. Semantic tokens in `src/styles.css` — no hardcoded colors. Formatting helpers: `Intl.NumberFormat` for `€1.234,56` and DD/MM/YYYY dates. Per-route `head()` metadata (replaces the "Lovable App" defaults); toasts via sonner.

## Build order

1. Enable Lovable Cloud → run the migration (schema + RLS + triggers + functions + storage).
2. Design tokens, fonts, app shell, auth pages, role routing, pending gate.
3. Client features (dashboard, quote form, quotes list, wallet).
4. Admin features (queue, detail + quoting, clients, wallet adjustment).
5. Verify end-to-end in the preview (signup → approve → quote → accept → wallet), plus per-route head metadata.

Note: the admin account itself is bootstrapped by inserting an `admin` row into `user_roles` for your user after you sign up — I'll do that once, after the first account exists.
