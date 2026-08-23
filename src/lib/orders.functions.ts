import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createManualOrderSchema,
  importManualOrdersSchema,
  orderTrackingSchema,
  storeIdSchema,
} from "./schemas";

/** Map DB error codes from the manual-order RPCs to client-readable text. */
function toManualOrderError(message: string): Error {
  if (message.includes("UNKNOWN_SKU")) {
    return new Error(message.replace("UNKNOWN_SKU:", "Unknown SKU:"));
  }
  if (message.includes("COUNTRY_NOT_PRICED")) {
    return new Error(message.replace("COUNTRY_NOT_PRICED:", "Not priced:"));
  }
  if (message.includes("STORE_NOT_FOUND")) {
    return new Error("Workspace not found — pick one of your workspaces.");
  }
  return new Error(message);
}

/**
 * Client: the orderable catalogue of one workspace — active products with
 * their per-country prices (simple) and effective bundle prices. Drives the
 * manual "Create order" picker.
 */
export const listMyCatalogue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => storeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: products, error } = await context.supabase
      .from("products")
      .select("id, sku, product_name, variant_label, product_type, moq")
      .eq("store_id", data.store_id)
      .eq("status", "active")
      .order("product_name", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: countryPrices, error: pricesError } = await context.supabase
      .from("product_country_prices")
      .select("product_id, country_code, unit_price, lead_time_days")
      .in("product_id", (products ?? []).map((p) => p.id));
    if (pricesError) throw new Error(pricesError.message);

    const { data: bundlePrices, error: bundleError } = await context.supabase
      .from("bundle_prices")
      .select("bundle_product_id, country_code, effective_price, max_lead_time_days")
      .in("bundle_product_id", (products ?? []).map((p) => p.id));
    if (bundleError) throw new Error(bundleError.message);

    return {
      products: products ?? [],
      countryPrices: countryPrices ?? [],
      bundlePrices: bundlePrices ?? [],
    };
  });

/**
 * Client: create one manual order (Mode B). Priced from the workspace
 * catalogue; paid from the entity wallet when it covers the total, else the
 * order lands in awaiting_payment. Idempotent on client_reference.
 */
export const createMyManualOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createManualOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase.rpc("create_manual_order", {
      p_store_id: data.store_id,
      p_customer: data.customer,
      p_shipping: data.address,
      ...(data.client_reference ? { p_client_reference: data.client_reference } : {}),
      p_lines: data.lines,
    });
    if (error) throw toManualOrderError(error.message);
    return { ok: true, order };
  });

/**
 * Client: bulk CSV import, all-or-nothing. Rows arrive pre-grouped into
 * orders; the DB validates every group and aborts the whole import on the
 * first failure.
 */
export const importMyManualOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => importManualOrdersSchema.parse(input))
  .handler(async ({ data, context }) => {
    const payload = data.orders.map((o) => ({
      client_reference: o.client_reference || null,
      customer: o.customer,
      shipping: o.address,
      lines: o.lines,
    }));
    const { data: created, error } = await context.supabase.rpc("import_manual_orders", {
      p_store_id: data.store_id,
      p_orders: payload,
    });
    if (error) throw toManualOrderError(error.message);
    return { ok: true, orders: created ?? [] };
  });

/** Admin: recent orders across all workspaces, for tracking entry. */
export const adminListOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data, error } = await admin
      .from("orders")
      .select(
        "id, external_order_number, status, total_amount, destination_country, tracking_number, tracking_carrier, shipped_at, created_at, stores(store_name, entities(legal_name))",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { orders: data ?? [] };
  });

/**
 * Admin: set tracking on an order. Marks it shipped when it was still in
 * fulfilment and emails the client the first time tracking appears.
 */
export const adminSetOrderTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderTrackingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: order, error: readError } = await admin
      .from("orders")
      .select(
        "id, external_order_number, status, tracking_number, tracking_notified_at, stores(store_name, entities(account_id))",
      )
      .eq("id", data.order_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!order) throw new Error("Order not found");

    const firstTracking = !order.tracking_number;
    const update: import("@/integrations/supabase/types").Database["public"]["Tables"]["orders"]["Update"] =
      {
        tracking_number: data.tracking_number,
        tracking_carrier: data.tracking_carrier,
      };
    if (order.status === "paid" || order.status === "processing") {
      update["status"] = "shipped";
    }
    const { error } = await admin.from("orders").update(update).eq("id", order.id);
    if (error) throw new Error(error.message);

    // Email the client exactly once — the first time tracking appears.
    if (firstTracking && !order.tracking_notified_at) {
      const accountId = (
        order.stores as { entities?: { account_id?: string | null } | null } | null
      )?.entities?.account_id;
      if (accountId) {
        const { sendClientEmail } = await import("./email.server");
        await sendClientEmail(admin, {
          clientId: accountId,
          subject: `Your order ${order.external_order_number ?? ""} has shipped`,
          text: `Order ${order.external_order_number ?? order.id} is on its way.\nCarrier: ${data.tracking_carrier}\nTracking: ${data.tracking_number}`,
        });
        await admin
          .from("orders")
          .update({ tracking_notified_at: new Date().toISOString() })
          .eq("id", order.id);
      }
    }
    return { ok: true };
  });

/** Client: my orders with their items, newest first. RLS scopes to the caller. */
export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select(
        "id, external_order_number, status, payment_method, total_amount, destination_country, paid_at, created_at, order_items(id, sku, quantity, unit_price, line_total)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Client: one order in detail, with the data the dispute UI needs — the
 * longest quoted lead time for the destination country (drives the estimated
 * delivery date for not_delivered eligibility) and any existing disputes.
 * RLS scopes every read to the caller's own stores.
 */
export const getMyOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("orders")
      .select(
        "id, external_order_number, status, payment_method, total_amount, destination_country, shipping_address, paid_at, shipped_at, delivered_at, created_at, store_id, order_items(id, sku, product_id, quantity, unit_price, line_total)",
      )
      .eq("id", data.order_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");

    const productIds = (order.order_items ?? [])
      .map((item) => item.product_id)
      .filter((id): id is string => typeof id === "string");
    let maxLeadTimeDays: number | null = null;
    if (productIds.length > 0 && order.destination_country) {
      const { data: prices, error: priceError } = await context.supabase
        .from("product_country_prices")
        .select("lead_time_days")
        .in("product_id", productIds)
        .eq("country_code", order.destination_country);
      if (priceError) throw new Error(priceError.message);
      for (const row of prices ?? []) {
        if (row.lead_time_days != null) {
          maxLeadTimeDays = Math.max(maxLeadTimeDays ?? 0, row.lead_time_days);
        }
      }
    }

    const { data: disputes, error: disputeError } = await context.supabase
      .from("disputes")
      .select("id, reason, status, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false });
    if (disputeError) throw new Error(disputeError.message);

    return { order, maxLeadTimeDays, disputes: disputes ?? [] };
  });
