import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * FlySales side of the two-engine middleware integration (Phase 1, inbound).
 *
 * Everything here works against configurable endpoints/secrets so the whole
 * path is testable before the middleware exists. Nothing in this module
 * touches money logic directly: order creation goes through the existing
 * ingest_order pricing/payment-gate RPC, tracking through the existing
 * tracking email path.
 */

// A secret that is unset — or still holding the placeholder value — counts as
// "not configured" so the receiver fails loudly instead of trusting junk.
const PLACEHOLDER = "REPLACE_ME";
function envOrNull(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw || raw === PLACEHOLDER) return null;
  return raw;
}

export function middlewareConfig(): {
  baseUrl: string | null;
  serviceToken: string | null;
  webhookSecret: string | null;
} {
  return {
    baseUrl: envOrNull("MIDDLEWARE_BASE_URL"),
    serviceToken: envOrNull("MIDDLEWARE_SERVICE_TOKEN"),
    webhookSecret: envOrNull("MIDDLEWARE_WEBHOOK_SECRET"),
  };
}

export const SIGNATURE_HEADER = "x-flysales-signature";
export const TIMESTAMP_HEADER = "x-flysales-timestamp";
const MAX_SKEW_SECONDS = 300;

/**
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, hex encoded. The middleware
 * sends it in x-flysales-signature (optionally prefixed "sha256=").
 */
export async function computeSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export async function verifyWebhookSignature(args: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { timestamp, rawBody } = args;
  const provided = (args.signature ?? "").replace(/^sha256=/i, "").trim().toLowerCase();
  if (!timestamp || !provided) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  const seconds = ts > 1e12 ? ts / 1000 : ts;
  if (Math.abs(Date.now() / 1000 - seconds) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale timestamp" };
  }

  const expected = await computeSignature(args.secret, timestamp, rawBody);
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/** Outbound audit row. Never throws — auditing must not break a call. */
export async function logIntegrationCall(
  admin: Admin,
  args: {
    direction?: "outbound" | "inbound";
    endpoint: string;
    tenantId?: string | null;
    idempotencyKey?: string | null;
    statusCode?: number | null;
    ok: boolean;
    error?: unknown;
  },
): Promise<void> {
  try {
    const message =
      args.error === undefined || args.error === null
        ? null
        : args.error instanceof Error
          ? `${args.error.name}: ${args.error.message}`
          : String(args.error);
    await admin.from("integration_calls").insert({
      direction: args.direction ?? "outbound",
      endpoint: args.endpoint.slice(0, 500),
      tenant_id: args.tenantId ?? null,
      idempotency_key: args.idempotencyKey ?? null,
      status_code: args.statusCode ?? null,
      ok: args.ok,
      error: message?.slice(0, 1000) ?? null,
    });
  } catch (e) {
    console.error("[middleware] failed to record integration call:", e);
  }
}

// ============= Event payloads (C2) =============

const tenantIdSchema = z.string().trim().regex(/^rs_[0-9a-f]{32}$/, "Invalid tenant_id");

const orderLineSchema = z.object({
  sku: z.string().trim().min(1).max(120),
  qty: z.number().int().min(1).max(100_000),
});

export const orderCreatedSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  event_type: z.literal("order.created").optional(),
  tenant_id: tenantIdSchema,
  order: z.object({
    middleware_order_id: z.string().trim().min(1).max(200),
    external_ref: z.string().trim().max(200).optional().nullable(),
    lines: z.array(orderLineSchema).min(1).max(200),
    destination_country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use a 2-letter country code"),
    customer: z
      .object({
        name: z.string().trim().max(200).optional(),
        city: z.string().trim().max(120).optional(),
        postal: z.string().trim().max(40).optional(),
      })
      .optional(),
  }),
});

export const orderUpdatedSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  tenant_id: tenantIdSchema,
  order: z.object({
    middleware_order_id: z.string().trim().min(1).max(200),
    status: z
      .enum(["processing", "shipped", "delivered", "cancelled", "needs_review"])
      .optional(),
    external_ref: z.string().trim().max(200).optional().nullable(),
    destination_country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  }),
});

export const trackingUpdatedSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  tenant_id: tenantIdSchema,
  order: z.object({
    middleware_order_id: z.string().trim().min(1).max(200),
    tracking_number: z.string().trim().min(3).max(120),
    tracking_carrier: z.string().trim().min(2).max(120),
  }),
});

export const inboundEnvelopeSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  event_type: z.string().trim().min(1).max(120),
  tenant_id: z.string().trim().max(120).optional().nullable(),
});

/** Raised for an unknown tenant: recorded on the event, still ACKed with 200. */
export class UnknownTenantError extends Error {
  constructor(tenantId: string) {
    super(`UNKNOWN_TENANT: no workspace matches tenant_id ${tenantId}`);
    this.name = "UnknownTenantError";
  }
}

