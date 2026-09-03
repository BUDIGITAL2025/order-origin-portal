import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Phase 5 — INVENTORY & REORDERS (the forecasting core).
 *
 * Read-only consumption of middleware stock plus velocity computed from our
 * own shadow orders. Middleware stays the source of truth: nothing here ever
 * writes to it. Everything degrades softly — a failed read leaves the last
 * snapshot in place and the UI shows how stale it is.
 */

export type InventoryState = "green" | "amber" | "red" | "idle";

export interface SkuLocation {
  location: string;
  quantity: number;
}

export interface ShippingRoute {
  destination: string;
  handling_time_days: number;
  is_default: boolean;
}

export interface SkuRow {
  sku: string;
  product_id: string | null;
  product_name: string;
  locations: SkuLocation[];
  total_stock: number;
  /** Manually tracked reservations (0 when the workspace is middleware-fed). */
  reserved: number;
  /** Units already on their way in. */
  incoming: number;
  /** total_stock − reserved, floored at 0. Drives cover and the stock bar. */
  sellable: number;
  weight: number | null;
  weight_unit: string | null;
  tags: string[];
  routes: ShippingRoute[];
  /** True when the stock figure came from a manual entry, not the middleware. */
  manual: boolean;
  units_7d: number;
  units_30d: number;
  daily_velocity: number;
  /** null = no recent sales, cover is effectively infinite. */
  days_of_cover: number | null;
  production_lead: number;
  production_origin: string;
  transit_lead: number;
  transit_origin: string;
  safety_margin: number;
  safety_origin: string;
  total_lead: number;
  /** ISO date (YYYY-MM-DD); null when velocity is zero. */
  reorder_by: string | null;
  state: InventoryState;
  /** Days out of stock even if the reorder is placed today (RED only). */
  gap_days: number | null;
  suggested_qty: number;
}


export interface WorkspaceInventory {
  store_id: string;
  store_name: string | null;
  rows: SkuRow[];
  last_captured_at: string | null;
  stale: boolean;
}

/** Days of extra cover a suggested reorder aims to buy on top of the lead. */
const COVERAGE_TARGET_DAYS = 30;
/** Reorder-by within this many days is AMBER. */
const AMBER_WINDOW_DAYS = 14;
/** Snapshots older than this render a stale-data banner. */
export const STALE_AFTER_MS = 2 * 3_600_000;

const MS_PER_DAY = 86_400_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Pure math, exported so it can be reasoned about (and tested) on its own. */
export function evaluateSku(input: {
  total_stock: number;
  units_7d: number;
  units_30d: number;
  production_lead: number;
  transit_lead: number;
  safety_margin: number;
  now?: Date;
}): Pick<
  SkuRow,
  "daily_velocity" | "days_of_cover" | "total_lead" | "reorder_by" | "state" | "gap_days" | "suggested_qty"
> {
  const now = input.now ?? new Date();
  const totalLead = input.production_lead + input.transit_lead + input.safety_margin;

  const daily =
    input.units_30d > 0
      ? input.units_30d / 30
      : input.units_7d > 0
        ? input.units_7d / 7
        : 0;

  if (daily <= 0) {
    return {
      daily_velocity: 0,
      days_of_cover: null,
      total_lead: totalLead,
      reorder_by: null,
      state: "idle",
      gap_days: null,
      suggested_qty: 0,
    };
  }

  const cover = input.total_stock / daily;
  const daysUntilReorder = cover - totalLead;
  const reorderBy = new Date(now.getTime() + daysUntilReorder * MS_PER_DAY);

  const state: InventoryState =
    daysUntilReorder > AMBER_WINDOW_DAYS ? "green" : daysUntilReorder > 0 ? "amber" : "red";

  return {
    daily_velocity: Math.round(daily * 100) / 100,
    days_of_cover: Math.round(cover * 10) / 10,
    total_lead: totalLead,
    reorder_by: isoDate(reorderBy),
    state,
    gap_days: state === "red" ? Math.max(0, Math.round(totalLead - cover)) : null,
    suggested_qty: Math.max(1, Math.ceil(daily * (totalLead + COVERAGE_TARGET_DAYS))),
  };
}

// ============= Reading what we have =============

