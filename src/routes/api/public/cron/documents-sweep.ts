import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/documents-sweep
 * Backstop: issues the Payment Receipt for any paid order that lacks one —
 * wallet-paid at intake, admin-resolved orders, or a failed first attempt.
 * Authorization: Bearer or x-cron-secret with LOVABLE_CRON_SECRET (timing-safe).
 */
export const Route = createFileRoute("/api/public/cron/documents-sweep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { runCronJob } = await import("@/lib/ops.server");
        const outcome = await runCronJob(supabaseAdmin, "documents-sweep", async () => {
          const { issueMissingOrderReceipts } = await import(
            "@/lib/documents.server"
          );
          const { issued, errors } = await issueMissingOrderReceipts(supabaseAdmin);
          console.log(`documents sweep: issued=${issued} errors=${errors}`);
          return { issued, errors };
        });
        if (!outcome.ok) {
          return Response.json({ error: "Sweep failed" }, { status: 500 });
        }
        return Response.json(outcome.result);
      },
    },
  },
});
