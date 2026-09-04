/**
 * Inventory & reorders — server functions.
 *
 * Clients read their own workspace's forecast (resolved lead-time days only,
 * never supplier identities). Admins read every workspace, manage suppliers
 * and set the planning fields that feed the cascade.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const days = z.number().int().min(0).max(365);

/** The client view: one workspace the caller owns. */
export const getWorkspaceInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    // Ownership through RLS on the caller's own client — no admin shortcut.
    const { data: store, error } = await context.supabase
      .from("stores")
      .select("id, store_name, integration_mode, middleware_tenant_id")
      .eq("id", data.storeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!store) throw new Error("Workspace not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeWorkspaceInventory } = await import("./inventory.server");
    const view = await computeWorkspaceInventory(supabaseAdmin, store);

    // Clients never see supplier attribution — strip the origin markers.
    return {
      ...view,
      connected: store.integration_mode === "automatic" && store.middleware_tenant_id != null,
      rows: view.rows.map(({ production_origin, transit_origin, safety_origin, ...row }) => {
        void production_origin;
        void transit_origin;
        void safety_origin;
        return row;
      }),
    };
  });

/**
 * Create (or update) a manually tracked inventory item in a workspace the
 * caller owns. Derived figures — sellable, sales, state — are never accepted
 * from the client; they are computed from this data.
 */
export const createInventoryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storeId: uuid,
        sku: z.string().trim().min(1).max(64),
        product_name: z.string().trim().min(1).max(200),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
        warehouses: z
          .array(
            z.object({
              location: z.string().trim().min(1).max(80),
              quantity: z.number().int().min(0).max(10_000_000),
            }),
          )
          .min(1)
          .max(20)
          .refine(
            (list) =>
              new Set(list.map((w) => w.location.toLowerCase())).size === list.length,
            { message: "Each warehouse can only appear once." },
          ),

        reserved: z.number().int().min(0).max(10_000_000).default(0),
        incoming: z.number().int().min(0).max(10_000_000).default(0),
        weight: z.number().min(0).max(1_000_000).nullable().default(null),
        weight_unit: z.enum(["g", "kg"]).default("g"),
        lead_time_days: days,
        shipping_routes: z
          .array(
            z.object({
              destination: z.string().trim().min(1).max(80),
              handling_time_days: days,
              is_default: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: product, error } = await context.supabase.rpc("upsert_manual_inventory_item", {
      p_store_id: data.storeId,
      p_sku: data.sku,
      p_product_name: data.product_name,
      p_tags: data.tags,
      p_in_warehouse: data.in_warehouse,
      p_reserved: data.reserved,
      p_incoming: data.incoming,
      // The generated arg types mark these non-nullable; SQL accepts NULL.
      p_weight: data.weight as unknown as number,
      p_weight_unit: (data.weight ? data.weight_unit : null) as unknown as string,

      p_lead_time_days: data.lead_time_days,
      p_routes: data.shipping_routes,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, product };
  });



/** Admin: every connected workspace, with lead-time origin indicators. */
export const getAdminInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeWorkspaceInventory } = await import("./inventory.server");

    const { data: stores, error } = await supabaseAdmin
      .from("stores")
      .select("id, store_name, middleware_tenant_id, default_production_lead_days, default_transit_lead_days, default_safety_margin_days")
      .order("store_name")
      .limit(100);
    if (error) throw new Error(error.message);

    const workspaces = [];
    for (const store of stores ?? []) {
      const view = await computeWorkspaceInventory(supabaseAdmin, store);
      if (view.rows.length === 0) continue;
      workspaces.push({
        ...view,
        tenant_id: store.middleware_tenant_id,
        defaults: {
          production: store.default_production_lead_days,
          transit: store.default_transit_lead_days,
          safety: store.default_safety_margin_days,
        },
      });
    }
    return { workspaces };
  });

/** Admin: force a stock pull now (also recomputes velocity and alerts). */
export const syncInventoryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ storeId: uuid.optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncInventoryAllTenants } = await import("./inventory.server");
    const results = await syncInventoryAllTenants(supabaseAdmin, {
      force: true,
      ...(data.storeId ? { storeIds: [data.storeId] } : {}),
    });
    return { results };
  });

// ============= Suppliers (admin only) =============

export const listSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: suppliers, error }, { data: products }] = await Promise.all([
      supabaseAdmin.from("suppliers").select("*").order("name"),
      supabaseAdmin.from("products").select("supplier_id").not("supplier_id", "is", null),
    ]);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const p of products ?? []) {
      if (p.supplier_id) counts.set(p.supplier_id, (counts.get(p.supplier_id) ?? 0) + 1);
    }
    return {
      suppliers: (suppliers ?? []).map((s) => ({ ...s, linked_skus: counts.get(s.id) ?? 0 })),
    };
  });

const supplierInput = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(2000).nullable().optional(),
  default_production_lead_days: days,
  default_transit_lead_days: days,
  active: z.boolean(),
});

export const saveSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => supplierInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      name: data.name,
      notes: data.notes ?? null,
      default_production_lead_days: data.default_production_lead_days,
      default_transit_lead_days: data.default_transit_lead_days,
      active: data.active,
      updated_at: new Date().toISOString(),
    };
    // A supplier default change silently re-resolves every linked SKU: the
    // cascade is computed at read time, so there is nothing to backfill.
    const query = data.id
      ? supabaseAdmin.from("suppliers").update(payload).eq("id", data.id).select().maybeSingle()
      : supabaseAdmin.from("suppliers").insert(payload).select().maybeSingle();
    const { data: row, error } = await query;
    if (error) throw new Error(error.message);
    return { supplier: row };
  });

// ============= Planning fields =============

export const setProductPlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        productId: uuid,
        supplier_id: uuid.nullable(),
        production_lead_days: days.nullable(),
        transit_lead_days: days.nullable(),
        safety_margin_days: days.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("products")
      .update({
        supplier_id: data.supplier_id,
        production_lead_days: data.production_lead_days,
        transit_lead_days: data.transit_lead_days,
        safety_margin_days: data.safety_margin_days,
      })
      .eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setWorkspacePlanningDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storeId: uuid,
        default_production_lead_days: days,
        default_transit_lead_days: days,
        default_safety_margin_days: days,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("stores")
      .update({
        default_production_lead_days: data.default_production_lead_days,
        default_transit_lead_days: data.default_transit_lead_days,
        default_safety_margin_days: data.default_safety_margin_days,
      })
      .eq("id", data.storeId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: current planning fields for one catalogue product. */
export const getProductPlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ productId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("products")
      .select(
        "id, sku, product_name, supplier_id, production_lead_days, transit_lead_days, safety_margin_days",
      )
      .eq("id", data.productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Product not found");
    return row;
  });
