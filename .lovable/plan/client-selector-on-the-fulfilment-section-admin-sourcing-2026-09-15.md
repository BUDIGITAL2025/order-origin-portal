# Client selector on the Fulfilment section (Admin + Sourcing)

A workspace dropdown sits above the Products / Orders / Inventory / Inbound sub-tabs, styled like the Workspace picker in the client view. The choice sticks while you move between the four sub-tabs in the same session. The client view is untouched.

## Admin

- Dropdown lists "All clients" (default) plus every workspace in the system.
- Picking one filters Products, Orders, Inventory and Inbound to that workspace; "All clients" restores today's aggregated view.

## Sourcing

The agent already has an explicit assignment field: quote requests carry `assigned_sourcer`, and the priced lines carry `sourced_by`. So ownership is read from the real assignment, not guessed from history — a client counts as theirs when they are the assigned sourcer on a request for that workspace, or they priced a line that became one of its products.

- The Fulfilment section becomes reachable from the sourcing desk, scoped server-side to those workspaces only.
- Their dropdown shows "All my clients" plus only their own workspaces. A workspace that is not theirs is not listed and is not returned by the server, even by direct call.
- The section is read-only for them: admin-only actions (confirm inbound receipt, refuse, set weights, set fulfilment model, wallet-affecting steps) stay hidden and stay refused on the server. Tracking and the operational reads they need remain visible.
- Commercial figures already walled from agents stay walled: the orders list shows status, destination and tracking for their clients, not client totals.

## Persistence

The selection lives in one shared React context backed by `sessionStorage`, so switching sub-tabs — or reloading the tab — keeps the filter, and a new session starts back at "All".

## Technical notes

- New `src/components/workspace-scope.tsx`: `WorkspaceScopeProvider` (sessionStorage-backed, mounted in `src/routes/__root.tsx`), `useWorkspaceScope()`, and a `<WorkspacePicker>` rendered above `SectionTabs` on the four pages.
- New `src/lib/fulfilment-scope.server.ts`: `allowedStoresForCaller(supabase, userId)` → `{ isAdmin, storeIds | null }`. For an agent it resolves workspaces from `quote_requests.assigned_sourcer` plus `products → quote_lines.sourced_by`.
- `adminListFulfilmentCatalog`, `adminListOrders`, `getAdminInventory`, `adminListInboundShipments` swap `requireStaffRead`/`requireAdmin` for the shared scope helper and filter their store list by it; `adminListOrders` also selects `store_id` so the UI can filter. Mutations keep their current admin guards.
- New `deskFulfilmentWorkspaces` list feeding the dropdown (admin: all stores; agent: their own).
- `src/routes/_authenticated/admin.tsx`: the four fulfilment routes join `SOURCING_ALLOWED`; `src/components/section-tabs.tsx` gains the tab list for the desk shell and the desk sidebar gets a Fulfilment entry.
- Pages read `isAdmin` from the existing context to hide admin-only actions.

## Verification

As admin: pick Gato Preto and confirm all four sub-tabs narrow to it, that the choice survives tab switching and a reload, and that "All clients" restores the full view. As the agent: only their own workspaces are listed, another client's workspace id passed directly to each endpoint returns nothing, and no admin-only action is available.
