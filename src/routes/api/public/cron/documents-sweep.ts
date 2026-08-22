import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/cron/documents-sweep
 * Backstop: issues the Payment Receipt for any paid order that lacks one —
 * wallet-paid at intake, admin-resolved orders, or a failed first attempt.
 * Authorization: Authorization: Bearer <LOVABLE_CRON_SECRET>.
 */
export const Route = createFileRoute("/api/public/cron/documents-sweep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env["LOVABLE_CRON_SECRET"];
        const authHeader = request.headers.get("authorization");
        if (!secret || authHeader !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { issueMissingOrderReceipts } = await import(
            "@/lib/documents.server"
          );
          const { issued, errors } = await issueMissingOrderReceipts(supabaseAdmin);
          console.log(`documents sweep: issued=${issued} errors=${errors}`);
          return Response.json({ issued, errors });
        } catch (error) {
          console.error("documents sweep error:", error);
          return Response.json({ error: "Sweep failed" }, { status: 500 });
        }
      },
    },
  },
});
