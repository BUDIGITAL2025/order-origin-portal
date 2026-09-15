# Roadmap

- [x] FX foundation: fx_rates + daily fetch (frankfurter), currency selector on sourcing lines, rate frozen on the quote, USD-only for clients.
- [x] Spreadsheet import: XLSX/CSV in Catalog import, column-mapping step, unavailable flag, commission-column notice.
- [x] Collaborators remove action (Admin → Sourcing team → Collaborators) — verified already in place.
- [x] Load Quotation_Summary_091426.xlsx as 23 draft requests / 31 variants for Gato Preto.
- [x] Quote queue pricing ranges, client-price sorting, and awaiting-pricing summary.
- [x] Matching Agent fee / Margin controls and aligned USD pricing chain.

## Security: EXPOSED_SENSITIVE_DATA (quote_options.internal_notes)
- [x] Remove internal_notes (and all cost/fee/margin/supplier fields) from client-readable paths; clients read published options via SECURITY DEFINER function/view with client-safe columns only
- [x] Audit every quote_options column: which are client-exposed
- [x] Sweep sibling client-readable tables (quote_requests/quote_lines, products, orders/order_items) for internal-only columns
- [x] Re-run security scan, confirm cleared, confirm publish safe

## Post-acceptance flow + pricing bases + per-client fee tiers
- [x] Margin base = COGS (USD) only; chain summary labels the bases and hides zero rows
- [x] Acceptance creates one purchase per accepted variant in `awaiting_payment` (invisible to the agent)
- [x] Payment is the trigger: paid purchases appear in the agent queue (WORKFLOW_STATUSES already excluded awaiting_payment)
- [x] Operations Today: "Awaiting payment" (with days waiting) + "Supplier payments due"
- [x] Unpaid purchases: day-3 reminder, auto-expire at day 7 (cron flysales-purchase-expiry), quote stays valid
- [x] EXW POs state collection by the client's forwarder; warehouse POs carry the address only; fulfilment creates the inbound on shipment
- [x] Fee tiers per (agent, client account): sourcing_client_tiers table, frozen at quoting time, bumped on settled payment
- [x] Tier visibility: agent desk per client, quote-form chip, admin sourcing team list; invite email text updated
- [ ] End-to-end walk in a live workspace (accept → pay → PO → invoice) — needs a real client account to avoid creating test data in production
