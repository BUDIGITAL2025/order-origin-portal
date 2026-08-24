# FLYSALES

Build a B2B dropshipping supplier portal. Two roles: CLIENT (dropshipper) and ADMIN (me, the supplier).

TECH: React + TypeScript + Tailwind + shadcn/ui, Supabase for auth and database. Enable Row Level Security on all tables.

DATABASE SCHEMA (Supabase):

profiles

- id (uuid, FK auth.users)

- role (enum: 'client' | 'admin', default 'client')

- company_name, contact_name, phone, country, vat_number (text)

- shopify_domain (text, nullable)

- markup_tier (enum: 'standard' | 'volume' | 'partner', default 'standard')

- status (enum: 'pending' | 'active' | 'suspended', default 'pending')

- created_at

quote_requests

- id (uuid)

- client_id (FK profiles)

- product_url (text, required)

- product_name, notes (text)

- target_monthly_volume (int, nullable)

- image_urls (text array, nullable)

- status (enum: 'submitted' | 'sourcing' | 'quoted' | 'accepted' | 'rejected' | 'expired', default 'submitted')

- cost_price (numeric, nullable, ADMIN ONLY)

- shipping_cost (numeric, nullable, ADMIN ONLY)

- markup_percent (numeric, nullable, ADMIN ONLY)

- quoted_price (numeric, nullable)

- moq (int, nullable)

- lead_time_days (int, nullable)

- quote_valid_until (date, nullable)

- admin_notes (text, ADMIN ONLY)

- quoted_at, responded_at (timestamp, nullable)

- created_at

wallet_transactions

- id (uuid)

- client_id (FK profiles)

- type (enum: 'credit' | 'debit' | 'adjustment')

- amount (numeric)

- balance_after (numeric)

- description (text)

- reference (text, nullable)

- created_by (FK profiles, nullable)

- created_at

CRITICAL: cost_price, shipping_cost, markup_percent and admin_notes must NEVER be visible to clients. Enforce this at the RLS policy level, not just in the UI.

RLS POLICIES:

- Clients read/update only their own profile

- Clients read/insert only their own quote_requests; can only update status from 'quoted' to 'accepted' or 'rejected'

- Clients read only their own wallet_transactions, never insert

- Admins full access to everything

CLIENT UI:

- Signup/login (email + password). New signups land in 'pending' until admin approves.

- Dashboard: wallet balance (sum of transactions), count of quotes by status, recent activity

- "Request a Quote" form: product URL, name, notes, expected monthly volume, optional image upload

- "My Quotes" list with status badges. Quoted items show final price, MOQ, lead time, validity date, and Accept / Reject buttons. Never show cost or markup.

- "Wallet" page: current balance and transaction history

ADMIN UI:

- Queue of all quote_requests, filterable by status, sorted oldest first

- Detail view of a request with a "Copy sourcing brief" button that copies product URL, client name and notes to clipboard as plain text

- Quote form: enter cost_price and shipping_cost, pick markup_percent (pre-filled from the client's markup_tier: standard 35%, volume 25%, partner 18%), auto-calculate quoted_price live as (cost + shipping) * (1 + markup/100), allow manual override of the final price. Set MOQ, lead time, validity date. Save moves status to 'quoted'.

- Client list with approve/suspend actions and markup tier editing

- Manual wallet adjustment: pick a client, enter amount, credit or debit, description. Writes to wallet_transactions with balance_after computed from the previous balance.

Currency EUR, format as €1.234,56 (European style). Dates as DD/MM/YYYY.

Clean professional B2B look, not a consumer SaaS. Neutral palette, dense tables, readable.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://order-origin-portal.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bdf3436f-edba-4694-a1af-83c61223fb8a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
