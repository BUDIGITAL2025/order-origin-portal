import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * TEMPORARY one-off backfill: issues missing payment receipts for wallet
 * credits and paid orders. Guarded by the cron secret. Delete this route
 * after the backfill has run.
 */
export const Route = createFileRoute("/api/public/cron/backfill-receipts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { backfillMissingReceipts } = await import("@/lib/documents.server");
        const result = await backfillMissingReceipts(supabaseAdmin);
        return Response.json(result);
      },
    },
  },
});
