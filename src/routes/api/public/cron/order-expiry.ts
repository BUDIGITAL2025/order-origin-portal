import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/order-expiry
 * Payment gate housekeeping for orders stuck in 'awaiting_payment':
 *  - 24h / 48h / 72h payment reminders (in-app notification + email stub), each sent once
 *  - auto-cancel after 7 days unpaid
 * Authorization: Bearer or x-cron-secret with LOVABLE_CRON_SECRET (timing-safe).
 * Idempotent: reminder columns and the status filter make re-runs no-ops.
 */

const REMINDER_STEPS = [
  { hours: 24, column: "reminder_24_sent_at", kind: "order_reminder_24" },
  { hours: 48, column: "reminder_48_sent_at", kind: "order_reminder_48" },
  { hours: 72, column: "reminder_72_sent_at", kind: "order_reminder_72" },
] as const;

const AUTO_CANCEL_DAYS = 7;

function formatUsd(amount: number | null): string {
  return `$${Number(amount ?? 0).toFixed(2)}`;
}

function orderLabel(order: { id: string; external_order_number: string | null }): string {
  return order.external_order_number ?? order.id.slice(0, 8);
}

/** Resolves the owning account (auth user) id through the store → entity chain. */
function accountIdOf(order: {
  stores?: { entities?: { account_id?: string | null } | null } | null;
}): string | null {
  return order.stores?.entities?.account_id ?? null;
}

export const Route = createFileRoute("/api/public/cron/order-expiry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { runCronJob } = await import("@/lib/ops.server");
        const outcome = await runCronJob(supabaseAdmin, "order-expiry", async () => {
          const { sendClientEmail } = await import("@/lib/email.server");
          const { flagBreachedQuotes } = await import("@/lib/quotes.server");
          const now = Date.now();
          const summary = {
            reminder_24: 0,
            reminder_48: 0,
            reminder_72: 0,
            cancelled: 0,
            quote_sla_breached: 0,
          };

          for (const step of REMINDER_STEPS) {
            const cutoff = new Date(now - step.hours * 3_600_000).toISOString();
            const { data: orders, error } = await supabaseAdmin
              .from("orders")
              .select(
                "id, store_id, external_order_number, total_amount, stores(entities(account_id))",
              )
              .eq("status", "awaiting_payment")
              .lte("created_at", cutoff)
              .is(step.column, null);
            if (error) throw new Error(error.message);

            for (const order of orders ?? []) {
              // Mark first with a guarded update so a concurrent run can't double-send.
              const stamp = new Date().toISOString();
              const patch =
                step.column === "reminder_24_sent_at"
                  ? { reminder_24_sent_at: stamp }
                  : step.column === "reminder_48_sent_at"
                    ? { reminder_48_sent_at: stamp }
                    : { reminder_72_sent_at: stamp };
              const { error: markError } = await supabaseAdmin
                .from("orders")
                .update(patch)
                .eq("id", order.id)
                .is(step.column, null);
              if (markError) continue;

              const label = orderLabel(order);
              const body = `Order ${label} (${formatUsd(order.total_amount)}) is still awaiting payment. It will auto-cancel ${AUTO_CANCEL_DAYS} days after it was created.`;
              // Order-status notifications are store-scoped.
              await supabaseAdmin.from("notifications").insert({
                store_id: order.store_id,
                kind: step.kind,
                title: "Payment reminder",
                body,
              });
              const accountId = accountIdOf(order);
              if (accountId) {
                await sendClientEmail(supabaseAdmin, {
                  clientId: accountId,
                  subject: `Payment reminder — order ${label}`,
                  text: body,
                });
              }
              summary[`reminder_${step.hours}` as keyof typeof summary] += 1;
            }
          }

          const cancelCutoff = new Date(
            now - AUTO_CANCEL_DAYS * 24 * 3_600_000,
          ).toISOString();
          const { data: stale, error: staleError } = await supabaseAdmin
            .from("orders")
            .select(
              "id, store_id, external_order_number, total_amount, stores(entities(account_id))",
            )
            .eq("status", "awaiting_payment")
            .lte("created_at", cancelCutoff);
          if (staleError) throw new Error(staleError.message);

          for (const order of stale ?? []) {
            // Guarded status transition: only cancel if still unpaid.
            const { error: cancelError } = await supabaseAdmin
              .from("orders")
              .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
              .eq("id", order.id)
              .eq("status", "awaiting_payment");
            if (cancelError) continue;

            const label = orderLabel(order);
            const body = `Order ${label} (${formatUsd(order.total_amount)}) was cancelled after ${AUTO_CANCEL_DAYS} days without payment.`;
            await supabaseAdmin.from("notifications").insert({
              store_id: order.store_id,
              kind: "order_auto_cancelled",
              title: "Order cancelled",
              body,
            });
            const accountId = accountIdOf(order);
            if (accountId) {
              await sendClientEmail(supabaseAdmin, {
                clientId: accountId,
                subject: `Order ${label} cancelled`,
                text: body,
              });
            }
            summary.cancelled += 1;
          }

          // Middleware-sourced cancellations queue a reject (the DB trigger
          // sets pending_reject, and never after a release was sent).
          {
            const { dispatchPendingReleases } = await import("@/lib/middleware.server");
            await dispatchPendingReleases(supabaseAdmin, { limit: 50 });
          }

          // Quote SLA sweep: stamp open requests that breached their 48h
          // sourcing target and record a notification (admins read all).
          summary.quote_sla_breached = await flagBreachedQuotes(supabaseAdmin);

          console.log("order expiry sweep:", JSON.stringify(summary));
          return summary;
        });
        if (!outcome.ok) {
          return Response.json({ error: "Sweep failed" }, { status: 500 });
        }
        return Response.json({ ok: true, ...outcome.result });
      },
    },
  },
});