type ResolvedLead = {
  product_id: string;
  sku: string;
  product_name: string;
  production_lead: number;
  production_origin: string;
  transit_lead: number;
  transit_origin: string;
  safety_margin: number;
  safety_origin: string;
};

/**
 * Builds the per-SKU planning view for one workspace from the latest snapshot
 * batch, the velocity table and the resolved lead-time cascade. Never throws
 * for missing data: an empty workspace simply returns no rows.
 */
export async function computeWorkspaceInventory(
  admin: Admin,
  store: { id: string; store_name?: string | null },
  now = new Date(),
): Promise<WorkspaceInventory> {
  const [{ data: snapshots }, { data: velocity }, { data: leads }, { data: manual }, { data: catalogue }] =
    await Promise.all([
      admin
        .from("inventory_snapshots")
        .select("sku, location, quantity, captured_at")
        .eq("store_id", store.id)
        .order("captured_at", { ascending: false })
        .limit(2000),
      admin.from("sku_velocity").select("sku, units_7d, units_30d").eq("store_id", store.id),
      admin.rpc("resolved_lead_times", { p_store_id: store.id }),
      admin
        .from("manual_stock_levels")
        .select("sku, in_warehouse, reserved, incoming, updated_at")
        .eq("store_id", store.id),
      admin
        .from("products")
        .select("id, sku, tags, weight, weight_unit, product_shipping_routes(destination, handling_time_days, is_default)")
        .eq("store_id", store.id)
        .limit(2000),
    ]);

  const snapshotRows = snapshots ?? [];
  const lastCapturedAt = snapshotRows[0]?.captured_at ?? null;

  // Only the newest batch counts as "current stock".
  const current = lastCapturedAt
    ? snapshotRows.filter((r) => r.captured_at === lastCapturedAt)
    : [];

  const bySku = new Map<string, SkuLocation[]>();
  for (const row of current) {
    const list = bySku.get(row.sku) ?? [];
    list.push({ location: row.location, quantity: row.quantity });
    bySku.set(row.sku, list);
  }

  // Manually entered stock wins for its SKU: a sync must never silently
  // overwrite what somebody typed in by hand.
  const manualBySku = new Map((manual ?? []).map((m) => [m.sku, m]));
  const manualUpdatedAt = (manual ?? [])
    .map((m) => m.updated_at)
    .sort()
    .at(-1) ?? null;

  const catalogueBySku = new Map((catalogue ?? []).map((p) => [p.sku, p]));

  const velocityBySku = new Map(
    (velocity ?? []).map((v) => [v.sku, { units_7d: v.units_7d, units_30d: v.units_30d }]),
  );
  const leadBySku = new Map(
    ((leads ?? []) as ResolvedLead[]).map((l) => [l.sku, l]),
  );

  // Every SKU we know about: stocked SKUs, manual entries, plus catalogue SKUs with velocity.
  const skus = new Set<string>([...bySku.keys(), ...manualBySku.keys()]);
  for (const sku of velocityBySku.keys()) if (leadBySku.has(sku)) skus.add(sku);

  const rows: SkuRow[] = [];
  for (const sku of skus) {
    const lead = leadBySku.get(sku);
    const manualRow = manualBySku.get(sku);
    const locations = manualRow
      ? [{ location: "Warehouse", quantity: manualRow.in_warehouse }]
      : (bySku.get(sku) ?? []).sort((a, b) => a.location.localeCompare(b.location));
    const totalStock = locations.reduce((sum, l) => sum + l.quantity, 0);
    const reserved = manualRow?.reserved ?? 0;
    const incoming = manualRow?.incoming ?? 0;
    const sellable = Math.max(0, totalStock - reserved);
    const vel = velocityBySku.get(sku) ?? { units_7d: 0, units_30d: 0 };
    const product = catalogueBySku.get(sku);
    const routes: ShippingRoute[] = (product?.product_shipping_routes ?? []).map((r) => ({
      destination: r.destination,
      handling_time_days: r.handling_time_days,
      is_default: r.is_default,
    }));

    const production = lead?.production_lead ?? 0;
    const transit = lead?.transit_lead ?? 0;
    const safety = lead?.safety_margin ?? 0;

    const math = evaluateSku({
      total_stock: sellable,
      units_7d: vel.units_7d,
      units_30d: vel.units_30d,
      production_lead: production,
      transit_lead: transit,
      safety_margin: safety,
      now,
    });

    rows.push({
      sku,
      product_id: lead?.product_id ?? product?.id ?? null,
      product_name: lead?.product_name ?? sku,
      locations,
      total_stock: totalStock,
      reserved,
      incoming,
      sellable,
      weight: product?.weight ?? null,
      weight_unit: product?.weight_unit ?? null,
      tags: product?.tags ?? [],
      routes,
      manual: manualRow != null,
      units_7d: vel.units_7d,
      units_30d: vel.units_30d,
      production_lead: production,
      production_origin: lead?.production_origin ?? "W",
      transit_lead: transit,
      transit_origin: lead?.transit_origin ?? "W",
      safety_margin: safety,
      safety_origin: lead?.safety_origin ?? "W",
      ...math,
    });
  }


  const order: Record<InventoryState, number> = { red: 0, amber: 1, green: 2, idle: 3 };
  rows.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (a.reorder_by ?? "9999").localeCompare(b.reorder_by ?? "9999") ||
      a.sku.localeCompare(b.sku),
  );

  // Manually entered stock counts as a fresh update for the staleness banner.
  const freshest = [lastCapturedAt, manualUpdatedAt].filter(Boolean).sort().at(-1) ?? null;

  return {
    store_id: store.id,
    store_name: store.store_name ?? null,
    rows,
    last_captured_at: freshest,
    stale: freshest ? Date.now() - new Date(freshest).getTime() > STALE_AFTER_MS : true,
  };

}

