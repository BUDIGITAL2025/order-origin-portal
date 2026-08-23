import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  adminProductStatusSchema,
  createBundleSchema,
  priceOverrideSchema,
  productIdSchema,
  updateBundleSchema,
} from "./schemas";

/** Client: my catalogue — products, per-country prices, bundle components and bundle pricing. */
export const listMyProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: products, error } = await context.supabase
      .from("products")
      .select(
        "id, sku, product_name, variant_label, product_type, moq, status, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: countryPrices, error: countryPricesError } = await context.supabase
      .from("product_country_prices")
      .select("product_id, country_code, unit_price, lead_time_days");
    if (countryPricesError) throw new Error(countryPricesError.message);

    const { data: components, error: componentsError } = await context.supabase
      .from("bundle_components")
      .select(
        "id, bundle_product_id, component_product_id, quantity, component:products!bundle_components_component_product_id_fkey(sku, product_name, variant_label)",
      );
    if (componentsError) throw new Error(componentsError.message);

    const { data: prices, error: pricesError } = await context.supabase
      .from("bundle_prices")
      .select("*");
    if (pricesError) throw new Error(pricesError.message);

    return {
      products: products ?? [],
      countryPrices: countryPrices ?? [],
      components: components ?? [],
      prices: prices ?? [],
    };
  });

/** Client: create a bundle from own active simple products. SKU generated server-side (FSB-). */
export const createBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createBundleSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Bundles live at store level: use the caller's first store.
    const { data: store, error: storeError } = await context.supabase
      .from("stores")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (storeError) throw new Error(storeError.message);
    if (!store) throw new Error("No workspace registered for this account.");
    const { data: product, error } = await context.supabase.rpc("create_bundle", {
      p_store_id: store.id,
      p_name: data.name,
      p_components: data.components,
    });
    if (error) {
      if (error.message.includes("INVALID_COMPONENT")) {
        throw new Error("Components must be your own active simple products.");
      }
      throw new Error(error.message);
    }
    return { ok: true, product };
  });

/** Client: edit a bundle's name and components. */
export const updateBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateBundleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: product, error } = await context.supabase.rpc("update_bundle", {
      p_bundle_id: data.bundle_id,
      p_name: data.name,
      p_components: data.components,
    });
    if (error) {
      if (error.message.includes("INVALID_COMPONENT")) {
        throw new Error("Components must be your own simple products that are not discontinued.");
      }
      throw new Error(error.message);
    }
    return { ok: true, product };
  });

/** Client: discontinue one of my bundles. Deletion is never allowed — discontinue instead. */
export const discontinueMyBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => productIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    // RLS already scopes products to the caller's own stores.
    const { error } = await context.supabase
      .from("products")
      .update({ status: "discontinued" })
      .eq("id", data.product_id)
      .eq("product_type", "bundle");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const adminProductFilterSchema = z.object({
  status: z.enum(["active", "discontinued", "needs_review"]).optional(),
  type: z.enum(["simple", "bundle"]).optional(),
});

/** Admin: every product across all clients, with bundle pricing. */
export const adminListProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminProductFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    let query = admin
      .from("products")
      .select("*, profiles!products_client_id_fkey(company_name)")
      .order("created_at", { ascending: false });
    if (data.status) query = query.eq("status", data.status);
    if (data.type) query = query.eq("product_type", data.type);

    const { data: products, error } = await query;
    if (error) throw new Error(error.message);

    const { data: prices, error: pricesError } = await admin.from("bundle_prices").select("*");
    if (pricesError) throw new Error(pricesError.message);

    const { data: countryPrices, error: countryPricesError } = await admin
      .from("product_country_prices")
      .select("product_id, country_code, unit_price, lead_time_days");
    if (countryPricesError) throw new Error(countryPricesError.message);

    return { products: products ?? [], prices: prices ?? [], countryPrices: countryPrices ?? [] };
  });

/** Admin: set or clear the price override on a bundle. */
export const adminSetPriceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => priceOverrideSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const { data: product, error: readError } = await context.supabase
      .from("products")
      .select("product_type")
      .eq("id", data.product_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (product?.product_type !== "bundle") {
      throw new Error("Price overrides apply to bundles only");
    }

    const { error } = await context.supabase
      .from("products")
      .update({ price_override: data.price_override })
      .eq("id", data.product_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: discontinue or reactivate a product. */
export const adminSetProductStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminProductStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("products")
      .update({ status: data.status })
      .eq("id", data.product_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: requeue a failed store push. The push itself is a TODO (middleware integration). */
export const adminRetryPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => productIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    // TODO: call the middleware to push the product to the supplier Shopify store,
    // then set push_status = 'pushed' + middleware_product_id, or 'failed' + push_error.
    const { error } = await context.supabase
      .from("products")
      .update({ push_status: "pending", push_error: null })
      .eq("id", data.product_id)
      .eq("push_status", "failed");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
