import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/daily-digest
 * Daily ops digest emailed to ADMIN_DIGEST_EMAIL: failed Stripe webhooks,
 * failed cron runs, quotes past their SLA and the raw error count.
 * Authorization: Bearer LOVABLE_CRON_SECRET.
 */
export const Route = createFileRoute("/api/public/cron/daily-digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { runCronJob } = await import("@/lib/ops.server");

        const outcome = await runCronJob(supabaseAdmin, "daily-digest", async () => {
          const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
          const nowIso = new Date().toISOString();

          const [webhooks, crons, quotes, errors] = await Promise.all([
            supabaseAdmin
              .from("stripe_events")
              .select("stripe_event_id, event_type, error", { count: "exact" })
              .not("error", "is", null)
              .gte("created_at", since)
              .limit(10),
            supabaseAdmin
              .from("cron_runs")
              .select("job, started_at, error", { count: "exact" })
              .eq("ok", false)
              .gte("started_at", since)
              .limit(10),
            supabaseAdmin
              .from("quote_requests")
              .select("id, created_at, quote_due_at", { count: "exact" })
              .in("status", ["submitted", "sourcing"])
              .lt("quote_due_at", nowIso)
              .limit(10),
            supabaseAdmin
              .from("error_logs")
              .select("job, error", { count: "exact" })
              .gte("created_at", since)
              .limit(10),
          ]);

          const summary = {
            failed_webhooks: webhooks.count ?? 0,
            failed_crons: crons.count ?? 0,
            quotes_past_sla: quotes.count ?? 0,
            errors: errors.count ?? 0,
          };

          const lines: string[] = [
            `FlySales daily ops digest — ${new Date().toISOString().slice(0, 10)}`,
            "",
            `Failed Stripe webhooks (24h): ${summary.failed_webhooks}`,
            ...(webhooks.data ?? []).map(
              (w) => `  • ${w.event_type} (${w.stripe_event_id}): ${w.error}`,
            ),
            "",
            `Failed cron runs (24h): ${summary.failed_crons}`,
            ...(crons.data ?? []).map(
              (c) => `  • ${c.job} @ ${c.started_at}: ${c.error}`,
            ),
            "",
            `Quotes past SLA (open): ${summary.quotes_past_sla}`,
            ...(quotes.data ?? []).map(
              (q) => `  • ${q.id} due ${q.quote_due_at}`,
            ),
            "",
            `Logged errors (24h): ${summary.errors}`,
            ...(errors.data ?? []).map((e) => `  • ${e.job}: ${e.error}`),
            "",
            "https://app.flysales.app/admin",
          ];

          const { sendAdminEmail } = await import("@/lib/email.server");
          const sent = await sendAdminEmail({
            subject: `FlySales ops digest — ${summary.failed_webhooks} webhook / ${summary.failed_crons} cron failures`,
            text: lines.join("\n"),
          });

          return { ...summary, email_sent: sent.sent };
        });

        if (!outcome.ok) {
          return Response.json({ error: "Digest failed" }, { status: 500 });
        }
        return Response.json({ ok: true, ...outcome.result });
      },
    },
  },
});