// ============= Pulling stock from the middleware =============

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/** Tolerant extraction — the middleware's exact envelope is not final. */
export function extractInventoryList(body: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Middleware returned a non-JSON inventory list");
  }
  if (Array.isArray(parsed)) return parsed;
  const record = asRecord(parsed);
  if (record) {
    for (const key of ["inventory", "stock", "levels", "data", "results", "items", "records"]) {
      const value = record[key];
      if (Array.isArray(value)) return value;
      const nested = asRecord(value);
      if (nested && Array.isArray(nested["inventory"])) return nested["inventory"] as unknown[];
    }
  }
  throw new Error("Could not find an inventory array in the middleware response");
}

export type MappedStock = { sku: string; location: string; quantity: number };

/** Maps one loose middleware row into our snapshot shape. */
export function mapInventoryRow(input: unknown): MappedStock | null {
  const record = asRecord(input);
  if (!record) return null;
  const sku = pickString(record, ["sku", "SKU", "product_sku", "code"]);
  if (!sku) return null;
  const quantity =
    pickNumber(record, ["quantity", "qty", "available", "on_hand", "stock", "quantity_available"]) ??
    0;
  const location =
    pickString(record, ["location", "warehouse", "location_code", "site"]) ?? "default";
  return { sku, location, quantity: Math.max(0, Math.round(quantity)) };
}

/** How often a tenant's stock is re-read, regardless of poller frequency. */
const INVENTORY_INTERVAL_MS = 30 * 60_000;

export type InventorySyncResult = {
  store_id: string;
  ok: boolean;
  skipped?: "throttled" | "unconfigured";
  skus: number;
  alerts: number;
  error?: string;
};

/**
 * Reads one tenant's stock levels and writes an append-only snapshot batch,
 * then recomputes velocity and evaluates alerts. Throttled to one read every
 * 30 minutes so it can ride along with the 5-minute order poller.
 */
