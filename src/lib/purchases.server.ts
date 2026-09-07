/**
 * Stock purchases — server-only helpers.
 *
 * A stock purchase is what a client buys after accepting a quote:
 *   PATH A "flysales" — stock ships to our warehouse, an inbound shipment is
 *                       created automatically on payment.
 *   PATH B "direct"   — stock ships to the client's own address; admin quotes
 *                       freight first, then the client pays the full total.
 *
 * Money always moves through the existing wallet path, idempotent on
 * `purchase:<id>`, so a replayed payment can never double-charge.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { round2 } from "./admin.server";

type Admin = SupabaseClient<Database>;
export type StockPurchase = Database["public"]["Tables"]["stock_purchases"]["Row"];

/** Short human reference used in the UI, receipts and emails. */
export function purchaseRef(id: string): string {
  return `SP-${id.slice(0, 8).toUpperCase()}`;
}

export function purchaseWalletReference(id: string): string {
  return `purchase:${id}`;
}

/** What the client owes right now — null while freight is still pending. */
export function purchaseTotal(p: {
  path: string;
  goods_total: number | string;
  freight_cost: number | string | null;
}): number | null {
  const goods = Number(p.goods_total);
  if (p.path === "flysales") return round2(goods);
  if (p.freight_cost == null) return null;
  return round2(goods + Number(p.freight_cost));
}

export function isPayable(p: StockPurchase): boolean {
  if (p.status !== "requested" && p.status !== "freight_quoted") return false;
  return purchaseTotal(p) != null;
}

/** Human-readable timeline steps, in order, for the client and admin views. */
export const PURCHASE_STEPS: Record<string, string[]> = {
  flysales: ["requested", "paid", "in_production", "shipped", "delivered"],
  direct: ["requested", "freight_quoted", "paid", "in_production", "shipped", "delivered"],
};

export const PURCHASE_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  freight_quoted: "Freight quoted",
  paid: "Paid",
  in_production: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * PATH A only: create the inbound shipment for a paid purchase. Marked
 * `flysales_sourced` — our sourcing team coordinates the labels with the
 * supplier and adds tracking; every existing inbound rule (counting, the
 * $0.50/pc service fee, optional QC, receipt, stock into inventory) then
 * applies unchanged on arrival.
 */
export async function createInboundForPurchase(
  admin: Admin,
  purchase: StockPurchase,
): Promise<string | null> {
  if (purchase.path !== "flysales") return null;
  if (purchase.inbound_shipment_id) return purchase.inbound_shipment_id;

  const { data: shipment, error } = await admin
    .from("inbound_shipments")
    .insert({
      store_id: purchase.store_id,
      entity_id: purchase.entity_id,
      qc: false,
      declared_pieces: purchase.quantity,
      source: "flysales_sourced",
      stock_purchase_id: purchase.id,
      created_by: purchase.created_by,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineError } = await admin.from("inbound_shipment_lines").insert({
    shipment_id: shipment.id,
    product_id: purchase.product_id,
    sku: purchase.sku ?? purchaseRef(purchase.id),
    product_name: purchase.variant_label
      ? `${purchase.product_name} — ${purchase.variant_label}`
      : purchase.product_name,
    declared_qty: purchase.quantity,
  });
  if (lineError) throw new Error(lineError.message);

  await admin
    .from("stock_purchases")
    .update({ inbound_shipment_id: shipment.id })
    .eq("id", purchase.id);
  return shipment.id;
}

/**
 * Everything that must happen once a purchase is paid: stamp it, create the
 * inbound (path A), issue the receipt and accrue the collaborator's fee.
 * Safe to call twice — every step is idempotent.
 */
export async function settlePaidPurchase(
  admin: Admin,
  purchaseId: string,
  total: number,
): Promise<StockPurchase> {
  const { data: fresh, error } = await admin
    .from("stock_purchases")
    .select("*")
    .eq("id", purchaseId)
    .single();
  if (error) throw new Error(error.message);

  const paidAt = fresh.paid_at ? new Date(fresh.paid_at) : new Date();
  let purchase = fresh;
  if (fresh.status !== "paid" && fresh.paid_at == null) {
    const { data: updated } = await admin
      .from("stock_purchases")
      .update({
        status: "paid",
        paid_at: paidAt.toISOString(),
        total_amount: total,
        wallet_reference: purchaseWalletReference(purchaseId),
      })
      .eq("id", purchaseId)
      .select("*")
      .single();
    if (updated) purchase = updated;
  }

  if (purchase.path === "flysales") {
    try {
      await createInboundForPurchase(admin, purchase);
    } catch (e) {
      console.error("inbound creation failed for purchase", purchaseId, e);
    }
  }

  try {
    const { issueStockPurchaseReceipt } = await import("./documents.server");
    await issueStockPurchaseReceipt(admin, {
      entityId: purchase.entity_id,
      storeId: purchase.store_id,
      reference: purchaseWalletReference(purchaseId),
      purchaseRef: purchaseRef(purchaseId),
      productName: purchase.variant_label
        ? `${purchase.product_name} — ${purchase.variant_label}`
        : purchase.product_name,
      quantity: purchase.quantity,
      unitPrice: Number(purchase.unit_price),
      goodsTotal: Number(purchase.goods_total),
      freightCost: purchase.freight_cost != null ? Number(purchase.freight_cost) : null,
      total,
      paidAt,
      path: purchase.path,
    });
  } catch (e) {
    console.error("stock purchase receipt failed", purchaseId, e);
  }

  if (purchase.sourced_by && purchase.supplier_unit_price && purchase.sourcing_fee_rate) {
    try {
      const { accrueSourcingEarning } = await import("./sourcing.server");
      await accrueSourcingEarning(admin, {
        collaboratorUserId: purchase.sourced_by,
        reference: `purchase:${purchaseId}`,
        description: `Commission on stock purchase ${purchaseRef(purchaseId)}`,
        units: purchase.quantity,
        feeRate: Number(purchase.sourcing_fee_rate),
        supplierUnitPrice: Number(purchase.supplier_unit_price),
        quoteLineId: purchase.quote_line_id,
        stockPurchaseId: purchaseId,
      });
    } catch (e) {
      console.error("earnings accrual failed for purchase", purchaseId, e);
    }
  }

  return purchase;
}
