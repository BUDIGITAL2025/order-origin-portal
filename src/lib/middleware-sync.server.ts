import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Phase 4 — PULL order ingestion.
 *
 * The middleware has no outbound event system (its "webhooks" are Slack/Teams
 * notifications), so we poll its admin order list every 5 minutes instead of
 * waiting for pushes. Everything downstream is untouched: new orders go through
 * the same ingest_middleware_order RPC (same pricing, same needs_review
 * fallback, same awaiting_payment gate) and status/tracking changes reuse the
 * existing push handlers, so the tracking email stays idempotent.
 *
 * The push receiver stays in place as the future upgrade path.
 */

// ============= Defensive field mapping =============

type Raw = Record<string, unknown>;

const asRecord = (v: unknown): Raw | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;

function pickString(source: Raw | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(source: Raw | null, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function pickArray(source: Raw | null, keys: string[]): unknown[] {
  if (!source) return [];
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

const STATUS_MAP: Record<string, "processing" | "shipped" | "delivered" | "cancelled"> = {
  processing: "processing",
  in_progress: "processing",
  fulfilling: "processing",
  approved: "processing",
  released: "processing",
  shipped: "shipped",
  fulfilled: "shipped",
  in_transit: "shipped",
  dispatched: "shipped",
  delivered: "delivered",
  completed: "delivered",
  cancelled: "cancelled",
  canceled: "cancelled",
  rejected: "cancelled",
};

export type MappedOrder = {
  middleware_order_id: string;
  external_ref: string | null;
  lines: { sku: string; qty: number }[];
  destination_country: string | null;
  customer: { name?: string; city?: string; postal?: string };
  status: "processing" | "shipped" | "delivered" | "cancelled" | null;
  tracking: { number: string; carrier: string } | null;
  missing: string[];
};

/**
 * Extracts what we need from a loosely typed middleware order, tolerating
 * extra/renamed fields. Anything it cannot find lands in `missing` so the
 * caller can route the order to needs_review instead of guessing.
 */
export function mapMiddlewareOrder(input: unknown): MappedOrder {
  const raw = asRecord(input) ?? {};
  const order = asRecord(raw["order"]) ?? raw;

  const middlewareOrderId = pickString(order, [
    "middleware_order_id",
    "id",
    "order_id",
    "orderId",
    "uuid",
    "_id",
  ]);
  const externalRef = pickString(order, [
    "external_ref",
    "external_order_id",
    "external_order_number",
    "order_number",
    "orderNumber",
    "reference",
    "name",
  ]);

  const shipping =
    asRecord(order["shipping_address"]) ??
    asRecord(order["shippingAddress"]) ??
    asRecord(order["shipping"]) ??
    asRecord(order["address"]);
  const customerRaw = asRecord(order["customer"]) ?? asRecord(order["buyer"]);

  const countryRaw =
    pickString(order, ["destination_country", "country", "country_code", "destinationCountry"]) ??
    pickString(shipping, ["country_code", "countryCode", "country"]) ??
    pickString(customerRaw, ["country_code", "country"]);
  const country =
    countryRaw && /^[A-Za-z]{2}$/.test(countryRaw.trim()) ? countryRaw.trim().toUpperCase() : null;

  const lines: { sku: string; qty: number }[] = [];
  for (const entry of pickArray(order, ["line_items", "lines", "items", "products", "lineItems"])) {
    const item = asRecord(entry);
    if (!item) continue;
    const variant = asRecord(item["variant"]);
    const product = asRecord(item["product"]);
    const sku =
      pickString(item, ["sku", "variant_sku", "product_sku", "code", "reference"]) ??
      pickString(variant, ["sku", "code"]) ??
      pickString(product, ["sku", "code"]);
    const qty = pickNumber(item, ["qty", "quantity", "units", "count"]) ?? 1;
    if (!sku) continue;
    const rounded = Math.max(1, Math.min(100_000, Math.floor(qty)));
    lines.push({ sku, qty: rounded });
  }

  const statusRaw = (
    pickString(order, ["status", "state", "order_status", "fulfillment_status"]) ?? ""
  )
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const status = STATUS_MAP[statusRaw] ?? null;

  const trackingRecord =
    asRecord(order["tracking"]) ?? asRecord(order["shipment"]) ?? asRecord(order["fulfilment"]);
  const trackingNumber =
    pickString(order, ["tracking_number", "trackingNumber", "tracking"]) ??
    pickString(trackingRecord, ["number", "tracking_number", "code"]);
  const trackingCarrier =
    pickString(order, ["tracking_carrier", "carrier", "shipping_carrier"]) ??
    pickString(trackingRecord, ["carrier", "company", "name"]) ??
    (trackingNumber ? "Carrier" : null);

  const customer: { name?: string; city?: string; postal?: string } = {};
  const name =
    pickString(customerRaw, ["name", "full_name", "customer_name"]) ??
    pickString(shipping, ["name", "full_name", "recipient"]);
  const city = pickString(shipping, ["city", "town", "locality"]) ?? pickString(customerRaw, ["city"]);
  const postal =
    pickString(shipping, ["postal_code", "postcode", "zip", "zip_code", "postalCode"]) ??
    pickString(customerRaw, ["postal_code", "zip"]);
  if (name) customer["name"] = name.slice(0, 200);
  if (city) customer["city"] = city.slice(0, 120);
  if (postal) customer["postal"] = postal.slice(0, 40);

  const missing: string[] = [];
  if (!middlewareOrderId) missing.push("order id");
  if (lines.length === 0) missing.push("line items (sku/qty)");
  if (!country) missing.push("destination country");

  return {
    middleware_order_id: middlewareOrderId ?? "",
    external_ref: externalRef,
    lines,
    destination_country: country,
    customer,
    status,
    tracking: trackingNumber && trackingCarrier ? { number: trackingNumber, carrier: trackingCarrier } : null,
    missing,
  };
}

/** Strips buyer PII before a raw sample is stored for mapping inspection. */
export function redactRawOrder(input: unknown): unknown {
  const seen = new WeakSet<object>();
  const SENSITIVE = /^(email|phone|tel|mobile|address|address1|address2|street|line1|line2|name|full_name|customer_name|recipient|company|vat|tax_id|note|notes)$/i;
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 6) return "[depth]";
    if (Array.isArray(value)) return value.slice(0, 10).map((v) => walk(v, depth + 1));
    const record = asRecord(value);
    if (!record) return value;
    if (seen.has(record)) return "[circular]";
    seen.add(record);
    const out: Raw = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = SENSITIVE.test(key) ? "[redacted]" : walk(entry, depth + 1);
    }
    return out;
  };
  return walk(input, 0);
}

