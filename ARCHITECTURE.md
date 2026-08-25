FlySales — Platform Architecture v2

Source of truth for the whole platform. Two engines, one face. Last updated: 2026-08-25 · Owner: Flávio · Dev (middleware): Carlos · Both codebases company-owned.

1. The two-engine architecture

The platform is two engines and one face:

LOVABLE FRONT-END (the face): client portal, admin, future PIM UI. The browser talks ONLY to Supabase edge functions — never to the middleware directly.

COMMERCIAL ENGINE (Supabase + Stripe): identity/accounts, subscriptions, WALLET (client money), quotes (sourcing), disputes, receipts.

OPERATIONS ENGINE (Middleware, FastAPI): orders (owner of record), PIM, channels (Amazon OAuth scaffold, Mirakl live on all marketplaces, Google Merchant), inventory (live), carrier-tracking, suppliers, comms (WhatsApp), invoicing/fiscal (NOT wired to FlySales clients for now).

Rule zero: middleware admin endpoints are never exposed to the client. All cross-engine calls are server-to-server with scoped tokens.

2. Boundary map — source of truth per domain (DECIDED)

Domain Source of truth Other engine's role Identity (account→entity→workspace) Supabase Connected workspace maps 1:1 to middleware tenant (rs_+32hex) stored on the workspace. Provisioning API-automated (C1). Subscriptions & plan gating Supabase + Stripe Middleware never sees Stripe. Wallet — client money, ledger Supabase (single-writer, seq tiebreaker, locks) Middleware NEVER reads balances or writes wallet rows. Receives only a paid/released signal per order (C2). Quotes & quote catalog (sourcing) Supabase Not a middleware concern. Accepted-quote SKUs sync when workspace goes connected. Orders — operational record MIDDLEWARE FlySales keeps a commercial shadow (payment status, debits, receipts, disputes) keyed by middleware_order_id. Events flow middleware→FlySales (push + poll). Fulfilment dispatch & tracking Middleware FlySales displays tracking, sends client emails. Inventory Middleware FlySales reads for display (later). PIM (second product line) Middleware Lovable builds a separate PIM client UI. Quote catalog and PIM are different products for different client types. Marketplaces/channels Middleware Client-facing channel UI in Lovable, later. Invoicing/fiscal Deferred. FlySales clients get Stripe-based receipts from Supabase. Middleware invoicing stays for existing ops use only. Disputes (client claims) Supabase Middleware supplies shipment evidence read-only.

Two product lines, one ladder: Sourcing (live: quotes→wallet→fulfilment) and Operations/PIM (future: PIM→channels→inventory). The ladder: sourcing client → product wins (forecast) → private label (branding) → graduates to PIM/multichannel. CJ can't do the top; Linnworks can't do the bottom.

3. Integration contracts

C1 — Identity & tenant provisioning

workspaces.tenant_id holds the middleware tenant id. On connected-mode activation, an edge function calls middleware tenant create + shopify/config + shop-map with a service token. Requires Carlos exposing provisioning to our service identity.

C2 — Order lifecycle & the payment gate (critical)

Shopify → middleware webhook → order of record (pending).

Middleware → FlySales: order event (push webhook to our receiver AND caught by our 5-min poller as redundancy — both paths idempotent on middleware_order_id).

FlySales creates the commercial shadow → prices from accepted quotes → awaiting_payment → client pays from wallet.

FlySales → middleware: POST orders/{id}/approve with Idempotency-Key. Middleware must not dispatch to vendors before this signal (the dispatch gate — agreed with Carlos as "yes, later"; HARD RULE: no real client goes connected-live before the gate exists; staging tests may proceed).

Middleware fulfils → tracking events back → client email + portal update.

Reject before release cancels without touching vendors; never reject after release.

Manual mode stays 100% Supabase. Historical manual orders never migrate.

C3 — Money isolation (hard rule)

Money state never crosses. Middleware receives booleans/events, never amounts, balances, or Stripe objects.

C4 — Product graduation (quote catalog → PIM)

Promotion creates the PIM record via middleware PIM API; quote-catalog row gets pim_product_id. One-way; PIM becomes source of truth thereafter.

C5 — Events both directions, same discipline

Inbound: push receiver (token_only mode, see Decision Log) + polling fallback every 5 min with per-tenant sync cursor. Outbound: callMiddleware() with bearer token + Idempotency-Key, all attempts audited in integration_calls. Both sides dedupe; digest surfaces poll-caught orders (webhook failures) daily.

4. Security model

Scoped service tokens (middleware auth/tokens + token profiles), never superadmin credentials. Dedicated machine user recommended (flysales-integration).

Server-to-server only; browser never holds middleware URLs/tokens.

Idempotency on everything money-adjacent; duplicate release is a no-op.

Audit both sides (integration_events / integration_calls + middleware audit), wired into the daily digest.

Staging tenant before any production linkage. Never test C2 against live vendor dispatch.

Blast-radius rule: middleware down → FlySales degrades (sync pending), never blocks payments. FlySales down → middleware holds dispatch (no paid signal = no dispatch). Fail closed on money, fail soft on display.

DECISION LOG 2026-08-25 (webhook signing): middleware webhooks currently arrive UNSIGNED (sender declined HMAC for now; his words: "montar sem HMAC e depois alteramos"). Mitigation: receiver runs in token_only mode — secret ingress path (48+ chars), strict tenant/schema/SKU validation, rate limiting, daily digest counter of unsigned events, 30-day escalation nag. HMAC remains the target state.

5. Middleware state audit (Carlos, 2026-08-25)

Production-real: orders pipeline (Shopify→order→pending-dispatch→vendors→tracking), tenant provisioning, Mirakl (ALL marketplaces live), inventory sync (all tenants), PIM publishing to Google Merchant only. Scaffold: Amazon OAuth (no real account). Webhook push to external URL: configured in middleware per tenant; polling recommended by Carlos as redundancy ("webhook pode falhar — deve existir redundância").

6. Build sequence

✅ FlySales integration side: receiver (HMAC + token_only), poller, release with retry, simulator — full C2 loop proven end to end.

Pending from Carlos: staging webhook URL config, sample JSONs (webhook payload + GET /orders response), then the joint end-to-end test.

Dispatch gate (Carlos) — blocking for real clients, not for staging.

C4 graduation + PIM client UI as second product line.

Deferred: middleware invoicing for FlySales clients, marketplace client UI, Amazon.

7. Commercial model — the pricing ladder (decided 2026-08-25)

Tier Price Boundary Notes Sourcing Basic $49/mo + COGS margin 5 quotes/mo entry Sourcing Unlimited $99/mo + COGS margin unlimited quotes operator PIM $199/mo central catalog, no sync standalone product line Multichannel T1 $399/mo ≤$50k GMV/mo · 5 channels INCLUDES PIM Multichannel T2 $599/mo $50k–$100k GMV Multichannel T3 $799/mo $100k–$250k GMV Enterprise custom >$250k GMV negotiated Branding / Private Label project fee + MOQ margin cross-tier unlocked by 90d stable rotation

Mechanics: GMV = platform-processed order volume, 90-day rolling average (auto-measured via middleware order flow; no self-reporting). Upgrades proposed automatically at boundary crossings. Multichannel absorbs PIM (upgrade, not add-on). Revenue profile: transactional (sourcing COGS) + MRR (PIM/Multichannel) + project fees (branding). First Enterprise case study: our own operation (CONFORT24/SORA CARES) running on the platform.

Change the map before you build, not after.
