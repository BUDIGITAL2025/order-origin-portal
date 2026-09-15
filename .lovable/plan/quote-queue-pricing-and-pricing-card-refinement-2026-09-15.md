# Quote queue pricing and pricing-card refinement

## Goal
Make quote economics scannable from the admin queue and make fee/margin editing clearer inside each variant pricing cell, without changing any saved quote values.

## Changes

### 1. Quote queue pricing
- Extend the existing admin quote-list response with aggregated quote-line pricing data.
- For every quote, calculate:
  - converted COGS range in USD from saved `supplier_cogs` values;
  - client-price range from saved/computed line prices only when margin is greater than zero;
  - whether the quote has COGS but still awaits margin.
- Render dense, right-aligned **COGS (USD)** and **Client price** columns with two decimals.
- Collapse equal minimum/maximum values to one amount; otherwise show a range.
- Show `—` and a muted `not priced` label when no margin has been set.
- Add client-price sorting with a compact sortable column header; unpriced quotes remain grouped after priced quotes.
- Add **Awaiting pricing** to the queue summary bar.
- Preserve the current open-detail action and all bulk-selection behavior.

### 2. Pricing card controls and chain
- Move **Agent fee %** and **Margin %** into matching labeled controls above the calculation summary, side by side when width permits.
- Give both inputs the same width, styling, decimal behavior, and two-decimal normalization on blur.
- Show the calculated dollar amount beside each percentage field.
- Keep the agent tier context attached to the fee control.
- Replace the current mixed summary with a consistently aligned two-column calculation table:
  - COGS + ship (USD)
  - Agent fee (`rate · amount`)
  - Sourcing cost with medium emphasis
  - FlySales margin (`rate · amount`)
  - Tax passthrough
  - CLIENT PRICE with a subtle separator and stronger value styling
- Remove the margin spinner from inside the summary.

## Technical notes
- Reuse the existing shared pricing formulas and saved USD quote-line fields; no migration or pricing-rule change is required.
- Keep all displayed money at exactly two decimals and use semantic design tokens.
- Update the queue sort state locally so existing status filtering and urgency ordering remain the default.
- Validate with focused type checks and a signed-in browser check of both the queue and one imported multi-variant quote.