export async function syncInventoryForStore(
  admin: Admin,
  store: { id: string; middleware_tenant_id: string; store_name?: string | null },
  opts?: { force?: boolean },
): Promise<InventorySyncResult> {
  const base: InventorySyncResult = { store_id: store.id, ok: false, skus: 0, alerts: 0 };

  if (!opts?.force) {
    const { data: last } = await admin
      .from("inventory_snapshots")
      .select("captured_at")
      .eq("store_id", store.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.captured_at && Date.now() - new Date(last.captured_at).getTime() < INVENTORY_INTERVAL_MS) {
      return { ...base, ok: true, skipped: "throttled" };
    }
  }

  const { callMiddleware, MIDDLEWARE_PATHS, tenantSelector } = await import("./middleware.server");
  const selector = tenantSelector(store.middleware_tenant_id);

  const outcome = await callMiddleware(admin, {
    endpoint: MIDDLEWARE_PATHS.inventory,
    method: "GET",
    tenantId: store.middleware_tenant_id,
    idempotencyKey: `inventory-sync-${store.middleware_tenant_id}-${Math.floor(Date.now() / 60_000)}`,
    headers: selector.headers,
    query: selector.query,
  });

  if (!outcome.ok) {
    if (outcome.skipped) return { ...base, ok: true, skipped: "unconfigured" };
    return { ...base, error: outcome.error };
  }

  let rows: unknown[];
  try {
    rows = extractInventoryList(outcome.body);
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }

  const capturedAt = new Date().toISOString();
  const mapped = rows
    .map(mapInventoryRow)
    .filter((r): r is MappedStock => r !== null)
    .slice(0, 5000);

  if (mapped.length > 0) {
    const { error } = await admin.from("inventory_snapshots").insert(
      mapped.map((m) => ({
        store_id: store.id,
        sku: m.sku,
        location: m.location,
        quantity: m.quantity,
        captured_at: capturedAt,
      })),
    );
    if (error) return { ...base, error: error.message };
  }

  await admin.rpc("recompute_sku_velocity", { p_store_id: store.id });

  const alerts = await evaluateInventoryAlerts(admin, store);
  return { ...base, ok: true, skus: mapped.length, alerts };
}

// ============= Alerts (one email per state transition) =============

/**
 * Compares each SKU's current state with the last notified one and sends a
 * single email per transition into AMBER or RED. Returns how many were sent.
 */
export async function evaluateInventoryAlerts(
  admin: Admin,
  store: { id: string; store_name?: string | null },
): Promise<number> {
  const view = await computeWorkspaceInventory(admin, store);
  if (view.rows.length === 0) return 0;

  const { data: known } = await admin
    .from("sku_alert_state")
    .select("sku, state")
    .eq("store_id", store.id);
  const previous = new Map((known ?? []).map((k) => [k.sku, k.state]));

  const { data: owner } = await admin
    .from("stores")
    .select("store_name, entities(account_id)")
    .eq("id", store.id)
    .maybeSingle();
  const accountId =
    (owner?.entities as { account_id?: string | null } | null)?.account_id ?? null;

  let sent = 0;
  for (const row of view.rows) {
    const before = previous.get(row.sku);
    if (before === row.state) continue;

    const alerting = row.state === "amber" || row.state === "red";
    await admin.from("sku_alert_state").upsert(
      {
        store_id: store.id,
        sku: row.sku,
        state: row.state,
        updated_at: new Date().toISOString(),
        ...(alerting ? { notified_at: new Date().toISOString() } : {}),
      },
      { onConflict: "store_id,sku" },
    );

    if (!alerting || !accountId) continue;

    try {
      const { sendClientEmail } = await import("./email.server");
      const { inventoryReorderEmail } = await import("./email-templates.server");
      await sendClientEmail(admin, {
        clientId: accountId,
        ...inventoryReorderEmail({
          productName: row.product_name,
          sku: row.sku,
          workspaceName: owner?.store_name ?? store.store_name ?? null,
          state: row.state as "amber" | "red",
          daysOfCover: row.days_of_cover,
          totalLead: row.total_lead,
          reorderBy: row.reorder_by,
          gapDays: row.gap_days,
          suggestedQty: row.suggested_qty,
        }),
      });
      sent += 1;
    } catch (e) {
      const { logAppError } = await import("./ops.server");
      await logAppError(admin, {
        job: "inventory:alert",
        context: { store_id: store.id, sku: row.sku, state: row.state },
        error: e,
      });
    }
  }
  return sent;
}

/** Runs the inventory pass for every connected workspace. Never throws. */
export async function syncInventoryAllTenants(
  admin: Admin,
  opts?: { storeIds?: string[]; force?: boolean },
): Promise<InventorySyncResult[]> {
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

  const results: InventorySyncResult[] = [];
  for (const store of data ?? []) {
    if (!store.middleware_tenant_id) continue;
    try {
      results.push(
        await syncInventoryForStore(
          admin,
          {
            id: store.id,
            middleware_tenant_id: store.middleware_tenant_id,
            store_name: store.store_name,
          },
          opts?.force ? { force: true } : undefined,
        ),
      );
    } catch (e) {
      results.push({
        store_id: store.id,
        ok: false,
        skus: 0,
        alerts: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
