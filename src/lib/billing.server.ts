import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAdminClient, round2 } from "./admin.server";
import { createStripeClient, type StripeEnv } from "./stripe.server";
import { sendClientEmail } from "./email.server";
import { PLANS, planLabel } from "./plans";

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

/** Wallet lives at entity level: resolve a client's (first) entity id. */
async function resolveEntityId(admin: Admin, clientId: string): Promise<string> {
  const { data, error } = await admin
    .from("entities")
    .select("id")
    .eq("account_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No entity found for client ${clientId}`);
  return data.id;
}

/**
 * Credit the wallet exactly once per Stripe reference. Replays (webhook
 * retries, checkout.session.completed + payment_intent.succeeded both
 * firing) hit the reference uniqueness rule and become no-ops.
 * Returns true when the credit was actually written, false on a replay —
 * callers use this to never release orders or email twice.
 */
export async function creditWalletOnce(
  admin: Admin,
  args: { clientId: string; amountUsd: number; reference: string; description: string },
): Promise<Database["public"]["Tables"]["wallet_transactions"]["Row"] | null> {
  const { data, error } = await admin.rpc("apply_wallet_transaction", {
    p_entity_id: await resolveEntityId(admin, args.clientId),
    p_type: "credit",
    p_amount: round2(args.amountUsd),
    p_description: args.description,
    p_reference: args.reference,
  });
  if (error) {
    if (isDuplicateReference(error.message)) return null;
    throw new Error(error.message);
  }
  return data;
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
    cancel_at_period_end?: boolean;
    current_period_end?: number;
    metadata?: Record<string, string>;
    items?: {
      data?: Array<{
        current_period_end?: number;
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
  const periodEndUnix = item?.current_period_end ?? subAny.current_period_end ?? null;
  const periodEndDate = periodEndUnix
    ? new Date(periodEndUnix * 1000).toISOString().slice(0, 10)
    : null;

  const patch: Database["public"]["Tables"]["profiles"]["Update"] = {
    stripe_customer_id: customerId ?? profile.stripe_customer_id,
    stripe_subscription_id: subAny.id,
    subscription_status: status,
  };

  // The plan follows the subscribed price only while in good standing;
  // past_due keeps the current plan during Stripe's retry window.
  if (plan && status === "active") {
    patch.subscription_plan = plan;

    if (profile.pending_plan_change) {
      if (profile.pending_plan_change === plan) {
        // The scheduled change just took effect.
        patch.pending_plan_change = null;
        patch.pending_plan_change_date = null;
        if (plan === "basic") {
          // Quota on the day a downgrade lands: the monthly counter resets
          // for the new period so usage accrued on Unlimited (e.g. 40
          // quotes) does not instantly block the client on day one of Basic.
          patch.quotes_used_this_month = 0;
          patch.quotes_period_start = new Date().toISOString().slice(0, 8) + "01";
        }
      } else {
        // The schedule was released or replaced outside this flow — the
        // live price wins and the pending marker is stale.
        patch.pending_plan_change = null;
        patch.pending_plan_change_date = null;
      }
    }
  }

  // Cancellation notice — emailed once per cancellation; the flag clears if
  // the client reactivates before the period ends.
  let sendCancellationNotice = false;
  if (status === "active" && subAny.cancel_at_period_end && !profile.cancel_notice_sent_at) {
    patch.cancel_notice_sent_at = new Date().toISOString();
    sendCancellationNotice = true;
  } else if (!subAny.cancel_at_period_end && profile.cancel_notice_sent_at) {
    patch.cancel_notice_sent_at = null;
  }

  const { error } = await admin.from("profiles").update(patch).eq("id", profile.id);
  if (error) throw new Error(error.message);

  if (sendCancellationNotice) {
    // Cancellation restricts new work; it never breaks work in flight.
    await sendClientEmail(admin, {
      clientId: profile.id,
      subject: "Your FlySales subscription cancellation",
      text: [
        "Your subscription cancellation is confirmed.",
        periodEndDate
          ? `Your plan stays active until ${periodEndDate}.`
          : "Your plan stays active until the end of the current billing period.",
        "Your product catalogue and any open orders are unaffected, and your wallet balance remains yours.",
      ].join("\n"),
    });
  }
}

// ============= Webhook event processing =============
//
// NOTE: syncSubscriptionFromStripe lives above; everything below runs inside
// the webhook route's idempotency gate (stripe_events), so replaying the
// same stripe_event_id never credits, releases or emails twice.

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
 * the saved card (setup_future_usage) for auto top-up, releases orders
 * waiting on funds (oldest first), and sends the confirmation email. All of
 * it is gated on the credit actually landing, so a replayed payment never
 * releases or emails twice.
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
  const creditTxn = await creditWalletOnce(admin, {
    clientId,
    amountUsd: pi.amount_received / 100,
    reference: pi.id,
    // Human-readable description — the Stripe id lives in reference only.
    description: kind === "wallet_auto_topup" ? "Wallet auto top-up" : "Wallet top-up",
  });

  // Keep the card on file so auto top-up has a payment method later.
  const pm = idOf(pi.payment_method);
  if (pm) {
    await admin
      .from("profiles")
      .update({ default_payment_method_id: pm })
      .eq("id", clientId);
  }

  if (!creditTxn) return; // replay of an already-processed payment

  // Payment Receipt for the top-up. Best-effort: the credit is the source of
  // truth and must never be blocked by document generation.
  try {
    const { issueWalletTopupReceipt } = await import("./documents.server");
    await issueWalletTopupReceipt(admin, creditTxn.id);
  } catch (e) {
    console.error("wallet top-up receipt failed:", creditTxn.id, e);
  }

  // Settle orders waiting on funds, oldest first, debiting through
  // apply_wallet_transaction with the order id as the reference.
  const { data: releasedRows, error: releaseError } = await admin.rpc(
    "release_awaiting_payment_orders",
    { p_client_id: clientId },
  );
  if (releaseError) {
    console.error("release_awaiting_payment_orders failed:", releaseError.message);
  }
  const released = (releasedRows ?? []) as Array<{ order_id: string; amount: number }>;

  // Payment Receipt for each order this top-up just paid (wallet debit).
  const { issueOrderReceipt } = await import("./documents.server");
  for (const o of released) {
    try {
      await issueOrderReceipt(admin, o.order_id);
    } catch (e) {
      console.error("order receipt failed:", o.order_id, e);
    }
  }

  const balance = await getWalletBalance(admin, clientId);
  const lines = [
    `Amount credited: $${(pi.amount_received / 100).toFixed(2)}`,
    `New balance: $${balance.toFixed(2)}`,
  ];
  if (released.length > 0) {
    lines.push("", "Orders released by this top-up:");
    for (const o of released) {
      lines.push(`- Order ${o.order_id} — $${Number(o.amount).toFixed(2)}`);
    }
  }
  await sendClientEmail(admin, {
    clientId,
    subject: "Your FlySales wallet was topped up",
    text: lines.join("\n"),
  });
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
        // Confirmation email: plan, price, next billing date. The new plan's
        // quota applies immediately — the monthly counter is NOT reset.
        let nextBilling: string | null = null;
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const firstItem = sub.items?.data?.[0] as
              | { current_period_end?: number }
              | undefined;
            const periodEnd =
              firstItem?.current_period_end ??
              (sub as unknown as { current_period_end?: number }).current_period_end;
            nextBilling = periodEnd
              ? new Date(periodEnd * 1000).toISOString().slice(0, 10)
              : null;
          } catch (e) {
            console.error("subscription retrieve for confirmation email failed", e);
          }
        }
        await sendClientEmail(admin, {
          clientId,
          subject: `Your FlySales ${planLabel(plan)} subscription is active`,
          text: [
            `Plan: ${planLabel(plan)} — $${PLANS[plan].priceUsd}/month`,
            nextBilling ? `Next billing date: ${nextBilling}` : null,
            "Your new plan's quota applies immediately.",
          ]
            .filter(Boolean)
            .join("\n"),
        });
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
      // The wallet balance is the client's money: never zeroed or expired.
      // The catalogue and in-flight orders stay untouched.
      const { error } = await admin
        .from("profiles")
        .update({
          subscription_status: "canceled",
          subscription_plan: "basic",
          pending_plan_change: null,
          pending_plan_change_date: null,
          cancel_notice_sent_at: null,
        })
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
      const wasAlreadyPastDue = profile.subscription_status === "past_due";
      const { error } = await admin
        .from("profiles")
        .update({ subscription_status: "past_due" })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
      // Notify once, on the transition into past_due — Stripe retries for
      // days and the client must not get an email per retry. Nothing is
      // blocked at this stage; restrictions only apply if Stripe ultimately
      // cancels the subscription.
      if (!wasAlreadyPastDue) {
        await notifyClient(admin, {
          clientId: profile.id,
          kind: "subscription_payment_failed",
          title: "Subscription payment failed",
          body: "We could not charge your card for your FlySales subscription. Stripe will retry automatically — update your payment method from the Billing page to keep your plan.",
        });
        await sendClientEmail(admin, {
          clientId: profile.id,
          subject: "We could not charge your card",
          text: "Your last FlySales subscription payment failed. Stripe will retry automatically over the next few days — please update your payment method from the Billing page to keep your plan.",
        });
      }
      return;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      // Only subscription invoices produce a Payment Receipt — one-off
      // invoices (none today) are ignored. Keyed on the invoice id, unique
      // per billing period, so a replayed event issues nothing twice.
      if (!idOf(invoice["subscription"])) return;
      try {
        const { issueSubscriptionReceipt } = await import("./documents.server");
        await issueSubscriptionReceipt(admin, invoice);
      } catch (e) {
        console.error("subscription receipt failed:", e);
      }
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
