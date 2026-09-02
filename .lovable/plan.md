# Inventory & Reorders (Forecasting core) — Phase 5

Read-only consumption of middleware stock + our own order velocity, plus our planning fields (suppliers, lead times, safety margin), producing days-of-cover, a reorder-by date, a GREEN/AMBER/RED state, alerts and a "Plan reorder" path into the existing quote flow. Middleware stays the source of truth; we never write to it. No SpyMarket/TrendTrack involvement, no credits.

## Verified current state

- No inventory, stock, velocity or supplier tables exist. `products` columns are: id, quote_line_id, sku, product_name, variant_label, product_type, price_override, moq, status, middleware_product_id, push_status, push_error, created_at, store_id — no `supplier_id`, no lead-time overrides.
- The pull path already exists: `syncTenant` / `syncAllTenants` in `src/lib/middleware-sync.server.ts`, driven by the `/api/public/cron/middleware-order-sync` route and a pg_cron job.
- Outbound calls already go through `callMiddleware()` with bearer token, idempotency key and `integration_calls` auditing; paths live in `MIDDLEWARE_PATHS`.
- The simulator (`src/lib/simulator.server.ts` + `/api/public/middleware/simulator/$`) already serves pull orders and tracking; it has no inventory mode.
- Branded email builders live in `src/lib/email-templates.server.ts`, dispatched via `sendClientEmail`; the admin daily digest is `/api/public/cron/daily-digest`.

## Data model (new tables)

- `inventory_snapshots` — append-only: `store_id`, `sku`, `location`, `quantity`, `captured_at`. Index on `(store_id, sku, captured_at desc)`. Latest row per (store, sku, location) is "current stock".
- `sku_velocity` — one row per `(store_id, sku)`: `units_7d`, `units_30d`, `computed_at`.
- `suppliers` — admin-only: `name`, `notes`, `default_production_lead_days`, `default_transit_lead_days`, `active`.
- `products` gains: `supplier_id` (nullable FK), `production_lead_days`, `transit_lead_days`, `safety_margin_days` (all nullable overrides). Added to the product guard trigger so clients cannot write them.
- `stores` gains workspace defaults: `default_production_lead_days` (14), `default_transit_lead_days` (21), `default_safety_margin_days` (7); admin-only via the store guard trigger.

Access rules:
- Clients read `inventory_snapshots` and `sku_velocity` for their own workspaces only; no client writes (service-role/admin only).
- `suppliers` is admin-only for read and write — clients never see supplier names, consistent with closed pricing.
- Resolved lead days reach clients only through a server function that returns numbers, never the supplier row.

## Data in

Add `syncInventory(admin, store)` to the middleware layer:
- New entries in `MIDDLEWARE_PATHS` for the inventory endpoint (path kept in one constant, tolerant list extraction like `extractOrderList`).
- Called from the existing order-sync cron pass (every 5 min it already runs; inventory writes throttled to once per 30 min per tenant using `captured_at`), so no second scheduler is needed. If the middleware read fails, the tenant keeps its last snapshot and the UI shows a stale-data banner; nothing blocks.
- Every call audited in `integration_calls` via `callMiddleware`.

Velocity is computed from our own shadow orders (`orders` + `order_items`, paid/processing/shipped/delivered within 7 and 30 days), not from the middleware — no extra calls. A `recompute_sku_velocity(store_id)` SQL function fills `sku_velocity`; the cron calls it per tenant after the inventory pass.

Simulator gains an inventory mode: `GET {simulator}/api/admin/inventory` returns deterministic per-SKU stock across two fake locations for the simulated tenant, plus an admin control to set a specific SKU's quantity so an AMBER/RED case can be forced.

## Resolution cascade

Implemented once, in SQL, as `resolved_lead_times(store_id)` returning per SKU: `production_lead`, `transit_lead`, `safety_margin` and an origin letter for each (`P` product, `S` supplier, `W` workspace).

