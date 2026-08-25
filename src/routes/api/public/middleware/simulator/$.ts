import { createFileRoute } from "@tanstack/react-router";

/**
 * TEST TOOLING — the middleware simulator's inbound door (Phase 3).
 *
 * Impersonates the real middleware's admin API so releases/rejects land
 * somewhere while the real engine does not exist yet. It is NOT admin-gated
 * (it is the middleware target), so it authenticates with a dedicated
 * MIDDLEWARE_SIMULATOR_TOKEN and refuses the moment a real MIDDLEWARE_BASE_URL
 * is configured. Every accepted call is recorded in simulator_calls and
 * respects Idempotency-Key: a repeat returns the first response, flagged
 * replayed.
 */
export const Route = createFileRoute("/api/public/middleware/simulator/$")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const token = process.env["MIDDLEWARE_SIMULATOR_TOKEN"]?.trim();
        const realBase = process.env["MIDDLEWARE_BASE_URL"]?.trim();
        if (realBase && realBase !== "REPLACE_ME" && !realBase.includes("/middleware/simulator")) {
          return new Response("Simulator disabled: real middleware configured", { status: 403 });
        }
        if (!token) {
          return new Response("Simulator not configured", { status: 503 });
        }

        const provided = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
        if (!provided || !timingSafeEqual(digest(provided), digest(token))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const path = `/${params._splat ?? ""}`;
        const action = path.endsWith("/reject")
          ? "reject"
          : path.endsWith("/approve")
            ? "approve"
            : "unknown";
        const idempotencyKey =
          request.headers.get("idempotency-key")?.slice(0, 200) ?? `sim-${crypto.randomUUID()}`;

        let payload: unknown = null;
        try {
          const raw = await request.text();
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: existing } = await supabaseAdmin
          .from("simulator_calls")
          .select("id, response, replay_count")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existing) {
          await supabaseAdmin
            .from("simulator_calls")
            .update({
              replay_count: (existing.replay_count ?? 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          return Response.json({
            ...((existing.response as Record<string, unknown> | null) ?? {}),
            replayed: true,
          });
        }

        const response = {
          accepted: true,
          simulator: true,
          action,
          idempotency_key: idempotencyKey,
          received_at: new Date().toISOString(),
        };

        await supabaseAdmin.from("simulator_calls").insert({
          endpoint: path.slice(0, 500),
          action,
          idempotency_key: idempotencyKey,
          payload: payload as never,
          response: response as never,
        });

        return Response.json(response);
      },
    },
  },
});
