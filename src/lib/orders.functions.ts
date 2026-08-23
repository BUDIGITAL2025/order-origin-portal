import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
