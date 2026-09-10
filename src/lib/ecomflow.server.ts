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
