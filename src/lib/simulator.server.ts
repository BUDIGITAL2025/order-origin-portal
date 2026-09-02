import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Phase 3 — middleware SIMULATOR (test tooling only).
 *
 * Lets us exercise the whole C2 loop before the real middleware exists:
 *  - it EMITS real signed webhooks into our own receiver (same HMAC secret),
 *  - it ACCEPTS the outbound release/reject call so releases can flip to 'sent'.
 *
 * Everything it touches is tagged simulator=true so the digest and any ops
 * view can ignore it. No money logic lives here: orders are created through
 * the same ingest RPC and paid through the same wallet path as production.
 */

const SETTING_KEY = "simulator_release_override";
export const SIMULATOR_PATH_PREFIX = "/api/public/middleware/simulator";

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function envOrNull(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw || raw === "REPLACE_ME") return null;
  return raw;
}

/** Absolute base URL of this app, needed for self-directed calls. */
export async function appBaseUrl(admin: Admin): Promise<string | null> {
  // A stored override exists only for local end-to-end testing of the
  // simulator itself; production always resolves from APP_BASE_URL.
  const { data: override } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", "simulator_self_base_url")
    .maybeSingle();
  if (override?.value) return stripSlash(override.value);
  const fromEnv = envOrNull("APP_BASE_URL");
  if (fromEnv) return stripSlash(fromEnv);
  const { data } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", "app_base_url")
    .maybeSingle();
  return data?.value ? stripSlash(data.value) : null;
}

export function isSimulatorUrl(url: string | null): boolean {
  return !!url && url.includes(SIMULATOR_PATH_PREFIX);
}

export function simulatorToken(): string | null {
  return envOrNull("MIDDLEWARE_SIMULATOR_TOKEN");
}

/** The URL callMiddleware should use when the simulator is the release target. */
export async function simulatorBaseUrl(admin: Admin): Promise<string | null> {
  const base = await appBaseUrl(admin);
  return base ? `${base}${SIMULATOR_PATH_PREFIX}` : null;
}

export async function releaseOverrideEnabled(admin: Admin): Promise<boolean> {
  const { data } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();
  return data?.value === "on";
}

/**
 * Flip the override. Refuses whenever a REAL middleware base URL is
 * configured — the simulator must never shadow a live fulfilment engine.
 */