```text
production_lead = product override -> supplier default -> workspace default
transit_lead    = product override -> supplier default -> workspace default
safety_margin   = product override -> workspace default
```

Because resolution is computed at read time from the supplier row, editing a supplier default instantly changes every linked SKU — no backfill job, no stale copies.

## The math

```text
daily_velocity  = units_30d / 30, else units_7d / 7, else 0
days_of_cover   = daily_velocity > 0 ? total_stock / daily_velocity : Infinity
total_lead      = production_lead + transit_lead + safety_margin
reorder_by_date = today + days_of_cover - total_lead

GREEN  reorder_by more than 14 days away
AMBER  reorder_by within 14 days
RED    reorder_by today or in the past -> also show the gap:
       gap_days = total_lead - days_of_cover  ("ordering today still means ~6 days out of stock")
velocity 0 -> cover infinite, state "no recent sales", never alerts
```

## UI

Client page `/inventory` (sidebar entry between Products and Orders, shown when the workspace has inventory data):
- Summary bar: SKUs tracked, green/amber/red counts, total units in stock, last synced.
- Dense table sorted by urgency: product + SKU, total stock (expandable row showing per-location breakdown), velocity/day, days of cover, resolved lead days, reorder-by date, state chip.
- Row action "Plan reorder": opens the quote flow prefilled for that SKU with suggested quantity = `daily_velocity x (total_lead + coverage target of 30 days)`.
- Workspaces with no inventory data get an explainer state (what this page will show, why it is empty, how the workspace gets connected) — not an empty table.

Admin page `/admin/inventory` (admin console kit from `src/components/admin-ui.tsx`):
- All workspaces, filterable, same columns plus the P/S/W origin indicator with tooltip on each resolved lead time, and a per-workspace sync action.
- Admin suppliers page `/admin/suppliers`: CRUD list with name, lead defaults, active flag, and count of linked SKUs. Supplier assignment plus the product-level override fields live together in a drawer on the admin products page.
- Admin workspace defaults (production/transit/safety) editable on the entities & workspaces page.

Clients never see supplier names anywhere — only resolved day counts.

## Alerts

State transitions are tracked in a small `sku_alert_state` table (`store_id`, `sku`, `state`, `notified_at`). After each velocity/inventory pass:
- A SKU entering AMBER or RED sends exactly one branded email to the workspace owner (new `inventoryReorderEmail` template) and records the new state.
- No email while the state is unchanged; moving back to GREEN just resets the record so a later re-entry alerts again.
- Each transition also contributes a line to the admin daily digest.

## Guardrails

- All middleware reads audited in `integration_calls`; failures are logged to `error_logs`, never thrown to the user.
- Stale-data banner on both pages when the last successful capture is older than 2 hours, naming the last sync time.
- No middleware writes anywhere in this module.

## Files

Create: migration for the tables/columns/functions, `src/lib/inventory.server.ts`, `src/lib/inventory.functions.ts`, `src/lib/suppliers.functions.ts`, `src/routes/_authenticated/_client/inventory.tsx`, `src/routes/_authenticated/admin/inventory.tsx`, `src/routes/_authenticated/admin/suppliers.tsx`.

Edit: `src/lib/middleware.server.ts` (inventory path + fetch), `src/lib/middleware-sync.server.ts` (inventory + velocity pass), `src/lib/simulator.server.ts` and the simulator route (inventory mode), `src/components/simulator-panel.tsx` (force a stock level), `src/lib/email-templates.server.ts` (reorder alert), `/api/public/cron/daily-digest` (digest lines), `src/components/app-shell.tsx` (nav), `src/lib/schemas.ts` (supplier/override/workspace-default schemas), admin products and entities pages.

## Verification

Using the simulator only: seed fake inventory + simulated orders for the test tenant, set a supplier default and override it at product level, then confirm the SKU resolves with a `P` origin on production lead, lands in AMBER with the expected reorder-by date, sends exactly one alert email, and sends none on a second pass with unchanged state.
