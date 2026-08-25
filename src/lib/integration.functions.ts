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
