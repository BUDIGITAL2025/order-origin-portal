/**
 * Quote → Fulfilment bridge.
 *
 * Every accepted quote variation (and every PATH A / client-owned stock item)
 * materialises as one catalogue product row = one FS- SKU = one variation.
 * PATH B (direct-to-client) stock purchases never create a product, so they
 * never show up here — they live only in Stock purchases.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

type CatalogRow = {
  id: string;
  sku: string;
  product_name: string;
  variant_label: string | null;
  fulfilment_model: "per_order" | "stock_in";
  status: string;
  archived_at: string | null;
  image_urls: string[];
  client_owned: boolean;
  store_id: string;
  store_name: string | null;
  sellable: number | null;
  days_of_cover: number | null;
  /** Per-variation weight in grams. Data foundation for shipping. */
  weight_grams: number | null;
};

type ResolvedLead = {
  sku: string;
  production_lead: number;
  transit_lead: number;
  safety_margin: number;
  production_origin: string;
  transit_origin: string;
  safety_origin: string;
};

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

type PricingChain = {
  supplier_cogs: number | null;
  supplier_shipping: number | null;
  supplier_tax: number | null;
  sourcing_cost: number | null;
  sourcing_fee_rate: number | null;
  margin_pct: number | null;
  fee_included: boolean | null;
  client_price: number | null;
};

/** Photos: the variation's own set, falling back to the originating quote request. */
async function buildCatalog(
  admin: AdminClient,
  stores: { id: string; store_name?: string | null }[],
): Promise<CatalogRow[]> {
  if (stores.length === 0) return [];
  const storeIds = stores.map((s) => s.id);
  const nameById = new Map(stores.map((s) => [s.id, s.store_name ?? null]));

  const { data: products, error } = await admin
    .from("products")
    .select(
      "id, sku, product_name, variant_label, fulfilment_model, status, archived_at, image_urls, client_owned, store_id, quote_line_id, weight_grams",
    )
    .in("store_id", storeIds)
    .eq("product_type", "simple")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  // Photo fallback: variation photos → originating quote request photos.
  const lineIds = (products ?? [])
    .map((p) => p.quote_line_id)
    .filter((id): id is string => id != null);
  const fallback = new Map<string, string[]>();
  if (lineIds.length > 0) {
    const { data: lines } = await admin
      .from("quote_lines")
      .select("id, sourcing_image_urls, quote_requests(image_urls)")
      .in("id", lineIds);
    for (const l of lines ?? []) {
      const imgs = [
        ...((l.sourcing_image_urls ?? []) as string[]),
        ...(((l.quote_requests as { image_urls?: string[] } | null)?.image_urls ?? []) as string[]),
      ];
      if (imgs.length > 0) fallback.set(l.id as string, imgs.slice(0, 5));
    }
  }

  // Stock figures only matter for stock_in SKUs.
  const stockStores = new Set(
    (products ?? [])
      .filter((p) => p.fulfilment_model === "stock_in")
      .map((p) => p.store_id as string),
  );
  const stockBySku = new Map<string, { sellable: number; days_of_cover: number | null }>();
  if (stockStores.size > 0) {
    const { computeWorkspaceInventory } = await import("./inventory.server");
    for (const store of stores.filter((s) => stockStores.has(s.id))) {
      const view = await computeWorkspaceInventory(admin, store);
      for (const row of view.rows) {
        stockBySku.set(`${store.id}:${row.sku}`, {
          sellable: row.sellable,
          days_of_cover: row.days_of_cover,
        });
      }
    }
  }

  return (products ?? []).map((p) => {
    const own = (p.image_urls ?? []) as string[];
    const stock =
      p.fulfilment_model === "stock_in" ? stockBySku.get(`${p.store_id}:${p.sku}`) : undefined;
    return {
      id: p.id,
      sku: p.sku,
      product_name: p.product_name,
      variant_label: p.variant_label,
      fulfilment_model: p.fulfilment_model,
      status: p.status,
      archived_at: p.archived_at,
      image_urls: own.length > 0 ? own : (fallback.get(p.quote_line_id ?? "") ?? []),
      client_owned: p.client_owned,
      store_id: p.store_id,
      store_name: nameById.get(p.store_id) ?? null,
      sellable: stock?.sellable ?? null,
      days_of_cover: stock?.days_of_cover ?? null,
      weight_grams: p.weight_grams ?? null,
    };
  });
}

