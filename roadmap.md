# Roadmap

## Done
- [x] Sourcing collaborator: hide client-site product URLs (detection, essentials view, "Need more product details" to admin, backfill)

## In progress
- [ ] Product photos on inventory (storage bucket + policies, `products.image_url`)
- [ ] Automatic stock deduction from orders since `stock_set_at`
- [ ] Update `upsert_manual_inventory_item` RPC (image + stock_set_at)
- [ ] `inventory.server.ts`: sold-since deduction + image column
- [ ] `inventory-table.tsx`: thumbnail column
- [ ] `inventory-item-dialog.tsx`: photo upload
- [ ] `inventory.functions.ts`: `image_url` input