export async function setReleaseOverride(admin: Admin, enabled: boolean): Promise<void> {
  const real = envOrNull("MIDDLEWARE_BASE_URL");
  if (enabled && real && !isSimulatorUrl(real)) {
    throw new Error(
      "A real MIDDLEWARE_BASE_URL is configured — the simulator cannot take over releases.",
    );
  }
  if (enabled && !simulatorToken()) {
    throw new Error("MIDDLEWARE_SIMULATOR_TOKEN is not configured.");
  }
  const { error } = await admin
    .from("internal_settings")
    .upsert(
      { key: SETTING_KEY, value: enabled ? "on" : "off", updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

// ============= Emitting signed webhooks =============

async function postSignedWebhook(
  admin: Admin,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number | null; body: string }> {
  const { middlewareConfig, computeSignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } = await import(
    "./middleware.server"
  );
  const { webhookSecret } = middlewareConfig();
  if (!webhookSecret) throw new Error("MIDDLEWARE_WEBHOOK_SECRET is not configured.");
  const base = await appBaseUrl(admin);
  if (!base) throw new Error("APP_BASE_URL is not configured — cannot reach our own webhook.");

  const body = JSON.stringify({ ...payload, simulator: true });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await computeSignature(webhookSecret, timestamp, body);

  const response = await fetch(`${base}/api/public/middleware/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SIGNATURE_HEADER]: `sha256=${signature}`,
      [TIMESTAMP_HEADER]: timestamp,
    },
    body,
  });
  const text = (await response.text().catch(() => "")).slice(0, 1000);
  return { ok: response.ok, status: response.status, body: text };
}

function randomRef(prefix: string): string {
  const n = Math.floor(Math.random() * 900_000 + 100_000);
  return `${prefix}-${n}`;
}

type SimStore = {
  id: string;
  store_name: string | null;
  middleware_tenant_id: string | null;
};

/**
 * Finds a workspace that has a middleware tenant id AND priced catalogue
 * products, so an order.created can be built with real SKUs and countries.
 */
export async function findSimulatableWorkspace(admin: Admin): Promise<{
  store: SimStore;
  skus: string[];
  countries: string[];
} | null> {
  const { data: stores, error } = await admin
    .from("stores")
    .select("id, store_name, middleware_tenant_id")
    .not("middleware_tenant_id", "is", null)
    .limit(25);
  if (error) throw new Error(error.message);

  for (const store of stores ?? []) {
    const { data: products } = await admin
      .from("products")
      .select("id, sku, product_country_prices(country_code)")
      .eq("store_id", store.id)
      .eq("status", "active")
      .limit(20);
    const priced = (products ?? []).filter(
      (p) =>
        Array.isArray(
          (p as unknown as { product_country_prices?: unknown[] }).product_country_prices,
        ) &&
        ((p as unknown as { product_country_prices: unknown[] }).product_country_prices ?? [])
          .length > 0,
    );
    if (priced.length === 0) continue;
    const countries = new Set<string>();
    for (const p of priced) {
      for (const row of (p as unknown as { product_country_prices: { country_code: string }[] })
        .product_country_prices) {
        countries.add(row.country_code);
      }
    }
    return {
      store: store as SimStore,
      skus: priced.map((p) => (p as unknown as { sku: string }).sku),
      countries: [...countries],
    };
  }
  return null;
}

/** Emits a realistic order.created for a simulatable workspace. */
export async function simulateOrderCreated(admin: Admin): Promise<{
  event_id: string;
  middleware_order_id: string;
  order_id: string | null;
  store_name: string | null;
  lines: { sku: string; qty: number }[];
  destination_country: string;
  webhook: { ok: boolean; status: number | null; body: string };
}> {
  const target = await findSimulatableWorkspace(admin);
  if (!target) {
    throw new Error(
      "No workspace with a middleware tenant id and priced products was found. Connect a tenant id and accept a quote first.",
    );
  }
  const skuPool = [...target.skus].sort(() => Math.random() - 0.5);
  const lineCount = Math.min(skuPool.length, Math.random() < 0.5 ? 1 : 2);
  const lines = skuPool.slice(0, lineCount).map((sku) => ({
    sku,
    qty: Math.floor(Math.random() * 3) + 1,
  }));
  const destination =
    target.countries[Math.floor(Math.random() * target.countries.length)] ?? "US";

  const middlewareOrderId = randomRef("SIM");
  const eventId = `sim-${crypto.randomUUID()}`;
  const webhook = await postSignedWebhook(admin, {
    event_id: eventId,
    event_type: "order.created",
    tenant_id: target.store.middleware_tenant_id,
    order: {
      middleware_order_id: middlewareOrderId,
      external_ref: randomRef("SIM-REF"),
      lines,
      destination_country: destination,
      customer: { name: "Simulator Buyer", city: "Lisbon", postal: "1000-001" },
    },
  });

  const { data: order } = await admin
    .from("orders")
    .select("id")
    .eq("middleware_order_id", middlewareOrderId)
    .maybeSingle();

  return {
    event_id: eventId,
    middleware_order_id: middlewareOrderId,
    order_id: order?.id ?? null,
    store_name: target.store.store_name,
    lines,
    destination_country: destination,
    webhook,
  };
}

const CARRIERS = ["DHL Express", "UPS", "FedEx", "GLS"];

/** Emits tracking.updated for an existing middleware order. */
export async function simulateTracking(
  admin: Admin,
  orderId: string,
): Promise<{ event_id: string; tracking_number: string; tracking_carrier: string }> {
  const { data: order, error } = await admin
    .from("orders")
    .select("id, middleware_order_id, source, stores(middleware_tenant_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order?.middleware_order_id) throw new Error("Not a middleware order.");
  const tenantId = (order.stores as { middleware_tenant_id?: string | null } | null)
    ?.middleware_tenant_id;
  if (!tenantId) throw new Error("Workspace has no middleware tenant id.");

  const carrier = CARRIERS[Math.floor(Math.random() * CARRIERS.length)] as string;
  const trackingNumber = `SIMTRK${Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000)}`;
  const eventId = `sim-${crypto.randomUUID()}`;
  await postSignedWebhook(admin, {
    event_id: eventId,
    event_type: "tracking.updated",
    tenant_id: tenantId,
    order: {
      middleware_order_id: order.middleware_order_id,
      tracking_number: trackingNumber,
      tracking_carrier: carrier,
    },
  });
  return { event_id: eventId, tracking_number: trackingNumber, tracking_carrier: carrier };
}

/** Emits order.updated (status change) for an existing middleware order. */
export async function simulateOrderStatus(
  admin: Admin,
  orderId: string,
  status: "processing" | "shipped" | "delivered" | "cancelled" | "needs_review",
): Promise<{ event_id: string }> {
  const { data: order } = await admin
    .from("orders")
    .select("id, middleware_order_id, stores(middleware_tenant_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.middleware_order_id) throw new Error("Not a middleware order.");
  const tenantId = (order.stores as { middleware_tenant_id?: string | null } | null)
    ?.middleware_tenant_id;
  if (!tenantId) throw new Error("Workspace has no middleware tenant id.");

  const eventId = `sim-${crypto.randomUUID()}`;
  await postSignedWebhook(admin, {
    event_id: eventId,
    event_type: "order.updated",
    tenant_id: tenantId,
    order: { middleware_order_id: order.middleware_order_id, status },
  });
  return { event_id: eventId };
}

// ============= Phase 4: serving the PULL order list =============

const PULL_QUEUE_KEY = "simulator_pull_orders";

/** A fake order in the middleware's (loosely typed) response shape. */
export type SimulatorPullOrder = {
  id: string;
  order_number: string;
  tenant_id: string;
  status: string;
  country: string;
  line_items: { sku: string; quantity: number }[];
  customer: { name: string; city: string; postal_code: string };
  tracking?: { number: string; carrier: string };
  created_at: string;
};

export async function listSimulatorPullOrders(
  admin: Admin,
  tenantId?: string | null,
): Promise<SimulatorPullOrder[]> {
  const { data } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", PULL_QUEUE_KEY)
    .maybeSingle();
  let parsed: unknown = [];
  try {
    parsed = data?.value ? JSON.parse(data.value) : [];
  } catch {
    parsed = [];
  }
  const orders = Array.isArray(parsed) ? (parsed as SimulatorPullOrder[]) : [];
  return tenantId ? orders.filter((o) => o.tenant_id === tenantId) : orders;
}

async function writePullQueue(admin: Admin, orders: SimulatorPullOrder[]): Promise<void> {
  const { error } = await admin.from("internal_settings").upsert(
    {
      key: PULL_QUEUE_KEY,
      value: JSON.stringify(orders.slice(-20)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

/** Adds one realistic fake order to the list the simulator serves on GET. */
export async function queueSimulatorPullOrder(admin: Admin): Promise<SimulatorPullOrder> {
  const target = await findSimulatableWorkspace(admin);
  if (!target?.store.middleware_tenant_id) {
    throw new Error(
      "No workspace with a middleware tenant id and priced products was found. Connect a tenant id and accept a quote first.",
    );
  }
  const skuPool = [...target.skus].sort(() => Math.random() - 0.5);
  const lineCount = Math.min(skuPool.length, Math.random() < 0.5 ? 1 : 2);
  const id = randomRef("SIMPULL");
  const order: SimulatorPullOrder = {
    id,
    order_number: randomRef("SIMPULL-REF"),
    tenant_id: target.store.middleware_tenant_id,
    status: "pending",
    country: target.countries[Math.floor(Math.random() * target.countries.length)] ?? "US",
    line_items: skuPool.slice(0, lineCount).map((sku) => ({
      sku,
      quantity: Math.floor(Math.random() * 3) + 1,
    })),
    customer: { name: "Simulator Buyer", city: "Lisbon", postal_code: "1000-001" },
    created_at: new Date().toISOString(),
  };
  const existing = await listSimulatorPullOrders(admin);
  await writePullQueue(admin, [...existing, order]);
  return order;
}

/** Marks a queued fake order shipped with tracking, so the poller picks it up. */
export async function setSimulatorPullTracking(
  admin: Admin,
  middlewareOrderId: string,
): Promise<{ tracking_number: string; tracking_carrier: string }> {
  const orders = await listSimulatorPullOrders(admin);
  const match = orders.find((o) => o.id === middlewareOrderId);
  if (!match) throw new Error("That order is not in the simulator pull queue.");
  const carrier = CARRIERS[Math.floor(Math.random() * CARRIERS.length)] as string;
  const number = `SIMTRK${Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000)}`;
  match.status = "shipped";
  match.tracking = { number, carrier };
  await writePullQueue(admin, orders);
  return { tracking_number: number, tracking_carrier: carrier };
}

export async function clearSimulatorPullQueue(admin: Admin): Promise<void> {
  await writePullQueue(admin, []);
}

// ============= Phase 5: serving fake INVENTORY levels =============

const INVENTORY_KEY = "simulator_inventory";

export type SimulatorStockRow = {
  sku: string;
  location: string;
  quantity: number;
  tenant_id: string;
};

export async function listSimulatorInventory(
  admin: Admin,
  tenantId?: string | null,
): Promise<SimulatorStockRow[]> {
  const { data } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", INVENTORY_KEY)
    .maybeSingle();
  let parsed: unknown = [];
  try {
    parsed = data?.value ? JSON.parse(data.value) : [];
  } catch {
    parsed = [];
  }
  const rows = Array.isArray(parsed) ? (parsed as SimulatorStockRow[]) : [];
  return tenantId ? rows.filter((r) => r.tenant_id === tenantId) : rows;
}

async function writeSimulatorInventory(admin: Admin, rows: SimulatorStockRow[]): Promise<void> {
  const { error } = await admin.from("internal_settings").upsert(
    {
      key: INVENTORY_KEY,
      value: JSON.stringify(rows.slice(0, 500)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Seeds fake stock for every priced SKU of a simulatable workspace, spread
 * over two locations. `tight` deliberately produces low cover so a SKU with
 * simulated order history lands in AMBER/RED.
 */
export async function seedSimulatorInventory(
  admin: Admin,
  opts?: { tight?: boolean },
): Promise<{ tenant_id: string; rows: number }> {
  const target = await findSimulatableWorkspace(admin);
  if (!target?.store.middleware_tenant_id) {
    throw new Error(
      "No workspace with a middleware tenant id and priced products was found. Connect a tenant id and accept a quote first.",
    );
  }
  const tenantId = target.store.middleware_tenant_id;
  const rows: SimulatorStockRow[] = [];
  for (const sku of target.skus) {
    const total = opts?.tight
      ? Math.floor(Math.random() * 12) + 4
      : Math.floor(Math.random() * 400) + 120;
    const main = Math.ceil(total * 0.7);
    rows.push({ sku, location: "EU-WH1", quantity: main, tenant_id: tenantId });
    rows.push({ sku, location: "US-WH1", quantity: total - main, tenant_id: tenantId });
  }
  await writeSimulatorInventory(admin, rows);
  return { tenant_id: tenantId, rows: rows.length };
}

export async function clearSimulatorInventory(admin: Admin): Promise<void> {
  await writeSimulatorInventory(admin, []);
}
