# Roadmap

## Done
- [x] Sourcing collaborator: hide client-site product URLs (detection, essentials view, "Need more product details" to admin, backfill)
- [x] Product photos on inventory (private storage area + access rules, `products.image_url`, thumbnails, upload in the item dialog)
- [x] Automatic stock deduction from orders placed after the last manual count
- [x] Inventory saver updated (photo + stock timestamp)
- [x] Ecomflow live-stock tab on admin Inventory page
- [x] Go-live switch prepared: single master flag (src/lib/stripe-mode.ts), price catalogue (src/lib/price-ids.ts), admin Test/Live chip, mode line in daily digest, live webhook events fixed (top-ups + refunds), invoice.paid handled for receipts

## Open
- [ ] Optional: enable public file links in Settings → Privacy & Security if permanent photo URLs are preferred (currently temporary signed links)
- [ ] Blocked on user: flip STRIPE_FORCE_TEST_MODE to false (Flavio does this manually)
- [ ] After the next publish: confirm the live account has the `flysales_basic` ($49) and `module_*` prices — they are created in test and copied to live on publish
- [x] SpyMarket price resolved: legacy $99/$189/$349 tiers archived in Stripe (test + live); single module price `module_spymarket_monthly` $49/mo
