Build a read-only Inventory module in FlySales

## Context

FlySales currently has no inventory module. `products` holds catalogue SKUs, but there are no stock/quantity/warehouse columns and no inventory UI. Per `ARCHITECTURE.md`, the Operations Engine (Middleware/FastAPI) owns inventory; FlySales is meant to read it for display later. This plan implements that "later" display layer while keeping the middleware as the source of truth.

## Goal

Add a lightweight, read-only inventory display to both the client portal and admin console:
- Pull stock levels from the middleware for each connected workspace.
- Store them in a new `inventory_snapshots` table with proper RLS.
- Render a searchable, low-stock-aware inventory page.
- Keep all stock mutations in the middleware; FlySales never writes inventory changes.

## Out of scope

- Stock adjustments, reservations, or warehouse management.
- Replacing the middleware as the inventory source of truth.
- Real-time inventory; the first version uses periodic pull sync.

## Technical plan

### 1. Database schema

Create `public.inventory_snapshots`:

```text
- id uuid primary key default gen_random_uuid()
- store_id uuid not null references public.stores(id) on delete cascade
- sku text not null
- quantity_available numeric not null default 0
- quantity_reserved numeric not null default 0
- fetched_at timestamp with time zone not null
- created_at timestamp with time zone not null default now()
- updated_at timestamp with time zone not null default now()
```

Add a unique partial index on `(store_id, sku)` so each workspace/SKU has one current row.

RLS policies:
- Authenticated users can `SELECT` rows belonging to their own stores.
- Admins can `SELECT` all rows.
- No `INSERT/UPDATE/DELETE` for authenticated; only `service_role` writes.

GRANT `SELECT` to `authenticated`, `ALL` to `service_role`.

### 2. Middleware contract

Extend `src/lib/middleware.server.ts`:

- Add `inventory: "/api/admin/inventory"` to `MIDDLEWARE_PATHS`.
- Define the expected response schema: an array of `{ sku, quantity_available, quantity_reserved }` keyed by tenant.
- Add `syncInventoryForStore(admin, storeId)` that:
  - Looks up the workspace's `middleware_tenant_id`.
  - Calls `GET /api/admin/inventory` with the tenant selector and a stable idempotency key.
  - Upserts rows into `inventory_snapshots` with `fetched_at = now()`.
  - Logs the call in `integration_calls`.
  - Returns counts synced/failed.

### 3. Sync cron + manual trigger

- Add `src/routes/api/public/cron/inventory-sync.ts` secured with `LOVABLE_CRON_SECRET`.
- The cron iterates over active, automatic-mode workspaces with a `middleware_tenant_id` and calls `syncInventoryForStore`.
- Add server functions:
  - `adminInventoryOverview` (admin only): list current snapshots per workspace.
  - `adminSyncInventoryNow` (admin only): sync one workspace or all.

### 4. Simulator support

Extend the middleware simulator so it can serve inventory data for end-to-end testing before the real middleware endpoint exists:
- `GET /api/admin/inventory` returns deterministic stock levels for known SKUs and random stock for unknown ones.
- This lets the cron and UI be verified without a real middleware connection.

### 5. Client UI

Add `src/routes/_authenticated/_client/inventory.tsx`:

- Page header: "Inventory" / "Stock levels from your connected workspace".
- Summary cards: total SKUs tracked, low-stock count (available < 10), last synced at.
- Search by SKU/product name.
- Filter tabs: All / Low stock / Out of stock.
- Dense table columns: SKU, product name (joined from `products`), available, reserved, last updated.
- Empty state with a CTA to connect a workspace if none is automatic.
- Add "Inventory" to `CLIENT_NAV` in `src/components/app-shell.tsx`, between Products and Orders.

### 6. Admin UI

Add `src/routes/_authenticated/admin/inventory.tsx`:

- Page header + summary bar (workspaces connected, SKUs tracked, low-stock SKUs, last global sync).
- Table of workspaces with tenant ID, last sync time, SKU count, sync action per row.
- "Sync all now" primary action.
- Drill-down per workspace showing SKU-level snapshots.
- Add "Inventory" to `ADMIN_NAV` in `src/components/app-shell.tsx`, between Products and Orders.

### 7. Integration with existing pages

- On the client Products page, add a small stock badge next to each SKU when a snapshot exists (optional polish, only if it does not clutter the current layout).

### 8. Design system

Use existing tokens and components:
- Figtree font, electric lime `#A2FF00` accents, pill-shaped badges.
- Shared `PageHeader`, `EmptyState`, table styling from `src/components/admin-ui.tsx` and `app-shell.tsx`.
- No new color values; rely on `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary/10`, etc.

## Files to create / edit

Create:
- `supabase/migrations/<timestamp>_inventory_snapshots.sql`
- `src/routes/api/public/cron/inventory-sync.ts`
- `src/lib/inventory.server.ts`
- `src/lib/inventory.functions.ts`
- `src/routes/_authenticated/_client/inventory.tsx`
- `src/routes/_authenticated/admin/inventory.tsx`

Edit:
- `src/lib/middleware.server.ts` (add path + sync function)
- `src/lib/simulator.server.ts` (add inventory endpoint)
- `src/components/app-shell.tsx` (nav items)
- `src/routes/_authenticated/_client/products.tsx` (optional stock badge)

## Verification

- Typecheck passes (`bunx tsc --noEmit` or `tsgo`).
- Migration applies cleanly.
- Inventory sync cron returns 200 with a valid secret and writes rows.
- Client inventory page renders snapshots and filters correctly.
- Admin page can trigger a manual sync and sees updated counts.
- No authenticated user can `INSERT/UPDATE/DELETE` `inventory_snapshots` directly.
