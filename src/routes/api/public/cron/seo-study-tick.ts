import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/seo-study-tick
 *
 * The SEO study orchestrator. Runs every minute and advances ONE study by as
 * many phases as fit in a 40s budget — never one long request that times out.
 *
 * Bounded: one job, one time budget per tick.
 * Single-flight: the job lease is claimed with a conditional UPDATE, so a
 * second tick (or an admin watching the dossier) claims nothing.
 * Idempotent: completed phases live in the artifact and are never re-paid.
 *
 * Authorization: Bearer LOVABLE_CRON_SECRET.
 */
export const Route = createFileRoute("/api/public/cron/seo-study-tick")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCronJob } = await import("@/lib/ops.server");

        const outcome = await runCronJob(supabaseAdmin, "seo-study-tick", async () => {
          const { tickStudies } = await import("@/lib/seo-study.server");
          const result = await tickStudies(supabaseAdmin);
          return {
            job_id: result.jobId,
            status: result.status,
            progress: result.progress,
            phases_advanced: result.ranPhases,
            waiting_on_external_task: result.waiting,
            total_cost: result.totalCost,
          };
        });

        if (!outcome.ok) {
          return Response.json({ error: "SEO study tick failed" }, { status: 500 });
        }
        return Response.json({ ok: true, ...outcome.result });
      },
    },
  },
});
