/**
 * EcomFlow server functions — admin-only live stock view.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getEcomflowStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const { fetchAllEcomflowSkus, fetchAllEcomflowStockHealth } = await import("./ecomflow.server");
    const [skus, health] = await Promise.all([fetchAllEcomflowSkus(), fetchAllEcomflowStockHealth()]);

    const healthBySku = new Map(health.map((h) => [(h as { sku: string }).sku, h]));

    return skus.map((s) => {
      const h = healthBySku.get((s as { sku: string }).sku);
      return {
        sku: (s as { sku: string }).sku,
        title: (s as { title?: string }).title ?? "—",
        available: Number((s as { available?: number }).available ?? 0),
        committed: Number((s as { committed?: number }).committed ?? 0),
        total: Number((s as { total?: number }).total ?? 0),
        incoming: Number((s as { incoming?: number }).incoming ?? 0),
        shopifySku: (s as { shopifySku?: string }).shopifySku ?? null,
        updatedAt: (s as { updatedAt?: string }).updatedAt ?? null,
        runwayDays: (h as { runwayDays?: number | null })?.runwayDays ?? null,
        avgDailySales: (h as { avgDailySales?: number | null })?.avgDailySales ?? null,
        status: (h as { status?: string | null })?.status ?? null,
        isAccelerating: Boolean((h as { isAccelerating?: boolean })?.isAccelerating),
      };
    });
  });

export const getEcomflowAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const {
      fetchEcomflowStockHealthSummary, fetchEcomflowTopProducts,
      fetchEcomflowActiveOrders, fetchEcomflowTopCountries,
    } = await import("./ecomflow.server");
    const to = new Date().toISOString();
    const from30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const from60 = new Date(Date.now() - 60 * 86400000).toISOString();

    const [summary, topProducts, activeOrders30, activeOrdersPrev30, topCountries] = await Promise.all([
      fetchEcomflowStockHealthSummary(),
      fetchEcomflowTopProducts(from30, to),
      fetchEcomflowActiveOrders(from30, to),
      fetchEcomflowActiveOrders(from60, from30),
      fetchEcomflowTopCountries(from30, to),
    ]);

    const avgDailyOrders = activeOrders30.totalActiveOrders / 30;
    const avgDailyOrdersPrev = activeOrdersPrev30.totalActiveOrders / 30;
    const pctChange = avgDailyOrdersPrev > 0
      ? ((avgDailyOrders - avgDailyOrdersPrev) / avgDailyOrdersPrev) * 100
      : null;

    return {
      summary, topProducts, topCountries, pctChange, avgDailyOrders,
      orderSeries: activeOrders30.series,
    };
  });
