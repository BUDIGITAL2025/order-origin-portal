import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Cleanup rules.
 *
 * Money safety is absolute: anything touched by a wallet transaction, a
 * receipt document or a paid order can never be hard-deleted — it is archived
 * instead. Every hard delete writes one line to `admin_audit_log`, so the
 * cleanup trail survives the rows it removed.
 */

export type CleanupType = "quote" | "product" | "order" | "stock_purchase" | "inbound" | "account";

export type CleanupCheck = {
  type: CleanupType;
  id: string;
  label: string;
  deletable: boolean;
  /** Why a hard delete is refused — shown verbatim in the dialog. */
  blockers: string[];
  /** What a hard delete would remove, listed in the confirmation dialog. */
  cascade: { label: string; count: number }[];
};

// Supabase's generated types can't express a table name chosen at runtime, so
// the query builder is treated as untyped here and re-narrowed by the caller.
type UntypedQuery = { eq: (c: string, v: unknown) => UntypedQuery } & PromiseLike<{
  count: number | null;
  error: { message: string } | null;
}>;

async function countOf(
  admin: Admin,
  table: string,
  build: (q: UntypedQuery) => UntypedQuery,
): Promise<number> {
  const query = (
    admin.from(table as never) as unknown as {
      select: (c: string, o: { count: "exact"; head: boolean }) => UntypedQuery;
    }
  ).select("id", { count: "exact", head: true });
  const { count, error } = await build(query);
  if (error) throw new Error(error.message);
  return count ?? 0;
}


export async function writeAuditLine(
  admin: Admin,
  args: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string | null;
    summary: string;
    detail?: unknown;
  },
): Promise<void> {
  try {
    await admin.from("admin_audit_log").insert({
      actor_id: args.actorId,
      action: args.action,
      entity_type: args.entityType,
      entity_id: args.entityId,
      summary: args.summary.slice(0, 500),
      detail: (args.detail ?? null) as never,
    });
  } catch (e) {
    console.error("[cleanup] failed to write audit line:", e);
  }
}

/* ------------------------------------------------------------------ quotes */

