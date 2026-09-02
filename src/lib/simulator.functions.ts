import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * TEST TOOLING (Phase 3): admin-only middleware simulator controls.
 * Every function verifies the admin role before touching the service role.
 */

/** Status of the simulator: token, override state, and a simulatable workspace. */
export const adminSimulatorStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const sim = await import("./simulator.server");
    const { middlewareConfig } = await import("./middleware.server");
    const config = middlewareConfig();
    const realConfigured = config.baseUrl !== null && !sim.isSimulatorUrl(config.baseUrl);

    const [target, calls] = await Promise.all([
      sim.findSimulatableWorkspace(db).catch(() => null),
      db
        .from("simulator_calls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    return {
      token_set: sim.simulatorToken() !== null,
      webhook_secret_set: config.webhookSecret !== null,
      app_base_url: await sim.appBaseUrl(db),
      simulator_url: await sim.simulatorBaseUrl(db),
      override_enabled: await sim.releaseOverrideEnabled(db),
      real_middleware_configured: realConfigured,
      workspace: target
        ? {
            id: target.store.id,
            name: target.store.store_name,
            tenant_id: target.store.middleware_tenant_id,
            skus: target.skus.slice(0, 6),
            countries: target.countries,
          }
        : null,
      pull_queue: await sim.listSimulatorPullOrders(db),
      inventory_rows: (await sim.listSimulatorInventory(db)).length,
      calls: calls.data ?? [],
    };
  });

/** Turn the "point releases at the simulator" override on or off. */
export const adminSetSimulatorOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { setReleaseOverride } = await import("./simulator.server");
    await setReleaseOverride(db, data.enabled);
    return { enabled: data.enabled };
  });

/** Emit a signed order.created into our own webhook. */
export const adminSimulateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { simulateOrderCreated } = await import("./simulator.server");
    return simulateOrderCreated(db);
  });

/** Emit a signed tracking.updated for a middleware order. */
export const adminSimulateTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { simulateTracking } = await import("./simulator.server");
    return simulateTracking(db, data.order_id);
  });

/** Emit a signed order.updated status change for a middleware order. */
export const adminSimulateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        status: z.enum(["processing", "shipped", "delivered", "cancelled", "needs_review"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { simulateOrderStatus } = await import("./simulator.server");
    return simulateOrderStatus(db, data.order_id, data.status);
  });

/** Queue a fake order for the simulator's GET /orders list (pull loop). */
export const adminQueueSimulatorPullOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { queueSimulatorPullOrder } = await import("./simulator.server");
    const order = await queueSimulatorPullOrder(db);
    return {
      id: order.id,
      order_number: order.order_number,
      country: order.country,
      lines: order.line_items,
    };
  });

/** Mark a queued fake order shipped with tracking, for the poller to pick up. */
export const adminSimulatePullTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ middleware_order_id: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { setSimulatorPullTracking } = await import("./simulator.server");
    return setSimulatorPullTracking(db, data.middleware_order_id);
  });

/** Empty the simulator's pull queue (test cleanup). */
export const adminClearSimulatorPullQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { clearSimulatorPullQueue } = await import("./simulator.server");
    await clearSimulatorPullQueue(db);
    return { cleared: true };
  });

/** Seed fake stock levels for the simulatable workspace (Phase 5). */
export const adminSeedSimulatorInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tight: z.boolean().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { seedSimulatorInventory } = await import("./simulator.server");
    return seedSimulatorInventory(db, data.tight ? { tight: true } : undefined);
  });

/** Empty the simulator's fake stock table (test cleanup). */
export const adminClearSimulatorInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdminClient();
    const { clearSimulatorInventory } = await import("./simulator.server");
    await clearSimulatorInventory(db);
    return { cleared: true };
  });
