import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/middleware-retry
 *
 * Re-sends middleware releases (and rejects) that are still queued: failed
 * calls, timeouts and everything held while the integration was unconfigured.
 * Releases stuck for more than 6h are logged to error_logs so the daily digest
 * surfaces them. Payment is never touched here — money has already settled.
 * Authorization: Bearer LOVABLE_CRON_SECRET.
 */
const STALE_HOURS = 6;

export const Route = createFileRoute("/api/public/cron/middleware-retry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCronJob, logAppError } = await import("@/lib/ops.server");

        const outcome = await runCronJob(supabaseAdmin, "middleware-retry", async () => {
          const { dispatchPendingReleases } = await import("@/lib/middleware.server");
          const results = await dispatchPendingReleases(supabaseAdmin, { limit: 100 });

          // Stuck-release alert: still queued more than STALE_HOURS after the
          // order was paid/cancelled.
          const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString();
          const { data: stale } = await supabaseAdmin
            .from("orders")
            .select("id, middleware_order_id, release_status, paid_at, cancelled_at")
            .eq("source", "middleware")
            .in("release_status", ["pending", "failed", "pending_reject"])
            .lt("created_at", cutoff)
            .limit(20);

          if (stale && stale.length > 0) {
            await logAppError(supabaseAdmin, {
              job: "middleware:release-stuck",
              context: { count: stale.length, orders: stale.map((o) => o.middleware_order_id) },
              error: `${stale.length} middleware release(s) stuck for more than ${STALE_HOURS}h`,
            });
          }

          const sent = results.filter((r) => r.status === "sent" || r.status === "rejected").length;
          return {
            attempted: results.length,
            sent,
            still_queued: results.length - sent,
            stuck: stale?.length ?? 0,
          };
        });

        if (!outcome.ok) {
          return Response.json({ error: "Middleware retry failed" }, { status: 500 });
        }
        return Response.json({ ok: true, ...outcome.result });
      },
    },
  },
});