/** Finds the order array wherever the middleware nests it. */
export function extractOrderList(body: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Middleware returned a non-JSON order list");
  }
  if (Array.isArray(parsed)) return parsed;
  const record = asRecord(parsed);
  if (record) {
    for (const key of ["orders", "data", "results", "items", "records"]) {
      const value = record[key];
      if (Array.isArray(value)) return value;
      const nested = asRecord(value);
      if (nested && Array.isArray(nested["orders"])) return nested["orders"] as unknown[];
    }
  }
  throw new Error("Could not find an order array in the middleware response");
}

// ============= Per-tenant sync =============

type SyncState = Database["public"]["Tables"]["middleware_sync_state"]["Row"];

export type TenantSyncResult = {
  store_id: string;
  tenant_id: string;
  ok: boolean;
  fetched: number;
  ingested: number;
  updated: number;
  needs_review: number;
  error?: string;
};

const FAILURE_ALERT_MS = 3_600_000; // 1h of consecutive failures → digest alert

async function storeSampleEvent(
  admin: Admin,
  args: { tenantId: string; sample: unknown },
): Promise<void> {
  try {
    await admin.from("integration_events").insert({
      event_id: `pull-sample-${args.tenantId}-${Date.now()}`,
      event_type: "order.sample",
      tenant_id: args.tenantId,
      payload: redactRawOrder(args.sample) as never,
      signature_valid: true,
      processed_at: new Date().toISOString(),
      simulator: false,
    });
  } catch (e) {
    console.error("[middleware:sync] failed to store raw sample:", e);
  }
}

