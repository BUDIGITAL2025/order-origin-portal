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
