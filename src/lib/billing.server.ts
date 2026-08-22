import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAdminClient, round2 } from "./admin.server";
import { createStripeClient, type StripeEnv } from "./stripe.server";

type Admin = SupabaseClient<Database>;

/** Human-readable price ids (lookup keys) created via the payments tools. */
export const PLAN_PRICE_IDS = {
  basic: "flysales_basic",
  unlimited: "flysales_unlimited",
} as const;
export type BillingPlan = keyof typeof PLAN_PRICE_IDS;

export const TOPUP_MIN_USD = 50;
export const TOPUP_SUGGESTIONS_USD = [100, 250, 500, 1000];

export function planFromLookupKey(key: string | null | undefined): BillingPlan | null {
  if (key === PLAN_PRICE_IDS.unlimited) return "unlimited";
  if (key === PLAN_PRICE_IDS.basic) return "basic";
  return null;
}

export function mapSubscriptionStatus(
  stripeStatus: string | null | undefined,
): "none" | "active" | "past_due" | "canceled" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

/**
 * Look up an existing Stripe Customer by userId metadata (then by email), or
 * create one. userId on the Customer object is what makes later reads
 * (webhooks, portal, dashboards) resolvable.
 */
export async function resolveOrCreateCustomer(
  stripe: Stripe,
  options: { email?: string; userId: string; existingCustomerId?: string | null },
): Promise<string> {
  if (options.existingCustomerId) return options.existingCustomerId;
  if (!/^[a-zA-Z0-9_-]+$/.test(options.userId)) throw new Error("Invalid userId");

  const found = await stripe.customers.search({
    query: `metadata['userId']:'${options.userId}'`,
    limit: 1,
  });
  const hit = found.data[0];
  if (hit) return hit.id;

  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    const customer = existing.data[0];
    if (customer) {
      if (customer.metadata?.["userId"] !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }

  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    metadata: { userId: options.userId },
  });
  return created.id;
}

function isDuplicateReference(message: string): boolean {
  return message.includes("already exists");
}

/**
 * Credit the wallet exactly once per Stripe reference. Replays (webhook
 * retries, checkout.session.completed + payment_intent.succeeded both
 * firing) hit the reference uniqueness rule and become no-ops.
 */
export async function creditWalletOnce(
  admin: Admin,
  args: { clientId: string; amountUsd: number; reference: string; description: string },
): Promise<void> {
  const { error } = await admin.rpc("apply_wallet_transaction", {
    p_client_id: args.clientId,
    p_type: "credit",
    p_amount: round2(args.amountUsd),
    p_description: args.description,
    p_reference: args.reference,
  });
  if (error && !isDuplicateReference(error.message)) throw new Error(error.message);
}

/** Debit the wallet exactly once per Stripe reference (refunds). */
export async function debitWalletOnce(
  admin: Admin,
  args: { clientId: string; amountUsd: number; reference: string; description: string },
): Promise<void> {
  const { error } = await admin.rpc("apply_wallet_transaction", {
    p_client_id: args.clientId,
    p_type: "debit",
    p_amount: round2(args.amountUsd),
    p_description: args.description,
    p_reference: args.reference,
  });
  if (error && !isDuplicateReference(error.message)) throw new Error(error.message);
}

/** In-app notification for a client (the billing page surfaces unread ones). */
export async function notifyClient(
  admin: Admin,
  args: { clientId: string; kind: string; title: string; body: string },
): Promise<void> {
  await admin.from("notifications").insert({
    client_id: args.clientId,
    kind: args.kind,
    title: args.title,
    body: args.body,
  });
}

/** Current wallet balance = balance_after of the latest ledger row. */
export async function getWalletBalance(admin: Admin, clientId: string): Promise<number> {
  const { data } = await admin
    .from("wallet_transactions")
    .select("balance_after")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number(data.balance_after) : 0;
}

export async function findProfileByStripeCustomer(admin: Admin, customerId: string) {
  const { data } = await admin
    .from("profiles")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data;
}

export async function findProfileById(admin: Admin, id: string) {
  const { data } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  return data;
}

/**
 * Sync profile billing state from a Stripe Subscription object
 * (customer.subscription.created / .updated). The webhook is the ONLY writer
 * of these fields — never the redirect.
 */
export async function syncSubscriptionFromStripe(
  admin: Admin,
  sub: Record<string, unknown>,
): Promise<void> {
  const subAny = sub as {
    id: string;
    status?: string;
    customer?: string | { id: string };
    metadata?: Record<string, string>;
    items?: {
      data?: Array<{
        price?: { lookup_key?: string | null; metadata?: Record<string, string> };
      }>;
    };
  };
  const customerId =
    typeof subAny.customer === "string" ? subAny.customer : subAny.customer?.id;
  const clientId = subAny.metadata?.["flysales_user_id"] ?? subAny.metadata?.["userId"] ?? null;

  let profile = customerId ? await findProfileByStripeCustomer(admin, customerId) : null;
  if (!profile && clientId) profile = await findProfileById(admin, clientId);
  if (!profile) {
    console.error("subscription event for unknown customer", customerId);
    return;
  }

  const item = subAny.items?.data?.[0];
  const plan = planFromLookupKey(
    item?.price?.lookup_key ?? item?.price?.metadata?.["lovable_external_id"] ?? null,
  );
  const status = mapSubscriptionStatus(subAny.status ?? null);

  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
    stripe_customer_id: customerId ?? profile.stripe_customer_id,
    stripe_subscription_id: subAny.id,
    subscription_status: status,
  };
  // The plan follows the subscribed price only while in good standing;
  // past_due keeps the current plan during Stripe's retry window.
  if (plan && status === "active") patch.subscription_plan = plan;

  const { error } = await admin.from("profiles").update(patch).eq("id", profile.id);
  if (error) throw new Error(error.message);
}