async function landNeedsReview(
  admin: Admin,
  args: { storeId: string; mapped: MappedOrder; raw: unknown; tenantId: string },
): Promise<boolean> {
  const id = args.mapped.middleware_order_id;
  if (!id) {
    // Without an id we cannot even deduplicate — keep the payload for inspection.
    await admin.from("integration_events").insert({
      event_id: `pull-unmappable-${crypto.randomUUID()}`,
      event_type: "order.unmappable",
      tenant_id: args.tenantId,
      payload: redactRawOrder(args.raw) as never,
      signature_valid: true,
      error: `Missing: ${args.mapped.missing.join(", ")}`,
      simulator: false,
    });
    return false;
  }
  const { error } = await admin.from("orders").insert({
    store_id: args.storeId,
    middleware_order_id: id,
    external_order_id: args.mapped.external_ref ?? id,
    external_order_number: args.mapped.external_ref ?? id,
    source: "middleware",
    status: "needs_review",
    needs_review_reason: `Pull mapping incomplete — missing: ${args.mapped.missing.join(", ")}`,
    ...(args.mapped.destination_country
      ? { destination_country: args.mapped.destination_country }
      : {}),
  });
  if (error) throw new Error(error.message);
  await admin.from("integration_events").insert({
    event_id: `pull-needs-review-${id}`,
    event_type: "order.needs_review",
    tenant_id: args.tenantId,
    payload: redactRawOrder(args.raw) as never,
    signature_valid: true,
    error: `Missing: ${args.mapped.missing.join(", ")}`,
    simulator: false,
  });
  return true;
}

