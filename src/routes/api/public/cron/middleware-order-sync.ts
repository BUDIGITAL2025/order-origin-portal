import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/middleware-order-sync
 *
 * Phase 4 — PULL ingestion. Every 5 minutes we poll the middleware's admin
 * order list per connected workspace and reconcile it with our shadow orders:
 * unknown orders go through the existing ingest RPC (payment gate intact),
 * known orders get status/tracking changes applied through the existing
 * handlers. Middleware down or auth failing is recorded and retried next
 * cycle — never an error on the cron itself.
 * Authorization: Bearer LOVABLE_CRON_SECRET.
 */
export const Route = createFileRoute("/api/public/cron/middleware-order-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCronJob } = await import("@/lib/ops.server");

        const outcome = await runCronJob(supabaseAdmin, "middleware-order-sync", async () => {
          const { syncAllTenants } = await import("@/lib/middleware-sync.server");
          const results = await syncAllTenants(supabaseAdmin);

          // Phase 5 — the inventory pass rides along, throttled to every 30
          // minutes internally. It never fails the order sync.
          let inventory = { tenants: 0, skus: 0, alerts: 0, failed: 0 };
          try {
            const { syncInventoryAllTenants } = await import("@/lib/inventory.server");
            const inv = await syncInventoryAllTenants(supabaseAdmin);
            inventory = {
              tenants: inv.filter((r) => r.ok && !r.skipped).length,
              skus: inv.reduce((sum, r) => sum + r.skus, 0),
              alerts: inv.reduce((sum, r) => sum + r.alerts, 0),
              failed: inv.filter((r) => !r.ok).length,
            };
          } catch (e) {
            const { logAppError } = await import("@/lib/ops.server");
            await logAppError(supabaseAdmin, { job: "inventory:sync", error: e });
          }

          return {
            tenants: results.length,
            succeeded: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length,
            ingested: results.reduce((sum, r) => sum + r.ingested, 0),
            updated: results.reduce((sum, r) => sum + r.updated, 0),
            needs_review: results.reduce((sum, r) => sum + r.needs_review, 0),
            inventory,
          };
        });

        // A failure here is already recorded in cron_runs/error_logs; the next
        // cycle retries. Answer 200 so the scheduler does not back off.
        if (!outcome.ok) return Response.json({ ok: false, error: "sync failed" });
        return Response.json({ ok: true, ...outcome.result });
      },
    },
  },
});
