/**
 * End-to-end verification cleanup.
 *
 * Every E2E run MUST create its data under a store flagged `is_test = true`
 * and named `E2E Store …`, with accounts on `@flysales-test.invalid`, and MUST
 * finish by running this script (`bun scripts/e2e-cleanup.ts`).
 *
 * Money rule: rows that carry financial history (wallet_transactions,
 * documents/receipts, sourcing_earnings) are append-only. Anything they point
 * at is archived and suspended instead of deleted; everything else goes.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required");
const admin = createClient(url, key, { auth: { persistSession: false } });

const now = new Date().toISOString();

async function run() {
  const { data: stores } = await admin
    .from("stores")
    .select("id, entity_id, store_name")
    .eq("is_test", true)
    .ilike("store_name", "E2E Store %");
  const storeIds = (stores ?? []).map((s) => s.id);
  const entityIds = [...new Set((stores ?? []).map((s) => s.entity_id))];
  if (!storeIds.length) return console.log("Nothing to clean.");

  const { data: quotes } = await admin
    .from("quote_requests")
    .select("id")
    .in("store_id", storeIds);
  const quoteIds = (quotes ?? []).map((q) => q.id);

  // Lines still referenced by a commission row stay; the rest go.
  const { data: earnings } = await admin.from("sourcing_earnings").select("quote_line_id");
  const keepLines = new Set((earnings ?? []).map((e) => e.quote_line_id).filter(Boolean));
  if (quoteIds.length) {
    const { data: lines } = await admin
      .from("quote_lines")
      .select("id")
      .in("quote_request_id", quoteIds);
    const drop = (lines ?? []).map((l) => l.id).filter((id) => !keepLines.has(id));
    if (drop.length) await admin.from("quote_lines").delete().in("id", drop);
  }

  await admin.from("notifications").delete().in("entity_id", entityIds);
  await admin.from("sourcing_client_tiers").delete().in("entity_id", entityIds);
  await admin.from("inbound_shipments").delete().in("store_id", storeIds);
  await admin.from("products").delete().in("store_id", storeIds);
  await admin.from("orders").delete().in("store_id", storeIds);

  // Purchases and quotes with no ledger link are deleted, the rest archived.
  const { data: earned } = await admin.from("sourcing_earnings").select("stock_purchase_id");
  const keepPurchases = (earned ?? []).map((e) => e.stock_purchase_id).filter(Boolean) as string[];
  const purchases = admin.from("stock_purchases").delete().in("entity_id", entityIds);
  await (keepPurchases.length ? purchases.not("id", "in", `(${keepPurchases.join(",")})`) : purchases);
  if (keepPurchases.length) {
    await admin.from("stock_purchases").update({ archived_at: now }).in("id", keepPurchases);
  }
  await admin.from("quote_requests").update({ archived_at: now }).in("store_id", storeIds);

  // Accounts / workspaces: hidden and suspended, so ledger rows keep a parent.
  await admin.from("stores").update({ status: "suspended" }).in("id", storeIds);
  const { data: entities } = await admin
    .from("entities")
    .update({ status: "suspended", archived_at: now })
    .in("id", entityIds)
    .select("account_id");
  const accounts = [...new Set((entities ?? []).map((e) => e.account_id))];
  if (accounts.length) {
    await admin
      .from("profiles")
      .update({ status: "suspended", archived_at: now })
      .in("id", accounts);
  }
  await admin.from("sourcing_collaborators").delete().ilike("display_name", "E2E %");

  console.log(
    `Cleaned ${storeIds.length} test workspace(s); archived ${keepPurchases.length} ledger-backed purchase(s).`,
  );
}

void run();
