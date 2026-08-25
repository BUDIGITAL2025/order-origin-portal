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

          const staleReleaseCutoff = new Date(Date.now() - 6 * 3_600_000).toISOString();
          const [webhooks, crons, quotes, errors, integration, releases, syncDown] = await Promise.all([
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
            supabaseAdmin
              .from("integration_events")
              .select("event_id, event_type, tenant_id, error", { count: "exact" })
              .eq("simulator", false)
              .not("error", "is", null)
              .gte("created_at", since)
              .limit(10),
            supabaseAdmin
              .from("orders")
              .select("middleware_order_id, release_status, release_error", { count: "exact" })
              .eq("source", "middleware")
              .in("release_status", ["pending", "failed", "pending_reject"])
              .lt("created_at", staleReleaseCutoff)
              .limit(10),
            supabaseAdmin
              .from("middleware_sync_state")
              .select("tenant_id, last_error, consecutive_failures, first_failure_at", {
                count: "exact",
              })
              .gt("consecutive_failures", 0)
              .lt("first_failure_at", new Date(Date.now() - 3_600_000).toISOString())
              .limit(10),
          ]);

          const summary = {
            failed_webhooks: webhooks.count ?? 0,
            failed_crons: crons.count ?? 0,
            quotes_past_sla: quotes.count ?? 0,
            errors: errors.count ?? 0,
            failed_integration_events: integration.count ?? 0,
            stuck_releases: releases.count ?? 0,
            tenants_sync_down: syncDown.count ?? 0,
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
            `Failed middleware events (24h): ${summary.failed_integration_events}`,
            ...(integration.data ?? []).map(
              (e) => `  • ${e.event_type} (${e.event_id}, tenant ${e.tenant_id ?? "unknown"}): ${e.error}`,
            ),
            "",
            `Middleware releases stuck >6h: ${summary.stuck_releases}`,
            ...(releases.data ?? []).map(
              (r) => `  • ${r.middleware_order_id} (${r.release_status}): ${r.release_error ?? "no error recorded"}`,
            ),
            "",
            `Tenants with order sync failing >1h: ${summary.tenants_sync_down}`,
            ...(syncDown.data ?? []).map(
              (t) => `  • tenant ${t.tenant_id} (${t.consecutive_failures} failures since ${t.first_failure_at}): ${t.last_error ?? "no error recorded"}`,
            ),
            "",
            "https://app.flysales.app/admin/integration",
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