async function resolveStoreId(admin: Admin, tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("stores")
    .select("id")
    .eq("middleware_tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UnknownTenantError(tenantId);
  return data.id;
}

// ============= Handlers =============

async function handleOrderCreated(admin: Admin, payload: unknown) {
  const parsed = orderCreatedSchema.parse(payload);
  const order = parsed.order;
  await resolveStoreId(admin, parsed.tenant_id); // explicit unknown-tenant error

  const customer = order.customer ?? {};
  const { data, error } = await admin.rpc("ingest_middleware_order", {
    p_tenant_id: parsed.tenant_id,
    p_middleware_order_id: order.middleware_order_id,
    p_external_ref: order.external_ref ?? order.middleware_order_id,
    p_destination_country: order.destination_country,
    p_shipping_address: {
      name: customer.name ?? null,
      city: customer.city ?? null,
      postal_code: customer.postal ?? null,
      country: order.destination_country,
    } as never,
    p_line_items: order.lines.map((l) => ({ sku: l.sku, quantity: l.qty })) as never,
  });
  if (error) throw new Error(error.message);
  const created = data as unknown as { id: string; status: string } | null;
  return { order_id: created?.id ?? null, status: created?.status ?? null };
}

async function handleOrderUpdated(admin: Admin, payload: unknown) {
  const parsed = orderUpdatedSchema.parse(payload);
  await resolveStoreId(admin, parsed.tenant_id);

  const { data: existing, error: readError } = await admin
    .from("orders")
    .select("id, status")
    .eq("middleware_order_id", parsed.order.middleware_order_id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new Error(`No shadow order for ${parsed.order.middleware_order_id}`);

  // Deliberately narrow: never touches payment_method, paid_at or totals.
  const update: Database["public"]["Tables"]["orders"]["Update"] = {};
  if (parsed.order.status) update["status"] = parsed.order.status;
  if (parsed.order.status === "shipped") update["shipped_at"] = new Date().toISOString();
  if (parsed.order.status === "delivered") update["delivered_at"] = new Date().toISOString();
  if (parsed.order.status === "cancelled") update["cancelled_at"] = new Date().toISOString();
  if (parsed.order.external_ref) update["external_order_number"] = parsed.order.external_ref;
  if (parsed.order.destination_country) {
    update["destination_country"] = parsed.order.destination_country;
  }
  if (Object.keys(update).length === 0) return { order_id: existing.id, changed: false };

  // Never downgrade an unpaid order out of its payment gate.
  if (existing.status === "awaiting_payment" && parsed.order.status) {
    delete update["status"];
  }
  const { error } = await admin.from("orders").update(update).eq("id", existing.id);
  if (error) throw new Error(error.message);
  return { order_id: existing.id, changed: true };
}

async function handleTrackingUpdated(admin: Admin, payload: unknown) {
  const parsed = trackingUpdatedSchema.parse(payload);
  await resolveStoreId(admin, parsed.tenant_id);

  const { data: order, error: readError } = await admin
    .from("orders")
    .select(
      "id, external_order_number, status, tracking_number, tracking_notified_at, stores(entities(account_id))",
    )
    .eq("middleware_order_id", parsed.order.middleware_order_id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!order) throw new Error(`No shadow order for ${parsed.order.middleware_order_id}`);

  const firstTracking = !order.tracking_number;
  const update: Database["public"]["Tables"]["orders"]["Update"] = {
    tracking_number: parsed.order.tracking_number,
    tracking_carrier: parsed.order.tracking_carrier,
  };
  if (order.status === "paid" || order.status === "processing") update["status"] = "shipped";
  const { error } = await admin.from("orders").update(update).eq("id", order.id);
  if (error) throw new Error(error.message);

  // Same atomic claim as the admin path: at most one tracking email ever.
  if (firstTracking && !order.tracking_notified_at) {
    const accountId = (
      order.stores as { entities?: { account_id?: string | null } | null } | null
    )?.entities?.account_id;
    if (accountId) {
      const { data: claimed } = await admin
        .from("orders")
        .update({ tracking_notified_at: new Date().toISOString() })
        .eq("id", order.id)
        .is("tracking_notified_at", null)
        .select("id");
      if (claimed && claimed.length > 0) {
        const { sendClientEmail } = await import("./email.server");
        await sendClientEmail(admin, {
          clientId: accountId,
          subject: `Your order ${order.external_order_number ?? ""} has shipped`,
          text: `Order ${order.external_order_number ?? order.id} is on its way.\nCarrier: ${parsed.order.tracking_carrier}\nTracking: ${parsed.order.tracking_number}`,
        });
      }
    }
  }
  return { order_id: order.id, emailed: firstTracking };
}

/**
 * Dispatches a stored event. Throws on failure — the caller records the
 * message on integration_events and in error_logs.
 */
export async function processIntegrationEvent(
  admin: Admin,
  eventType: string,
  payload: unknown,
): Promise<unknown> {
  switch (eventType) {
    case "order.created":
      return handleOrderCreated(admin, payload);
    case "order.updated":
      return handleOrderUpdated(admin, payload);
    case "tracking.updated":
      return handleTrackingUpdated(admin, payload);
    default:
      return { ignored: eventType };
  }
}

/**
 * Runs a stored event and stamps the outcome. Used by the webhook receiver and
 * by the admin "replay" action.
 */
export async function runStoredEvent(
  admin: Admin,
  event: { event_id: string; event_type: string; tenant_id: string | null; payload: unknown },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await processIntegrationEvent(admin, event.event_type, event.payload);
    await admin
      .from("integration_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("event_id", event.event_id);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from("integration_events")
      .update({ error: message.slice(0, 1000) })
      .eq("event_id", event.event_id);
    const { logAppError } = await import("./ops.server");
    await logAppError(admin, {
      job: `middleware:${event.event_type}`,
      context: { event_id: event.event_id, tenant_id: event.tenant_id },
      error: e,
    });
    return { ok: false, error: message };
  }
}
