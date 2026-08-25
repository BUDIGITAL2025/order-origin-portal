# FlySales Architecture

## Overview

FlySales is a B2B dropshipping supplier portal built as a TanStack Start full-stack React application backed by Lovable Cloud / Supabase. It serves two primary roles: **CLIENT** (dropshipper) and **ADMIN** (the supplier). The system is intentionally divided into domains that can evolve independently as the product matures from a sourcing tool into a broader operations platform.

---

## Module descriptions

### Auth & identity
Account-level authentication and role resolution. Handles signup, login, password reset, OAuth, profile basics, and the `user_roles` guard. All business data lives below the account via Entities and Workspaces (stores).

### Entities & workspaces
Three-level hierarchy: **Account → Entities → Workspaces**. Entities represent legal / billing entities; workspaces represent Shopify stores or manual OMS channels. Billing and GMV roll up at the entity level, while operations are scoped to the workspace.

### Quotes & sourcing
Multi-variant quote request workflow. Clients submit products with target countries; admins respond with variant-level country pricing. Supports internal sourcing briefs, quote lines, and requoting.

### Product catalogue & bundles
Admin-managed products with SKUs, country-specific prices, bundles, and status/discontinuation flags. Powers quote responses and order composition.

### Orders & fulfilment
Order ingestion from both manual OMS and middleware-connected channels. Includes order items, fulfilment items, tracking, batch payments, and lifecycle gates.

### Wallet & billing
Prepaid wallet, Stripe subscriptions, wallet top-ups, and immutable payment receipts. Stripe events are processed through verified webhooks. Subscription plans gate quote submission and order processing.

### Disputes
Client-initiated dispute workflow with admin investigation, resolution actions (wallet credit, reship, reject), and threaded messaging.

### Documents
Immutable payment receipts generated as PDFs, stored in private Supabase Storage, and served via signed URLs. Includes subscription and top-up receipts.

### SpyMarket
Admin-only market research tool powered by the TrendTrack API. Includes shop/creative/ad exploration, growth analytics, preset views, and a separate subscription tier for research access.

### Middleware integration
Two-engine architecture with FlySales as the commercial/payment layer and an external middleware handling store connectivity. Supports push webhooks, pull polling, release signalling, and an admin simulator for end-to-end testing.

### Admin operations
Administrative surfaces for clients, entities, workspaces, quotes, orders, wallet adjustments, products, disputes, documents, and integration monitoring.

---

## Commercial model — the pricing ladder (decided 2026-08-25)

| Tier | Price | Boundary | Notes |
|---|---|---|---|
| Sourcing Basic | $49/mo + COGS margin | 5 quotes/mo | entry |
| Sourcing Unlimited | $99/mo + COGS margin | unlimited quotes | operator |
| PIM | $199/mo | central catalog, no sync | standalone product line |
| Multichannel T1 | $399/mo | ≤$50k GMV/mo · 5 channels | INCLUDES PIM |
| Multichannel T2 | $599/mo | $50k–$100k GMV | |
| Multichannel T3 | $799/mo | $100k–$250k GMV | |
| Enterprise | custom | >$250k GMV | negotiated |
| Branding / Private Label | project fee + MOQ margin | cross-tier | unlocked by 90d stable rotation |

Mechanics: GMV = platform-processed order volume, measured as a 90-day rolling average (auto-measurable via the middleware order flow; no self-reporting). Tier upgrades proposed automatically when the rolling average crosses a boundary. Multichannel absorbs PIM (upgrade, not add-on). Revenue profile: transactional (sourcing COGS) + MRR (PIM/Multichannel) + project fees (branding).
