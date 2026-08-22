import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";

/**
 * Stripe webhook — single entry point for subscriptions AND wallet top-ups.
 *
 * Strict order on every request:
 *   1. Verify the Stripe signature (400 if invalid)
 *   2. Insert into stripe_events — a duplicate stripe_event_id returns 200
 *      immediately (idempotency gate)
 *   3. Process the event
 *   4. Set processed_at, or store the failure message in error
 *
 * Unhandled event types return 200 so Stripe stops retrying.
 * No auth middleware: security is the Stripe signature. The handler writes
 * with the service role (auth.role() = 'service_role'), which
 * apply_wallet_transaction accepts.
 */
export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error(
            "Webhook received with invalid or missing env query parameter:",
            rawEnv,
          );
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env = rawEnv;

        try {
          // 1. Signature verification (also reads the raw body).
          const { verifyWebhook } = await import("@/lib/stripe.server");
          const event = await verifyWebhook(request, env);

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          // 2. Idempotency gate — first writer wins.
          const { error: insertError } = await supabaseAdmin
            .from("stripe_events")
            .insert({
              stripe_event_id: event.id,
              event_type: event.type,
              environment: env,
              payload: event.data.object as unknown as Database["public"]["Tables"]["stripe_events"]["Insert"]["payload"],
            });
          if (insertError) {
            if (insertError.code === "23505") {
              return Response.json({ received: true, duplicate: true });
            }
            throw new Error(insertError.message);
          }

          // 3+4. Process, then record the outcome.
          try {
            const { processStripeEvent } = await import("@/lib/billing.server");
            await processStripeEvent(event, env);
            await supabaseAdmin
              .from("stripe_events")
              .update({ processed_at: new Date().toISOString() })
              .eq("stripe_event_id", event.id);
          } catch (processingError) {
            const message =
              processingError instanceof Error
                ? processingError.message
                : String(processingError);
            await supabaseAdmin
              .from("stripe_events")
              .update({ error: message.slice(0, 1000) })
              .eq("stripe_event_id", event.id);
            console.error("Webhook processing error:", event.type, message);
            // 500 → Stripe retries once; the retry hits the idempotency gate
            // (row already exists) and stops. The error stays visible to admins.
            return new Response("Webhook handler error", { status: 500 });
          }

          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
