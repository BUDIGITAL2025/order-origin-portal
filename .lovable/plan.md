# Step 2 of 3 — hierarchy refactor (entity/store business logic)

Status: exploration complete, implementation NOT started. Do NOT apply a partial
migration without updating callers in the same turn.

## DB migration (one file, supabase/migrations/)
1. entities: add stripe_customer_id, default_payment_method_id, auto_topup_enabled,
   auto_topup_threshold, auto_topup_amount; backfill from profiles via account_id.
   guard_entity_update: block client writes to stripe_customer_id + default_payment_method_id
   (auto_topup_* stays client-writable).
2. DROP + CREATE apply_wallet_transaction(p_entity_id uuid, p_type text, p_amount numeric,
   p_description text, p_reference text default null). Lock hashtext(p_entity_id::text);
   balance from wallet_transactions.entity_id; resolve client_id = entity.account_id
   (column still NOT NULL); keep all guards; re-GRANT execute.
3. release_awaiting_payment_orders(p_entity_id) — orders via stores of the entity.
4. ingest_order(p_store_id uuid, ...) — resolve store→entity→account; products matched
   by store_id; wallet debit on entity. (Called by external middleware via RPC.)
5. submit_quote_request: quota from stores (monthly reset per store); add p_store_id;
   caller owns store via entity or is admin; insert client_id = entity.account_id.
6. respond_to_quote_lines: products insert gets store_id = quote.store_id.
7. admin_resolve_order_item: balance/debit via order's store's entity.
8. RLS rewrite (drop client policies, recreate via store→entity→account chain):
   wallet_transactions, quote_requests, products, orders, documents, order_items,
   product_country_prices, bundle_components; recreate view quote_lines_client
   with the store chain. order_fulfillment_items stays admin-only.

## Code callers to update in the SAME turn
- src/lib/billing.server.ts: creditWalletOnce/debitWalletOnce/getWalletBalance keyed
  by entity_id; findProfileByStripeCustomer → findEntityByStripeCustomer;
  syncSubscriptionFromStripe writes stores (match by stripe_subscription_id or
  metadata flysales_store_id); handleWalletTopup credits entity + releases by entity.
- src/lib/billing.functions.ts: overview/checkout/changePlan per store; auto-topup per entity.
- src/lib/wallet.functions.ts: getMyWallet via entity of selected store;
  adminAdjustWallet/adminGetWallet take entity_id (update schemas.ts + admin/wallet.tsx).
- src/lib/quotes.functions.ts: createQuoteRequest passes p_store_id (from store switcher).
- src/lib/documents.server.ts: receipts show entity legal name/address/VAT + originating store.
- src/routes/api/public/cron/auto-topup.ts: iterate entities.
- Provisioning: provision-client → provision-store(store_id).
- UI: store switcher drives quotes/products/orders queries; wallet page entity-scoped;
  billing page one subscription block per store; admin entity detail (stores + shared balance).
