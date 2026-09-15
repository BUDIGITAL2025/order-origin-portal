import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * GET /api/public/cron/purchase-expiry
 * Housekeeping for accepted purchases stuck in 'awaiting_payment':
 *  - one reminder from day 3 (in-app notification + client email)
 *  - auto-expire (cancel) after 7 days unpaid, with a client email
 * The quote itself stays valid: while it has not expired the client can
 * accept again and a fresh purchase is created.
 * Authorization: Bearer or x-cron-secret with LOVABLE_CRON_SECRET.
 * Idempotent: the status filter and the notification guard make re-runs no-ops.
 */

const REMINDER_DAYS = 3;

export const Route = createFileRoute("/api/public/cron/purchase-expiry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCronJob } = await import("@/lib/ops.server");
        const outcome = await runCronJob(supabaseAdmin, "purchase-expiry", async () => {
          const { sendClientEmail } = await import("@/lib/email.server");
          const { purchaseRef, PURCHASE_PAYMENT_DAYS } = await import("@/lib/purchases.server");
          const { purchaseExpiredEmail } = await import("@/lib/email-templates.server");
          const now = Date.now();
          const summary = { reminded: 0, expired: 0 };

          const label = (p: { product_name: string; variant_label: string | null }) =>
            p.variant_label ? `${p.product_name} — ${p.variant_label}` : p.product_name;

          const accountOf = (p: {
            stores?: { entities?: { account_id?: string | null } | null } | null;
          }) => p.stores?.entities?.account_id ?? null;

          const SELECT =
            "id, store_id, product_name, variant_label, quantity, total_amount, created_at, stores(entities(account_id))";

          // --- Day 3: one nudge, tracked by the notification we already sent.
          const remindCutoff = new Date(now - REMINDER_DAYS * 86_400_000).toISOString();
          const { data: waiting, error: waitingError } = await supabaseAdmin
            .from("stock_purchases")
            .select(SELECT)
            .eq("status", "awaiting_payment")
            .lte("created_at", remindCutoff)
            .limit(500);
          if (waitingError) throw new Error(waitingError.message);

          for (const p of waiting ?? []) {
            const ref = purchaseRef(p.id);
            const { data: already } = await supabaseAdmin
              .from("notifications")
              .select("id")
              .eq("store_id", p.store_id)
              .eq("kind", "purchase_payment_reminder")
              .ilike("body", `%${ref}%`)
              .maybeSingle();
            if (already) continue;

            await supabaseAdmin.from("notifications").insert({
              store_id: p.store_id,
              kind: "purchase_payment_reminder",
              title: "Purchase awaiting payment",
              body: `Purchase ${ref} (${label(p)}) is still awaiting payment. It expires ${PURCHASE_PAYMENT_DAYS} days after you accepted the quote.`,
            });
            summary.reminded += 1;
          }

          // --- Day 7: release it. Nothing was ever charged.
          const expireCutoff = new Date(
            now - PURCHASE_PAYMENT_DAYS * 86_400_000,
          ).toISOString();
          const { data: stale, error: staleError } = await supabaseAdmin
            .from("stock_purchases")
            .select(SELECT)
            .eq("status", "awaiting_payment")
            .lte("created_at", expireCutoff)
            .limit(500);
          if (staleError) throw new Error(staleError.message);

          for (const p of stale ?? []) {
            // Guarded transition: never touch a purchase that just got paid.
            const { error: cancelError } = await supabaseAdmin
              .from("stock_purchases")
              .update({ status: "cancelled" })
              .eq("id", p.id)
              .eq("status", "awaiting_payment");
            if (cancelError) continue;

            const ref = purchaseRef(p.id);
            await supabaseAdmin.from("notifications").insert({
              store_id: p.store_id,
              kind: "purchase_expired",
              title: "Purchase expired",
              body: `Purchase ${ref} (${label(p)}) expired after ${PURCHASE_PAYMENT_DAYS} days without payment. Your quote stays valid until it expires.`,
            });
            const accountId = accountOf(p);
            if (accountId) {
              await sendClientEmail(supabaseAdmin, {
                clientId: accountId,
                ...purchaseExpiredEmail({
                  purchaseRef: ref,
                  productName: label(p),
                  quantity: Number(p.quantity ?? 0),
                  total: Number(p.total_amount ?? 0),
                  days: PURCHASE_PAYMENT_DAYS,
                }),
              });
            }
            summary.expired += 1;
          }

          return summary;
        });

        return Response.json(outcome);
      },
    },
  },
});