/** Polls one tenant's order list and reconciles it with our shadow orders. */
export async function syncTenant(
  admin: Admin,
  store: { id: string; middleware_tenant_id: string; store_name: string | null },
): Promise<TenantSyncResult> {
  const tenantId = store.middleware_tenant_id;
  const base: TenantSyncResult = {
    store_id: store.id,
    tenant_id: tenantId,
    ok: false,
    fetched: 0,
    ingested: 0,
    updated: 0,
    needs_review: 0,
  };

  const { data: stateRow } = await admin
    .from("middleware_sync_state")
    .select("*")
    .eq("store_id", store.id)
    .maybeSingle();
  const state = stateRow as SyncState | null;

  const { callMiddleware, MIDDLEWARE_PATHS, tenantSelector, processIntegrationEvent } = await import(
    "./middleware.server"
  );
  const selector = tenantSelector(tenantId);

  const outcome = await callMiddleware(admin, {
    endpoint: MIDDLEWARE_PATHS.orders,
    method: "GET",
    tenantId,
    idempotencyKey: `orders-sync-${tenantId}-${Math.floor(Date.now() / 60_000)}`,
    headers: selector.headers,
    query: selector.query,
  });

  const nowIso = new Date().toISOString();

  if (!outcome.ok) {
    const message = outcome.skipped
      ? "Middleware base URL / service token not configured"
      : outcome.error;
    await recordFailure(admin, { store, state, error: message, at: nowIso });
    return { ...base, error: message };
  }

  let orders: unknown[];
  try {
    orders = extractOrderList(outcome.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordFailure(admin, { store, state, error: message, at: nowIso });
    return { ...base, error: message };
  }

  base.fetched = orders.length;

  if (!state?.sample_logged && orders.length > 0) {
    await storeSampleEvent(admin, { tenantId, sample: orders[0] });
  }

  const seenIds: string[] = [];

  for (const raw of orders) {
    const mapped = mapMiddlewareOrder(raw);
    if (mapped.middleware_order_id) seenIds.push(mapped.middleware_order_id);

    try {
      const { data: existing } = mapped.middleware_order_id
        ? await admin
            .from("orders")
            .select("id, status, tracking_number")
            .eq("middleware_order_id", mapped.middleware_order_id)
            .maybeSingle()
        : { data: null };

      if (!existing) {
        if (mapped.missing.length > 0) {
          const landed = await landNeedsReview(admin, {
            storeId: store.id,
            mapped,
            raw,
            tenantId,
          });
          if (landed) base.needs_review += 1;
          continue;
        }
        await processIntegrationEvent(admin, "order.created", {
          event_id: `pull-${mapped.middleware_order_id}`,
          event_type: "order.created",
          tenant_id: tenantId,
          order: {
            middleware_order_id: mapped.middleware_order_id,
            external_ref: mapped.external_ref ?? mapped.middleware_order_id,
            lines: mapped.lines,
            destination_country: mapped.destination_country,
            customer: mapped.customer,
          },
        });
        base.ingested += 1;
        continue;
      }

      // Known order: only forward genuine changes through the push handlers.
      let changed = false;
      if (mapped.status && mapped.status !== existing.status) {
        await processIntegrationEvent(admin, "order.updated", {
          event_id: `pull-status-${mapped.middleware_order_id}-${mapped.status}`,
          tenant_id: tenantId,
          order: { middleware_order_id: mapped.middleware_order_id, status: mapped.status },
        });
        changed = true;
      }
      if (mapped.tracking && mapped.tracking.number !== existing.tracking_number) {
        await processIntegrationEvent(admin, "tracking.updated", {
          event_id: `pull-tracking-${mapped.middleware_order_id}`,
          tenant_id: tenantId,
          order: {
            middleware_order_id: mapped.middleware_order_id,
            tracking_number: mapped.tracking.number,
            tracking_carrier: mapped.tracking.carrier,
          },
        });
        changed = true;
      }
      if (changed) base.updated += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const { logAppError } = await import("./ops.server");
      await logAppError(admin, {
        job: "middleware:pull-order",
        context: { tenant_id: tenantId, middleware_order_id: mapped.middleware_order_id },
        error: message,
      });
    }
  }

  await admin.from("middleware_sync_state").upsert(
    {
      store_id: store.id,
      tenant_id: tenantId,
      last_synced_at: nowIso,
      last_success_at: nowIso,
      last_seen_order_ids: seenIds.slice(0, 200),
      orders_ingested: (state?.orders_ingested ?? 0) + base.ingested,
      last_error: null,
      consecutive_failures: 0,
      first_failure_at: null,
      sample_logged: state?.sample_logged || orders.length > 0,
    },
    { onConflict: "store_id" },
  );

  return { ...base, ok: true };
}

async function recordFailure(
  admin: Admin,
  args: {
    store: { id: string; middleware_tenant_id: string };
    state: SyncState | null;
    error: string;
    at: string;
  },
): Promise<void> {
  const failures = (args.state?.consecutive_failures ?? 0) + 1;
  const firstFailureAt = args.state?.first_failure_at ?? args.at;
  await admin.from("middleware_sync_state").upsert(
    {
      store_id: args.store.id,
      tenant_id: args.store.middleware_tenant_id,
      last_synced_at: args.at,
      last_error: args.error.slice(0, 1000),
      consecutive_failures: failures,
      first_failure_at: firstFailureAt,
      ...(args.state ? {} : { last_seen_order_ids: [] }),
    },
    { onConflict: "store_id" },
  );

  // Only alert once the outage has lasted more than an hour: a single failed
  // cycle is normal and the next cycle retries it.
  if (Date.now() - new Date(firstFailureAt).getTime() > FAILURE_ALERT_MS) {
    const { logAppError } = await import("./ops.server");
    await logAppError(admin, {
      job: "middleware:sync-down",
      context: {
        tenant_id: args.store.middleware_tenant_id,
        consecutive_failures: failures,
        since: firstFailureAt,
      },
      error: `Middleware order sync failing for over 1h: ${args.error}`,
    });
  }
}

/**
 * Polls every connected workspace. Never throws: the cron records the summary
 * and each tenant's failure is isolated so one bad tenant cannot stop the rest.
 */
export async function syncAllTenants(
  admin: Admin,
  opts?: { storeIds?: string[] },
): Promise<TenantSyncResult[]> {
  let query = admin
    .from("stores")
    .select("id, store_name, middleware_tenant_id, integration_mode, status")
    .not("middleware_tenant_id", "is", null)
    .eq("integration_mode", "automatic")
    .eq("status", "active")
    .limit(200);
  if (opts?.storeIds?.length) query = query.in("id", opts.storeIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const results: TenantSyncResult[] = [];
  for (const store of data ?? []) {
    if (!store.middleware_tenant_id) continue;
    try {
      results.push(
        await syncTenant(admin, {
          id: store.id,
          middleware_tenant_id: store.middleware_tenant_id,
          store_name: store.store_name,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({
        store_id: store.id,
        tenant_id: store.middleware_tenant_id,
        ok: false,
        fetched: 0,
        ingested: 0,
        updated: 0,
        needs_review: 0,
        error: message,
      });
    }
  }
  return results;
}
