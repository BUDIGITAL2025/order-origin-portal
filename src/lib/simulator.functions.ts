import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * TEST TOOLING (Phase 3): admin-only middleware simulator controls.
 * Every function verifies the admin role before touching the service role.
 */

async function admin(context: { supabase: never; userId: string }) {
  const { requireAdmin, getAdminClient } = await import("./admin.server");
  await requireAdmin(context.supabase as never, context.userId);
  return getAdminClient();
}

/** Status of the simulator: token, override state, and a simulatable workspace. */
export const adminSimulatorStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context as never);
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
      calls: calls.data ?? [],
    };
  });

/** Turn the "point releases at the simulator" override on or off. */
export const adminSetSimulatorOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin(context as never);
    const { setReleaseOverride } = await import("./simulator.server");
    await setReleaseOverride(db, data.enabled);
    return { enabled: data.enabled };
  });

/** Emit a signed order.created into our own webhook. */
export const adminSimulateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context as never);
    const { simulateOrderCreated } = await import("./simulator.server");
    return simulateOrderCreated(db);
  });

/** Emit a signed tracking.updated for a middleware order. */
export const adminSimulateTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin(context as never);
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
    const db = await admin(context as never);
    const { simulateOrderStatus } = await import("./simulator.server");
    return simulateOrderStatus(db, data.order_id, data.status);
  });
