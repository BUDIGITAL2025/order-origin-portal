/**
 * EcomFlow API client — admin-only, read-only live stock view.
 * This is a separate data source from the client-side manual_stock_levels
 * model and must never share its sync/write logic.
 */

const ECOMFLOW_BASE_URL = "https://api.ecomflow.com/api/v1";

async function callEcomflow<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = process.env["ECOMFLOW_API_TOKEN"];
  if (!token) throw new Error("ECOMFLOW_API_TOKEN not configured");

  const url = new URL(ECOMFLOW_BASE_URL + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: { Authorization: token, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Ecomflow ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchAllEcomflowSkus() {
  const items: unknown[] = [];
  let page = 1;
  while (true) {
    const data = await callEcomflow<{ items: unknown[]; hasNextPage: boolean }>("/inventory/skus", {
      limit: "200",
      page: String(page),
    });
    items.push(...data.items);
    if (!data.hasNextPage) break;
    page += 1;
  }
  return items;
}

export async function fetchAllEcomflowStockHealth() {
  const items: unknown[] = [];
  let page = 1;
  while (true) {
    const data = await callEcomflow<{ items: unknown[]; hasNextPage: boolean }>("/stock-health", {
      limit: "200",
      page: String(page),
    });
    items.push(...data.items);
    if (!data.hasNextPage) break;
    page += 1;
  }
  return items;
}

export async function fetchEcomflowStockHealthSummary() {
  return callEcomflow<{
    totalProducts: number; criticalCount: number; warningCount: number;
    healthyCount: number; notSellingCount: number; acceleratingCount: number;
  }>("/stock-health/summary");
}

export async function fetchEcomflowTopProducts(from: string, to: string) {
  const data = await callEcomflow<{ products: { sku: string; title: string; unitsSold: number; orderCount: number }[] }>(
    "/analytics/top-products",
    { from, to, limit: "5" },
  );
  return data.products;
}

export async function fetchEcomflowActiveOrders(from: string, to: string) {
  return callEcomflow<{ series: { period: string; activeOrders: number }[]; totalActiveOrders: number }>(
    "/analytics/active-orders",
    { from, to, granularity: "day" },
  );
}

export async function fetchEcomflowTopCountries(from: string, to: string) {
  const countryCounts = new Map<string, number>();
  let page = 1;
  let total = 0;
  while (page <= 5) {
    const data = await callEcomflow<{ orders: { country: string | null }[]; hasNextPage: boolean }>("/orders", {
      minCreateDate: from,
      maxCreateDate: to,
      status: "NEW,PROCESSED,IN_TRANSIT,AWAITING_PICKUP,OUT_FOR_DELIVERY,DELIVERED",
      limit: "200",
      page: String(page),
    });
    for (const o of data.orders) {
      const c = o.country ?? "Unknown";
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
      total += 1;
    }
    if (!data.hasNextPage) break;
    page += 1;
  }
  return [...countryCounts.entries()]
    .map(([country, count]) => ({ country, count, pct: total > 0 ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
