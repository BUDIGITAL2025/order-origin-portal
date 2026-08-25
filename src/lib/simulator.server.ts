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
