import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Auto top-up cron — charges the client's saved card off_session when their
 * wallet balance falls below their own threshold, and credits on success.
 *
 * Safety rules (per product spec):
 * - Entirely client-controlled: only profiles with auto_topup_enabled are touched.
 * - One charge attempt per client per UTC day (idempotency key) — a repeated
 *   cron run returns the SAME PaymentIntent instead of double-charging.
 * - On failure: notify the client and log it. Never retry in a loop, never
 *   disable the account.
 *
 * Schedule: hourly via the backend cron UI, POST with
 * Authorization: Bearer <LOVABLE_CRON_SECRET> and ?env=sandbox (or live after go-live).
 */
export const Route = createFileRoute("/api/public/cron/auto-topup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const rawEnv = new URL(request.url).searchParams.get("env");
        const env = rawEnv === "live" ? "live" : "sandbox";

        const { createStripeClient, getStripeErrorMessage } = await import(
          "@/lib/stripe.server"
        );
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const billing = await import("@/lib/billing.server");

        const stripe = createStripeClient(env);

        const { data: profiles, error } = await supabaseAdmin
          .from("profiles")
          .select(
            "id, stripe_customer_id, default_payment_method_id, auto_topup_threshold, auto_topup_amount",
          )
          .eq("auto_topup_enabled", true)
          .eq("status", "active")
          .not("stripe_customer_id", "is", null)
          .not("default_payment_method_id", "is", null)
          .gte("auto_topup_amount", billing.TOPUP_MIN_USD);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const results: Array<Record<string, unknown>> = [];
        for (const profile of profiles ?? []) {
          try {
            const balance = await billing.getWalletBalance(supabaseAdmin, profile.id);
            const threshold = Number(profile.auto_topup_threshold ?? 0);
            if (balance >= threshold) continue;

            const amount = Number(profile.auto_topup_amount);
            const day = new Date().toISOString().slice(0, 10);
            const pi = await stripe.paymentIntents.create(
              {
                amount: Math.round(amount * 100),
                currency: "usd",
                customer: profile.stripe_customer_id!,
                payment_method: profile.default_payment_method_id!,
                off_session: true,
                confirm: true,
                description: "FlySales wallet auto top-up",
                metadata: {
                  kind: "wallet_auto_topup",
                  flysales_user_id: profile.id,
                  amount_usd: String(amount),
                },
              },
              { idempotencyKey: `flysales-auto-topup-${profile.id}-${day}` },
            );

            if (pi.status === "succeeded") {
              // Reference = payment intent id: the payment_intent.succeeded
              // webhook credits the same reference, so exactly one wins.
              const creditTxn = await billing.creditWalletOnce(supabaseAdmin, {
                clientId: profile.id,
                amountUsd: pi.amount_received / 100,
                reference: pi.id,
                description: "Wallet auto top-up (saved card)",
              });
              if (creditTxn) {
                // Payment Receipt for the auto top-up (best-effort).
                try {
                  const { issueWalletTopupReceipt } = await import(
                    "@/lib/documents.server"
                  );
                  await issueWalletTopupReceipt(supabaseAdmin, creditTxn.id);
                } catch (e) {
                  console.error("auto top-up receipt failed:", creditTxn.id, e);
                }
              }
              results.push({ client: profile.id, status: "credited" });
            } else {
              console.error(
                `auto top-up for ${profile.id}: unexpected PI status ${pi.status}`,
              );
              results.push({ client: profile.id, status: pi.status });
            }
          } catch (e) {
            const message = getStripeErrorMessage(e);
            console.error(`auto top-up failed for ${profile.id}: ${message}`);
            await billing.notifyClient(supabaseAdmin, {
              clientId: profile.id,
              kind: "auto_topup_failed",
              title: "Auto top-up failed",
              body: `We could not charge your saved card ($${Number(
                profile.auto_topup_amount,
              ).toFixed(2)}): ${message}. Top up manually or update your card from the Billing page.`,
            });
            results.push({ client: profile.id, status: "failed" });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
