# Pricing form + quote queue corrections

Six connected corrections across the quote pricing chain, the quote queue and stock purchases.

## 1. Status colours

Give each quote status its own colour, used everywhere a quote status chip appears (admin queue, sourcing desk, client quote list and detail):

- Received (submitted): neutral grey
- Sourcing: blue
- Quoted: purple
- Published/Closed: green
- Expired: muted

A purple token pair is added to the theme (light + dark) so the chip follows the design system instead of a hardcoded colour.

## 2. Sourcing fee visible and editable

On the owner's pricing screen the fee rate becomes an editable percentage per variant line, pre-filled from the collaborator's configured rate (8%). Editing it recomputes the whole chain live: fee, sourcing cost, margin, client price.

Lines where the fee is already inside the supplier cost (the six Gato Preto quotes) show 0% with a "fee included in cost" note and stay editable. The fee is applied once only — a fee-included line never adds a second fee.

Publishing saves the adjusted rate and recomputes the stored sourcing cost and client price server-side, so what the client sees always matches the edited chain.

## 3. COGS is EXW

Field relabelled "COGS (EXW)" in both the sourcing desk and the owner view, with helper text: "Supplier unit price Ex Works — excludes all freight. Per-order shipping goes in Ship; bulk freight is quoted on the purchase."

## 4. IOSS / import per unit

Field relabelled "IOSS / import per unit", staying strictly per-unit with the $3.50 EU default. Helper text points bulk/MOQ import costs to the freight quote on the purchase.

## 5. Stock purchases — freight quote on both paths

- A new import/duties cost line is added alongside freight; both are passthrough and never marked up.
- PATH A (to our fulfilment centre) now also waits for a freight quote before payment, exactly like PATH B: purchase lands as freight pending, admin enters freight + import/duties, client sees goods + freight + import = final total, pays from wallet (cover-the-difference unchanged), and only then does the inbound shipment auto-create as today.
- PATH B keeps its flow and gains the separate import/duties line.
- The client purchase timeline shows the freight-quote step on both paths; the admin freight dialog takes both amounts and shows the resulting total.
- Receipts list freight and import/duties as separate lines.

## 6. Valid until defaults to 7 days

Publishing with the valid-until field empty sets it to 7 days from publish. The field shows the placeholder "default: 7 days". Expiry behaviour is otherwise unchanged.

## Technical notes

- Migration: add `import_cost` (numeric, nullable) to `stock_purchases`; no destructive changes.
- `purchaseTotal` becomes goods + freight + import for both paths, returning null while freight is pending on either path, so `isPayable` gates PATH A the same way it already gates PATH B.
- `publishQuoteSchema` gains an optional `fee_rate_pct` per line; `adminPublishQuote` recomputes `sourcing_cost` via the shared `src/lib/pricing.ts` helpers before pricing, respecting `fee_included`.
- `freightQuoteSchema` gains `import_cost`; `adminQuoteFreight` drops the direct-only guard.
- Status colours live in `src/components/status-badges.tsx` plus a `--purple` token in `src/styles.css`.

## Verification

Publish a test quote with an empty valid-until and confirm it lands at +7 days; edit a fee percentage and confirm the chain recomputes; run a PATH A purchase through freight pending, quoted, paid and confirm the inbound shipment is created.