/** Shared detail payload. `full` adds the admin-only chain, supplier and origins. */
async function buildSkuDetail(admin: AdminClient, productId: string, full: boolean) {
  const { data: product, error } = await admin
    .from("products")
    .select(
      "id, sku, product_name, variant_label, fulfilment_model, status, archived_at, image_urls, moq, client_owned, store_id, supplier_id, quote_line_id, weight_grams, created_at",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) throw new Error("SKU not found");

  const [{ data: prices }, { data: leads }, { data: orderItems }, { data: inboundLines }] =
    await Promise.all([
      admin
        .from("product_country_prices")
        .select("country_code, unit_price, lead_time_days")
        .eq("product_id", product.id),
      admin.rpc("resolved_lead_times", { p_store_id: product.store_id }),
      admin
        .from("order_items")
        .select(
          "quantity, unit_price, line_total, orders(id, external_order_number, status, created_at, store_id)",
        )
        .eq("sku", product.sku)
        .limit(100),
      admin
        .from("inbound_shipment_lines")
        .select(
          "declared_qty, counted_qty, inbound_shipments(id, status, created_at, received_at, store_id)",
        )
        .eq("sku", product.sku)
        .limit(100),
    ]);

  const lead = ((leads ?? []) as ResolvedLead[]).find((l) => l.sku === product.sku) ?? null;

  let images = (product.image_urls ?? []) as string[];
  let chain: PricingChain | null = null;
  if (product.quote_line_id) {
    const { data: line } = await admin
      .from("quote_lines")
      .select(
        "id, sourcing_image_urls, supplier_cogs, supplier_shipping, supplier_tax, sourcing_cost, sourcing_fee_rate, margin_pct, fee_included, unit_price, country_code, moq, lead_time_days, quote_requests(image_urls, product_name)",
      )
      .eq("id", product.quote_line_id)
      .maybeSingle();
    if (line) {
      if (images.length === 0) {
        images = [
          ...((line.sourcing_image_urls ?? []) as string[]),
          ...(((line.quote_requests as { image_urls?: string[] } | null)?.image_urls ??
            []) as string[]),
        ].slice(0, 5);
      }
      if (full) {
        chain = {
          supplier_cogs: line.supplier_cogs,
          supplier_shipping: line.supplier_shipping,
          supplier_tax: line.supplier_tax,
          sourcing_cost: line.sourcing_cost,
          sourcing_fee_rate: line.sourcing_fee_rate,
          margin_pct: line.margin_pct,
          fee_included: line.fee_included,
          client_price: line.unit_price,
        };
      }
    }
  }

  let supplier: { id: string; name: string } | null = null;
  if (full && product.supplier_id) {
    const { data: s } = await admin
      .from("suppliers")
      .select("id, name")
      .eq("id", product.supplier_id)
      .maybeSingle();
    supplier = s ?? null;
  }

  return {
    product: { ...product, image_urls: images },
    prices: prices ?? [],
    leadTimes: lead
      ? {
          production_lead: lead.production_lead,
          transit_lead: lead.transit_lead,
          safety_margin: lead.safety_margin,
          ...(full
            ? {
                production_origin: lead.production_origin,
                transit_origin: lead.transit_origin,
                safety_origin: lead.safety_origin,
              }
            : {}),
        }
      : null,
    chain,
    supplier,
    orders: (orderItems ?? [])
      .filter((r) => r.orders)
      .map((r) => ({
        id: r.orders.id,
        order_number: r.orders.external_order_number,
        status: r.orders.status,
        created_at: r.orders.created_at,
        quantity: r.quantity,
        line_total: r.line_total,
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    inbound: (inboundLines ?? [])
      .filter((r) => r.inbound_shipments)
      .map((r) => ({
        id: r.inbound_shipments.id,
        status: r.inbound_shipments.status,
        created_at: r.inbound_shipments.created_at,
        received_at: r.inbound_shipments.received_at,
        declared_qty: r.declared_qty,
        counted_qty: r.counted_qty,
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  };
}

/** Client: the fulfilment catalog for one workspace the caller owns. */
export const listFulfilmentCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: store, error } = await context.supabase
      .from("stores")
      .select("id, store_name")
      .eq("id", data.storeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!store) throw new Error("Workspace not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { rows: await buildCatalog(supabaseAdmin, [store]) };
  });

/** Client: full detail for one SKU in a workspace the caller owns. */
export const getFulfilmentSku = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ productId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS proves ownership before the admin client reads the joins.
    const { data: owned, error } = await context.supabase
      .from("products")
      .select("id")
      .eq("id", data.productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!owned) throw new Error("SKU not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildSkuDetail(supabaseAdmin, data.productId, false);
  });

/** Admin: the fulfilment catalog across every workspace. */
export const adminListFulfilmentCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stores, error } = await supabaseAdmin
      .from("stores")
      .select("id, store_name")
      .order("store_name")
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: await buildCatalog(supabaseAdmin, stores ?? []) };
  });

/** Admin: SKU detail with the full pricing chain, supplier and lead-time origins. */
export const adminGetFulfilmentSku = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ productId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildSkuDetail(supabaseAdmin, data.productId, true);
  });

/** Admin: set the per-variation weight in grams (blank clears it). */
export const adminSetProductWeight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ productId: uuid, weight_grams: z.number().int().min(0).max(5_000_000).nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("products")
      .update({ weight_grams: data.weight_grams })
      .eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type { CatalogRow, PricingChain };
