import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getClientOrderAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const since60 = new Date(Date.now() - 60 * 86400000).toISOString();

    const { data: orders90 } = await context.supabase
      .from("orders")
      .select("id, created_at, destination_country, status")
      .eq("store_id", data.storeId)
      .not("status", "in", "(cancelled,awaiting_payment)")
      .gte("created_at", since90);

    const { data: itemsRows } = await context.supabase
      .from("order_items")
      .select("sku, quantity, orders!inner(store_id, created_at, status)")
      .eq("orders.store_id", data.storeId)
      .gte("orders.created_at", since30)
      .not("orders.status", "in", "(cancelled,awaiting_payment)");

    const { data: products } = await context.supabase
      .from("products")
      .select("sku, product_name")
      .eq("store_id", data.storeId);
    const nameBySku = new Map((products ?? []).map((p) => [p.sku, p.product_name]));

    // Best sellers: sum quantity by sku, top 5
    const unitsBySku = new Map<string, number>();
    for (const row of itemsRows ?? []) {
      unitsBySku.set(row.sku, (unitsBySku.get(row.sku) ?? 0) + row.quantity);
    }
    const bestSellers = [...unitsBySku.entries()]
      .map(([sku, units]) => ({ sku, units, product_name: nameBySku.get(sku) ?? sku }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);

    // Avg daily orders: last 30d vs previous 30d
    const last30 = (orders90 ?? []).filter((o) => o.created_at >= since30);
    const prev30 = (orders90 ?? []).filter((o) => o.created_at >= since60 && o.created_at < since30);
    const avgDailyOrders = last30.length / 30;
    const avgDailyOrdersPrev = prev30.length / 30;
    const pctChange = avgDailyOrdersPrev > 0
      ? ((avgDailyOrders - avgDailyOrdersPrev) / avgDailyOrdersPrev) * 100
      : null;

    // Top countries: from last 90 days
    const countryCounts = new Map<string, number>();
    for (const o of orders90 ?? []) {
      const c = o.destination_country ?? "Unknown";
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
    const totalOrders = orders90?.length ?? 0;
    const topCountries = [...countryCounts.entries()]
      .map(([country, count]) => ({ country, count, pct: totalOrders > 0 ? (count / totalOrders) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Order dates for the sparkline (last 30 days)
    const orderDates = last30.map((o) => o.created_at);

    return { avgDailyOrders, pctChange, bestSellers, topCountries, totalOrders, orderDates };
  });
