import { createFileRoute } from "@tanstack/react-router";

/**
 * Inbound middleware webhook (contract C2).
 *
 * Public URL, but locked: HMAC-SHA256 over `${timestamp}.${rawBody}` with
 * MIDDLEWARE_WEBHOOK_SECRET, max 5 minutes of skew. Unset secret => 503.
 * Every event is stored in integration_events first (deduped by event_id),
 * then processed; handler failures land on the event row and in error_logs.
 */
export const Route = createFileRoute("/api/public/middleware/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          middlewareConfig,
          verifyWebhookSignature,
          inboundEnvelopeSchema,
          runStoredEvent,
          logIntegrationCall,
          SIGNATURE_HEADER,
          TIMESTAMP_HEADER,
        } = await import("@/lib/middleware.server");

        const { webhookSecret } = middlewareConfig();
        if (!webhookSecret) {
          console.error(
            "[middleware:webhook] MIDDLEWARE_WEBHOOK_SECRET is not configured — rejecting all events",
          );
          return new Response("Integration not configured", { status: 503 });
        }

        const rawBody = await request.text();
        const verified = await verifyWebhookSignature({
          secret: webhookSecret,
          timestamp: request.headers.get(TIMESTAMP_HEADER),
          signature: request.headers.get(SIGNATURE_HEADER),
          rawBody,
        });
        if (!verified.ok) {
          console.warn("[middleware:webhook] rejected:", verified.reason);
          return new Response("Invalid signature", { status: 401 });
        }

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const envelope = inboundEnvelopeSchema.safeParse(parsedBody);
        if (!envelope.success) {
          return new Response("Invalid event envelope", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { event_id, event_type } = envelope.data;
        const tenantId = envelope.data.tenant_id ?? null;
        // Test tooling: events emitted by the simulator are tagged so ops
        // views and the daily digest can ignore them.
        const simulator = envelope.data.simulator === true;

        // Idempotency: a replay is acknowledged without reprocessing.
        const { data: existing } = await supabaseAdmin
          .from("integration_events")
          .select("event_id")
          .eq("event_id", event_id)
          .maybeSingle();
        if (existing) {
          return Response.json({ received: true, duplicate: true });
        }

        const { error: insertError } = await supabaseAdmin.from("integration_events").insert({
          event_id,
          event_type,
          tenant_id: tenantId,
          payload: parsedBody as never,
          signature_valid: true,
          simulator,
        });
        if (insertError) {
          // Unique violation => concurrent delivery of the same event.
          if (insertError.code === "23505") {
            return Response.json({ received: true, duplicate: true });
          }
          console.error("[middleware:webhook] could not store event:", insertError.message);
          return new Response("Could not store event", { status: 500 });
        }

        const outcome = await runStoredEvent(supabaseAdmin, {
          event_id,
          event_type,
          tenant_id: tenantId,
          payload: parsedBody,
        });
        await logIntegrationCall(supabaseAdmin, {
          direction: "inbound",
          endpoint: `webhook:${event_type}`,
          tenantId,
          idempotencyKey: event_id,
          statusCode: 200,
          ok: outcome.ok,
          error: outcome.error,
          simulator,
        });

        // Always 200 once stored: retries would only replay a stored event.
        return Response.json({ received: true, processed: outcome.ok });
      },
    },
  },
});