async function checkQuote(admin: Admin, id: string): Promise<CleanupCheck> {
  const { data: quote, error } = await admin
    .from("quote_requests")
    .select("id, product_name, product_url, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!quote) throw new Error("Quote request not found");

  const { data: lines } = await admin
    .from("quote_lines")
    .select("id, status")
    .eq("quote_request_id", id);
  const lineIds = (lines ?? []).map((l) => l.id);
  const accepted = (lines ?? []).filter((l) => l.status === "accepted").length;

  const products = lineIds.length
    ? await countOf(admin, "products", (q) => q.in("quote_line_id", lineIds))
    : 0;
  const purchases = await countOf(admin, "stock_purchases", (q) => q.eq("quote_request_id", id));

  const blockers: string[] = [];
  if (accepted > 0) blockers.push(`${accepted} accepted quote line(s)`);
  if (products > 0) blockers.push(`${products} catalogue product(s) created from it`);
  if (purchases > 0) blockers.push(`${purchases} stock purchase(s) linked to it`);

  return {
    type: "quote",
    id,
    label: quote.product_name || quote.product_url || "Quote request",
    deletable: blockers.length === 0,
    blockers,
    cascade: [{ label: "Quote lines", count: lineIds.length }],
  };
}

async function deleteQuote(admin: Admin, id: string): Promise<void> {
  await admin.from("quote_request_internal").delete().eq("quote_request_id", id);
  await admin.from("quote_lines").delete().eq("quote_request_id", id);
  const { error } = await admin.from("quote_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------------------------------------------------------------- products */

async function checkProduct(admin: Admin, id: string): Promise<CleanupCheck> {
  const { data: product, error } = await admin
    .from("products")
    .select("id, product_name, sku")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) throw new Error("Product not found");

  const orderItems = await countOf(admin, "order_items", (q) => q.eq("product_id", id));
  const purchases = await countOf(admin, "stock_purchases", (q) => q.eq("product_id", id));
  const inboundLines = await countOf(admin, "inbound_shipment_lines", (q) =>
    q.eq("product_id", id),
  );
  const { count: bundleCount } = await admin
    .from("bundle_components")
    .select("id", { count: "exact", head: true })
    .or(`bundle_product_id.eq.${id},component_product_id.eq.${id}`);

  const blockers: string[] = [];
  if (orderItems > 0) blockers.push(`${orderItems} order line(s)`);
  if (purchases > 0) blockers.push(`${purchases} stock purchase(s)`);
  if (inboundLines > 0) blockers.push(`${inboundLines} inbound shipment line(s)`);
  if ((bundleCount ?? 0) > 0) blockers.push(`${bundleCount} bundle link(s)`);

  return {
    type: "product",
    id,
    label: `${product.product_name} (${product.sku})`,
    deletable: blockers.length === 0,
    blockers,
    cascade: [{ label: "Country prices and routes", count: 1 }],
  };
}

async function deleteProduct(admin: Admin, id: string): Promise<void> {
  await admin.from("product_country_prices").delete().eq("product_id", id);
  await admin.from("product_shipping_routes").delete().eq("product_id", id);
  await admin.from("stock_in_prices").delete().eq("product_id", id);
  const { error } = await admin.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ orders */

async function checkOrder(admin: Admin, id: string): Promise<CleanupCheck> {
  const { data: order, error } = await admin
    .from("orders")
    .select("id, external_order_number, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) throw new Error("Order not found");
  return {
    type: "order",
    id,
    label: order.external_order_number || order.id.slice(0, 8),
    deletable: false,
    blockers: ["Orders are never deleted — archive them instead"],
    cascade: [],
  };
}

/* --------------------------------------------------------- stock purchases */

async function checkStockPurchase(admin: Admin, id: string): Promise<CleanupCheck> {
  const { data: sp, error } = await admin
    .from("stock_purchases")
    .select("id, product_name, paid_at, wallet_reference, inbound_shipment_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!sp) throw new Error("Stock purchase not found");

  const documents = await countOf(admin, "documents", (q) =>
    q.eq("payment_reference", sp.wallet_reference ?? "__none__"),
  );

  const blockers: string[] = [];
  if (sp.paid_at) blockers.push("It has been paid");
  if (sp.wallet_reference) blockers.push("It has a wallet movement");
  if (documents > 0) blockers.push(`${documents} receipt(s)`);
  if (sp.inbound_shipment_id) blockers.push("An inbound shipment was created for it");

  return {
    type: "stock_purchase",
    id,
    label: sp.product_name,
    deletable: blockers.length === 0,
    blockers,
    cascade: [],
  };
}

async function deleteStockPurchase(admin: Admin, id: string): Promise<void> {
  const { error } = await admin.from("stock_purchases").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------- inbound shipments */

async function checkInbound(admin: Admin, id: string): Promise<CleanupCheck> {
  const { data: shipment, error } = await admin
    .from("inbound_shipments")
    .select("id, warehouse_reference, status, fee_charged, wallet_reference")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shipment) throw new Error("Inbound shipment not found");

  const lines = await countOf(admin, "inbound_shipment_lines", (q) => q.eq("shipment_id", id));

  const blockers: string[] = [];
  if (shipment.fee_charged != null) blockers.push("A handling fee was charged");
  if (shipment.wallet_reference) blockers.push("It has a wallet movement");
  if (shipment.status === "received" || shipment.status === "completed") {
    blockers.push("Stock was already received into the warehouse");
  }

  return {
    type: "inbound",
    id,
    label: shipment.warehouse_reference,
    deletable: blockers.length === 0,
    blockers,
    cascade: [{ label: "Shipment lines", count: lines }],
  };
}

async function deleteInbound(admin: Admin, id: string): Promise<void> {
  await admin.from("inbound_shipment_lines").delete().eq("shipment_id", id);
  const { error } = await admin.from("inbound_shipments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------------------------------------------------------------- accounts */

async function accountTree(admin: Admin, accountId: string) {
  const { data: entities } = await admin
    .from("entities")
    .select("id, legal_name")
    .eq("account_id", accountId);
  const entityIds = (entities ?? []).map((e) => e.id);
  const { data: stores } = entityIds.length
    ? await admin.from("stores").select("id, store_name").in("entity_id", entityIds)
    : { data: [] as { id: string; store_name: string | null }[] };
  const storeIds = (stores ?? []).map((s) => s.id);
  return { entityIds, storeIds, entities: entities ?? [], stores: stores ?? [] };
}

async function checkAccount(admin: Admin, accountId: string): Promise<CleanupCheck> {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, contact_name")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error("Account not found");

  const { entityIds, storeIds, entities, stores } = await accountTree(admin, accountId);

  const wallet = entityIds.length
    ? await countOf(admin, "wallet_transactions", (q) => q.in("entity_id", entityIds))
    : 0;
  const documents = entityIds.length
    ? await countOf(admin, "documents", (q) => q.in("entity_id", entityIds))
    : 0;
  const paidOrders = storeIds.length
    ? await countOf(admin, "orders", (q) => q.in("store_id", storeIds).not("paid_at", "is", null))
    : 0;

  const quotes = storeIds.length
    ? await countOf(admin, "quote_requests", (q) => q.in("store_id", storeIds))
    : 0;
  const products = storeIds.length
    ? await countOf(admin, "products", (q) => q.in("store_id", storeIds))
    : 0;
  const orders = storeIds.length
    ? await countOf(admin, "orders", (q) => q.in("store_id", storeIds))
    : 0;

  const blockers: string[] = [];
  if (wallet > 0) blockers.push(`${wallet} wallet movement(s)`);
  if (documents > 0) blockers.push(`${documents} receipt(s)`);
  if (paidOrders > 0) blockers.push(`${paidOrders} paid order(s)`);

  return {
    type: "account",
    id: accountId,
    label: entities[0]?.legal_name || profile.contact_name || "Account",
    deletable: blockers.length === 0,
    blockers,
    cascade: [
      { label: "Companies", count: entities.length },
      { label: "Workspaces", count: stores.length },
      { label: "Quote requests", count: quotes },
      { label: "Products", count: products },
      { label: "Orders (unpaid)", count: orders },
    ],
  };
}

async function deleteAccount(admin: Admin, accountId: string): Promise<void> {
  const { entityIds, storeIds } = await accountTree(admin, accountId);

  if (storeIds.length) {
    const { data: orders } = await admin.from("orders").select("id").in("store_id", storeIds);
    const orderIds = (orders ?? []).map((o) => o.id);
    if (orderIds.length) {
      await admin.from("order_items").delete().in("order_id", orderIds);
      await admin.from("order_fulfillment_items").delete().in("order_id", orderIds);
      await admin.from("orders").delete().in("id", orderIds);
    }

    const { data: shipments } = await admin
      .from("inbound_shipments")
      .select("id")
      .in("store_id", storeIds);
    const shipmentIds = (shipments ?? []).map((s) => s.id);
    if (shipmentIds.length) {
      await admin.from("inbound_shipment_lines").delete().in("shipment_id", shipmentIds);
    }
    await admin.from("stock_purchases").delete().in("store_id", storeIds);
    if (shipmentIds.length) await admin.from("inbound_shipments").delete().in("id", shipmentIds);

    const { data: products } = await admin.from("products").select("id").in("store_id", storeIds);
    const productIds = (products ?? []).map((p) => p.id);
    if (productIds.length) {
      await admin
        .from("bundle_components")
        .delete()
        .or(
          `bundle_product_id.in.(${productIds.join(",")}),component_product_id.in.(${productIds.join(",")})`,
        );
      await admin.from("product_country_prices").delete().in("product_id", productIds);
      await admin.from("product_shipping_routes").delete().in("product_id", productIds);
      await admin.from("stock_in_prices").delete().in("product_id", productIds);
    }

    const { data: quotes } = await admin
      .from("quote_requests")
      .select("id")
      .in("store_id", storeIds);
    const quoteIds = (quotes ?? []).map((q) => q.id);
    if (quoteIds.length) {
      await admin.from("quote_request_internal").delete().in("quote_request_id", quoteIds);
      await admin.from("quote_lines").delete().in("quote_request_id", quoteIds);
    }
    if (productIds.length) await admin.from("products").delete().in("id", productIds);
    if (quoteIds.length) await admin.from("quote_requests").delete().in("id", quoteIds);

    await admin.from("manual_stock_levels").delete().in("store_id", storeIds);
    await admin.from("inventory_snapshots").delete().in("store_id", storeIds);
    await admin.from("sku_velocity").delete().in("store_id", storeIds);
    await admin.from("sku_alert_state").delete().in("store_id", storeIds);
    await admin.from("middleware_sync_state").delete().in("store_id", storeIds);
    await admin.from("notifications").delete().in("store_id", storeIds);
    await admin.from("stores").delete().in("id", storeIds);
  }

  if (entityIds.length) {
    await admin.from("notifications").delete().in("entity_id", entityIds);
    await admin.from("spymarket_interest").delete().in("entity_id", entityIds);
    await admin.from("order_batch_payments").delete().in("entity_id", entityIds);
    await admin.from("entities").delete().in("id", entityIds);
  }

  await admin.from("spymarket_interest").delete().eq("account_id", accountId);
  await admin.from("user_roles").delete().eq("user_id", accountId);
  await admin.from("profiles").delete().eq("id", accountId);
  await admin.auth.admin.deleteUser(accountId);
}

/* ------------------------------------------------------------------ router */

export async function runCleanupCheck(
  admin: Admin,
  type: CleanupType,
  id: string,
): Promise<CleanupCheck> {
  switch (type) {
    case "quote":
      return checkQuote(admin, id);
    case "product":
      return checkProduct(admin, id);
    case "order":
      return checkOrder(admin, id);
    case "stock_purchase":
      return checkStockPurchase(admin, id);
    case "inbound":
      return checkInbound(admin, id);
    case "account":
      return checkAccount(admin, id);
  }
}

export async function runCleanupDelete(admin: Admin, type: CleanupType, id: string): Promise<void> {
  switch (type) {
    case "quote":
      return deleteQuote(admin, id);
    case "product":
      return deleteProduct(admin, id);
    case "stock_purchase":
      return deleteStockPurchase(admin, id);
    case "inbound":
      return deleteInbound(admin, id);
    case "account":
      return deleteAccount(admin, id);
    case "order":
      throw new Error("Orders are never deleted — archive them instead");
  }
}

/** Table + primary key for the archive flag of each cleanup type. */
export const ARCHIVE_TARGET: Record<CleanupType, { table: string; column: string }> = {
  quote: { table: "quote_requests", column: "id" },
  product: { table: "products", column: "id" },
  order: { table: "orders", column: "id" },
  stock_purchase: { table: "stock_purchases", column: "id" },
  inbound: { table: "inbound_shipments", column: "id" },
  account: { table: "profiles", column: "id" },
};