// ============= Webhook event processing =============

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function meta(obj: Record<string, unknown>): Record<string, string> {
  const m = obj["metadata"];
  return (m ?? {}) as Record<string, string>;
}

function idOf(ref: unknown): string | null {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && "id" in ref) {
    return String((ref as { id: unknown }).id);
  }
  return null;
}

/**
 * Credit a wallet top-up exactly once per PaymentIntent. Called from BOTH
 * checkout.session.completed (payment mode) and payment_intent.succeeded —
 * the reference uniqueness rule makes the second call a no-op. Also stores
 * the saved card (setup_future_usage) for auto top-up.
 */
export async function handleWalletTopup(
  stripe: Stripe,
  admin: Admin,
  paymentIntentId: string,
): Promise<void> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== "succeeded") return;
  const clientId = pi.metadata?.["flysales_user_id"];
  if (!clientId) {
    throw new Error(`payment intent ${paymentIntentId} missing flysales_user_id`);
  }
  const kind = pi.metadata?.["kind"];
  await creditWalletOnce(admin, {
    clientId,
    amountUsd: pi.amount_received / 100,
    reference: pi.id,
    description:
      kind === "wallet_auto_topup"
        ? "Wallet auto top-up (saved card)"
        : "Wallet top-up via card",
  });
  const pm = idOf(pi.payment_method);
  if (pm) {
    await admin
      .from("profiles")
      .update({ default_payment_method_id: pm })
      .eq("id", clientId);
  }
}

/** The single entry point called by the webhook route after idempotency. */
export async function processStripeEvent(
  event: StripeEvent,
  env: StripeEnv,
): Promise<void> {
  const stripe = createStripeClient(env);
  const admin = await getAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // Delayed-notification payment methods (SEPA, Bacs, …) fire this when the
      // payment is submitted, not settled — the async events handle those.
      if (session["payment_status"] === "unpaid") return;

      const kind = meta(session)["kind"];
      if (kind === "flysales_subscription") {
        const clientId = meta(session)["flysales_user_id"];
        if (!clientId) throw new Error("subscription session missing flysales_user_id");
        const plan = meta(session)["plan"] === "unlimited" ? "unlimited" : "basic";
        const customerId = idOf(session["customer"]);
        const subscriptionId = idOf(session["subscription"]);
        const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
          subscription_status: "active",
          subscription_plan: plan,
        };
        if (customerId) patch.stripe_customer_id = customerId;
        if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
        const { error } = await admin.from("profiles").update(patch).eq("id", clientId);
        if (error) throw new Error(error.message);
        // Backfill userId on the Customer so search-based reads resolve.
        if (customerId) {
          try {
            await stripe.customers.update(customerId, {
              metadata: { userId: clientId, flysales_user_id: clientId },
            });
          } catch (e) {
            console.error("customer metadata backfill failed", e);
          }
        }
      } else if (kind === "wallet_topup") {
        const piId = idOf(session["payment_intent"]);
        if (piId) await handleWalletTopup(stripe, admin, piId);
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncSubscriptionFromStripe(admin, event.data.object);
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId = idOf(sub["customer"]);
      const profile = customerId
        ? await findProfileByStripeCustomer(admin, customerId)
        : null;
      if (!profile) {
        console.error("subscription.deleted for unknown customer", customerId);
        return;
      }
      // Access ends with the subscription — fall back to the Basic tier.
      const { error } = await admin
        .from("profiles")
        .update({ subscription_status: "canceled", subscription_plan: "basic" })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = idOf(invoice["customer"]);
      const profile = customerId
        ? await findProfileByStripeCustomer(admin, customerId)
        : null;
      if (!profile) {
        console.error("invoice.payment_failed for unknown customer", customerId);
        return;
      }
      const { error } = await admin
        .from("profiles")
        .update({ subscription_status: "past_due" })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
      await notifyClient(admin, {
        clientId: profile.id,
        kind: "subscription_payment_failed",
        title: "Subscription payment failed",
        body: "We could not charge your card for your FlySales subscription. Stripe will retry automatically — update your payment method from the Billing page to keep your plan.",
      });
      return;
    }

    case "payment_intent.succeeded": {
      const kind = meta(event.data.object)["kind"];
      if (kind === "wallet_topup" || kind === "wallet_auto_topup") {
        const piId = String(event.data.object["id"] ?? "");
        if (piId) await handleWalletTopup(stripe, admin, piId);
      }
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const piId = idOf(charge["payment_intent"]);
      const refundedUsd = (Number(charge["amount_refunded"]) || 0) / 100;
      if (!piId || refundedUsd <= 0) return;
      // The original credit's reference is the payment intent id — it tells
      // us which client this refund debits.
      const { data: original } = await admin
        .from("wallet_transactions")
        .select("client_id, amount")
        .eq("reference", piId)
        .maybeSingle();
      if (!original) {
        console.error("refund for unknown payment intent", piId);
        return;
      }
      await debitWalletOnce(admin, {
        clientId: original.client_id,
        amountUsd: Math.min(refundedUsd, Number(original.amount)),
        reference: `refund:${String(charge["id"])}`,
        description: "Card payment refunded",
      });
      return;
    }

    default:
      // Unhandled types: acknowledged (200) so Stripe stops retrying.
      console.log("Unhandled Stripe event:", event.type);
  }
}
