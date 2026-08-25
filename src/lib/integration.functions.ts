import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Admin: integration status, recent inbound events and outbound calls. */
export const adminIntegrationOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { middlewareConfig } = await import("./middleware.server");
    const config = middlewareConfig();

    const [events, calls] = await Promise.all([
      admin
        .from("integration_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("integration_calls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (events.error) throw new Error(events.error.message);
    if (calls.error) throw new Error(calls.error.message);

    return {
      status: {
        base_url_set: config.baseUrl !== null,
        service_token_set: config.serviceToken !== null,
        webhook_secret_set: config.webhookSecret !== null,
      },
      events: events.data ?? [],
      calls: calls.data ?? [],
    };
  });

/** Admin: re-run a stored event that previously failed. */
export const adminReplayIntegrationEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ event_id: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: event, error } = await admin
      .from("integration_events")
      .select("event_id, event_type, tenant_id, payload")
      .eq("event_id", data.event_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!event) throw new Error("Event not found");

    const { runStoredEvent } = await import("./middleware.server");
    return runStoredEvent(admin, event);
  });

/** Admin: middleware-sourced orders and their outbound release state. */
export const adminIntegrationReleases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data, error } = await admin
      .from("orders")
      .select(
        "id, middleware_order_id, external_order_number, status, total_amount, release_status, release_sent_at, release_last_attempt_at, release_attempts, release_error, paid_at, created_at",
      )
      .eq("source", "middleware")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { releases: data ?? [] };
  });

/** Admin: manually re-send a stuck release/reject for one order. */
export const adminRetryRelease = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { dispatchPendingReleases } = await import("./middleware.server");
    const results = await dispatchPendingReleases(admin, {
      orderIds: [data.order_id],
      limit: 1,
    });
    return { result: results[0] ?? { order_id: data.order_id, status: "not_queued" } };
  });

/** Admin: Phase 4 pull-sync state per tenant. */
export const adminSyncOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data, error } = await admin
      .from("middleware_sync_state")
      .select(
        "store_id, tenant_id, last_synced_at, last_success_at, orders_ingested, last_error, consecutive_failures, first_failure_at, last_seen_order_ids, stores(store_name)",
      )
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const { count } = await admin
      .from("stores")
      .select("id", { count: "exact", head: true })
      .not("middleware_tenant_id", "is", null)
      .eq("integration_mode", "automatic")
      .eq("status", "active");

    // Reconciliation: orders that came in on the fast path (webhook push) vs
    // ones the redundancy poller had to catch. Healthy = ~all webhook, ~0 poll.
    const { data: pathRows, error: pathError } = await admin
      .from("integration_events")
      .select("tenant_id, event_type, entry_path")
      .in("event_type", ["order.created", "tracking.updated"])
      .limit(5000);
    if (pathError) throw new Error(pathError.message);

    const byTenant: Record<
      string,
      { orders_webhook: number; orders_poll: number; tracking_webhook: number; tracking_poll: number }
    > = {};
    for (const row of pathRows ?? []) {
      const key = row.tenant_id ?? "unknown";
      const bucket = (byTenant[key] ??= {
        orders_webhook: 0,
        orders_poll: 0,
        tracking_webhook: 0,
        tracking_poll: 0,
      });
      const poll = row.entry_path === "poll";
      if (row.event_type === "order.created") {
        if (poll) bucket.orders_poll += 1;
        else bucket.orders_webhook += 1;
      } else if (poll) bucket.tracking_poll += 1;
      else bucket.tracking_webhook += 1;
    }

    return { tenants: data ?? [], connected_workspaces: count ?? 0, entry_paths: byTenant };
  });

/** Admin: run the pull sync immediately (all tenants, or one workspace). */
export const adminSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ store_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { syncAllTenants } = await import("./middleware-sync.server");
    const results = await syncAllTenants(
      admin,
      data.store_id ? { storeIds: [data.store_id] } : undefined,
    );
    return { results };
  });
