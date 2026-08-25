import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAdminClient, round2 } from "./admin.server";
import { createStripeClient, type StripeEnv } from "./stripe.server";
import { sendClientEmail } from "./email.server";
import { PLANS, planLabel } from "./plans";

type Admin = SupabaseClient<Database>;
type EntityRow = Database["public"]["Tables"]["entities"]["Row"];
type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

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
  // Trust the stored id only if the customer still exists in THIS Stripe
  // environment — a sandbox reset or env switch leaves stale ids that Stripe
  // rejects with "No such customer" at session creation.
  if (options.existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(options.existingCustomerId);
      if (!("deleted" in existing && existing.deleted)) return existing.id;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "resource_missing") throw e;
    }
  }
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

// ============= Entity / store lookups =============

/** First entity owned by an account (used when a store-scoped id isn't available). */
export async function resolveEntityIdForAccount(admin: Admin, accountId: string): Promise<string> {
  const { data, error } = await admin
    .from("entities")
    .select("id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No entity found for account ${accountId}`);
  return data.id;
}

export async function findEntityByStripeCustomer(
  admin: Admin,
  customerId: string,
): Promise<EntityRow | null> {
  const { data } = await admin
    .from("entities")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data;
}

export async function findEntityById(admin: Admin, id: string): Promise<EntityRow | null> {
  const { data } = await admin.from("entities").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function findStoreByStripeSubscription(
  admin: Admin,
  subscriptionId: string,
): Promise<StoreRow | null> {
  const { data } = await admin
    .from("stores")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  return data;
}

export async function findStoreById(admin: Admin, id: string): Promise<StoreRow | null> {
  const { data } = await admin.from("stores").select("*").eq("id", id).maybeSingle();
  return data;
}

/** The account (profile id) that owns an entity — needed for transactional emails. */
async function accountIdForEntity(admin: Admin, entityId: string): Promise<string | null> {
  const { data } = await admin
    .from("entities")
    .select("account_id")
    .eq("id", entityId)
    .maybeSingle();
  return data?.account_id ?? null;
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
  args: { entityId: string; amountUsd: number; reference: string; description: string },
): Promise<Database["public"]["Tables"]["wallet_transactions"]["Row"] | null> {
  const { data, error } = await admin.rpc("apply_wallet_transaction", {
    p_entity_id: args.entityId,
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
  args: { entityId: string; amountUsd: number; reference: string; description: string },
): Promise<void> {
  const { error } = await admin.rpc("apply_wallet_transaction", {
    p_entity_id: args.entityId,
    p_type: "debit",
    p_amount: round2(args.amountUsd),
    p_description: args.description,
    p_reference: args.reference,
  });
  if (error && !isDuplicateReference(error.message)) throw new Error(error.message);
}

/**
 * In-app notification. Scoping rule: wallet/balance/payment notifications
 * carry entity_id only; subscription/quota/order notifications carry
 * store_id (and may also set entity_id when known).
 */
export async function notify(
  admin: Admin,
  args: { entityId?: string | null; storeId?: string | null; kind: string; title: string; body: string },
): Promise<void> {
  await admin.from("notifications").insert({
    entity_id: args.entityId ?? null,
    store_id: args.storeId ?? null,
    kind: args.kind,
    title: args.title,
    body: args.body,
  });
}

/** Current wallet balance = balance_after of the latest ledger row. */
export async function getWalletBalance(admin: Admin, entityId: string): Promise<number> {
  const { data } = await admin
    .from("wallet_transactions")
    .select("balance_after")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number(data.balance_after) : 0;
}

/**
 * Sync a store's subscription state from a Stripe Subscription object
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
  const storeId = subAny.metadata?.["flysales_store_id"] ?? null;

  let store = await findStoreByStripeSubscription(admin, subAny.id);
  if (!store && storeId) store = await findStoreById(admin, storeId);
  if (!store) {
    console.error("subscription event for unknown store", customerId, storeId);
    return;
  }

  // Make sure the entity's Stripe customer id is on file.
  if (customerId) {
    const entity = await findEntityById(admin, store.entity_id);
    if (entity && entity.stripe_customer_id !== customerId) {
      await admin.from("entities").update({ stripe_customer_id: customerId }).eq("id", entity.id);
    }
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

  const patch: Database["public"]["Tables"]["stores"]["Update"] = {
    stripe_subscription_id: subAny.id,
    subscription_status: status,
  };

  // The plan follows the subscribed price only while in good standing;
  // past_due keeps the current plan during Stripe's retry window.
  if (plan && status === "active") {
    patch.subscription_plan = plan;

    if (store.pending_plan_change) {
      if (store.pending_plan_change === plan) {
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
  // the client reactivates before the period ends. Tracked on the entity.
  const entity = await findEntityById(admin, store.entity_id);
  let sendCancellationNotice = false;
  if (entity && status === "active" && subAny.cancel_at_period_end && !entity.cancel_notice_sent_at) {
    await admin
      .from("entities")
      .update({ cancel_notice_sent_at: new Date().toISOString() })
      .eq("id", entity.id);
    sendCancellationNotice = true;
  } else if (entity && !subAny.cancel_at_period_end && entity.cancel_notice_sent_at) {
    await admin.from("entities").update({ cancel_notice_sent_at: null }).eq("id", entity.id);
  }

  const { error } = await admin.from("stores").update(patch).eq("id", store.id);
  if (error) throw new Error(error.message);

  if (sendCancellationNotice) {
    const accountId = await accountIdForEntity(admin, store.entity_id);
    if (accountId) {
      // Cancellation restricts new work; it never breaks work in flight.
      const { subscriptionCancelledEmail } = await import("./email-templates.server");
      await sendClientEmail(admin, {
        clientId: accountId,
        ...subscriptionCancelledEmail({ periodEndDate: periodEndDate ?? null }),
      });
    }
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
 * SpyMarket subscriptions are a product of their own: separate Stripe
 * subscription, separate row, no effect on workspace plans or quotas. The
 * webhook is the only writer.
 */
async function syncSpyMarketSubscription(
  admin: Admin,
  sub: Record<string, unknown>,
  env: StripeEnv,
): Promise<boolean> {
  const subId = String(sub["id"] ?? "");
  const m = meta(sub);
  const { data: existing } = await admin
    .from("spymarket_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (!existing && m["kind"] !== "spymarket_subscription") return false;

  const accountId = m["flysales_user_id"] ?? null;
  const item = (
    sub["items"] as { data?: Array<{ current_period_end?: number; price?: { lookup_key?: string | null } }> } | undefined
  )?.data?.[0];
  const lookup = item?.price?.lookup_key ?? null;
  const planFromPrice =
    lookup === "spymarket_max_monthly"
      ? "max"
      : lookup === "spymarket_plus_monthly"
        ? "plus"
        : lookup === "spymarket_starter_monthly"
          ? "starter"
          : null;
  const plan = planFromPrice ?? (m["plan"] as string | undefined) ?? "starter";
  const periodEndUnix =
    item?.current_period_end ?? (sub["current_period_end"] as number | undefined) ?? null;

  const row = {
    plan,
    status: mapSubscriptionStatus(sub["status"] as string | undefined) === "none"
      ? "canceled"
      : mapSubscriptionStatus(sub["status"] as string | undefined),
    stripe_customer_id: idOf(sub["customer"]),
    stripe_subscription_id: subId,
    cancel_at_period_end: Boolean(sub["cancel_at_period_end"]),
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString().slice(0, 10)
      : null,
    environment: env,
  };

  if (existing) {
    const { error } = await admin
      .from("spymarket_subscriptions")
      .update(row)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    if (!accountId) throw new Error("spymarket subscription without flysales_user_id");
    const { error } = await admin
      .from("spymarket_subscriptions")
      .insert({ ...row, account_id: accountId });
    if (error) throw new Error(error.message);
  }
  return true;
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
  const entityId = pi.metadata?.["flysales_entity_id"];
  if (!entityId) {
    throw new Error(`payment intent ${paymentIntentId} missing flysales_entity_id`);
  }
  const kind = pi.metadata?.["kind"];
  const creditTxn = await creditWalletOnce(admin, {
    entityId,
    amountUsd: pi.amount_received / 100,
    reference: pi.id,
    // Human-readable description — the Stripe id lives in reference only.
    description: kind === "wallet_auto_topup" ? "Wallet auto top-up" : "Wallet top-up",
  });

  // Keep the card on file so auto top-up has a payment method later.
  const pm = idOf(pi.payment_method);
  if (pm) {
    await admin
      .from("entities")
      .update({ default_payment_method_id: pm })
      .eq("id", entityId);
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
    { p_entity_id: entityId },
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

  // Release middleware-sourced orders this top-up just paid (best-effort).
  {
    const { releaseAfterPayment } = await import("./middleware.server");
    await releaseAfterPayment(
      admin,
      released.map((o) => o.order_id),
    );
  }

  const balance = await getWalletBalance(admin, entityId);
  const accountId = await accountIdForEntity(admin, entityId);
  if (accountId) {
    const { walletToppedUpEmail } = await import("./email-templates.server");
    await sendClientEmail(admin, {
      clientId: accountId,
      ...walletToppedUpEmail({
        credited: pi.amount_received / 100,
        balance,
        released: released.map((o) => ({
          label: o.order_id.slice(0, 8),
          amount: Number(o.amount),
        })),
      }),
    });
  }
}

/**
 * Settle exactly the orders a client selected in a batch card payment. The
 * batch row (keyed on the Checkout session reference) carries the chosen
 * order ids — settlement is never oldest-first. Totals are recomputed from
 * the orders table at settlement time; orders cancelled or paid since
 * selection are skipped and their share is credited to the entity wallet as
 * a top-up (never refunded). Every credit/debit is reference-idempotent and
 * the batch row's settled_at is the replay guard.
 */
export async function handleOrderBatchPayment(
  stripe: Stripe,
  admin: Admin,
  paymentIntentId: string,
): Promise<void> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.status !== "succeeded") return;
  const reference = pi.metadata?.["batch_reference"];
  const entityId = pi.metadata?.["flysales_entity_id"];
  if (!reference || !entityId) {
    throw new Error(`payment intent ${paymentIntentId} missing batch metadata`);
  }

  const { data: batch, error: batchError } = await admin
    .from("order_batch_payments")
    .select("id, order_ids, settled_at")
    .eq("stripe_session_id", reference)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new Error(`batch payment not found for ${reference}`);
  if (batch.settled_at) return; // already settled — replay

  const orderIds = (Array.isArray(batch.order_ids) ? batch.order_ids : []) as string[];
  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id, status, total_amount, external_order_number, stores(entity_id)")
    .in("id", orderIds);
  if (ordersError) throw new Error(ordersError.message);
  const mine = (orders ?? []).filter(
    (o) => (o.stores as { entity_id?: string } | null)?.entity_id === entityId,
  );
  // Only orders still awaiting payment can settle; anything else is skipped.
  const payable = mine.filter(
    (o) => o.status === "awaiting_payment" && Number(o.total_amount ?? 0) > 0,
  );
  const skippedCount = orderIds.length - payable.length;

  // Fund the wallet for the settleable share (reference = payment intent → once).
  const settleSum = round2(payable.reduce((acc, o) => acc + Number(o.total_amount), 0));
  if (settleSum > 0) {
    await creditWalletOnce(admin, {
      entityId,
      amountUsd: settleSum,
      reference: pi.id,
      description: `Batch order payment — card (${payable.length} order${payable.length === 1 ? "" : "s"})`,
    });
  }

  // Settle each selected order (reference = order id → never twice).
  const settledIds: string[] = [];
  for (const order of payable) {
    const amount = Number(order.total_amount);
    await debitWalletOnce(admin, {
      entityId,
      amountUsd: amount,
      reference: order.id,
      description: `Order payment ${order.external_order_number ?? order.id} (batch card payment)`,
    });
    const { data: updated, error: payError } = await admin
      .from("orders")
      .update({
        status: "paid",
        payment_method: "direct",
        paid_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "awaiting_payment")
      .select("id");
    if (payError) throw new Error(payError.message);
    if ((updated ?? []).length > 0) {
      settledIds.push(order.id);
      await admin.rpc("release_order_to_fulfilment", { p_order_id: order.id });
    }
  }

  // Middleware release for the orders this card payment settled (best-effort).
  {
    const { releaseAfterPayment } = await import("./middleware.server");
    await releaseAfterPayment(admin, settledIds);
  }

  // Leftover = paid minus what actually settled (authoritative: the ledger
  // debits keyed on order ids), credited back to the wallet as a top-up.
  const { data: debits } = await admin
    .from("wallet_transactions")
    .select("reference, amount")
    .eq("entity_id", entityId)
    .in("reference", orderIds);
  const settledSum = round2(
    (debits ?? []).reduce((acc, d) => acc + Number(d.amount), 0),
  );
  const paidUsd = round2(pi.amount_received / 100);
  const leftover = round2(Math.max(0, paidUsd - settledSum));
  if (leftover > 0) {
    await creditWalletOnce(admin, {
      entityId,
      amountUsd: leftover,
      reference: `${pi.id}:leftover`,
      description:
        settledIds.length === 0
          ? "Batch payment credit — selected orders were no longer payable"
          : "Batch payment leftover — some selected orders were no longer payable",
    });
  }

  const { error: doneError } = await admin
    .from("order_batch_payments")
    .update({
      settled_at: new Date().toISOString(),
      settled_count: settledIds.length,
      leftover_credited: leftover,
      status: "settled",
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", batch.id)
    .is("settled_at", null);
  if (doneError) throw new Error(doneError.message);

  // Payment Receipt per settled order (best-effort; the ledger is truth).
  const { issueOrderReceipt } = await import("./documents.server");
  for (const id of settledIds) {
    try {
      await issueOrderReceipt(admin, id);
    } catch (e) {
      console.error("order receipt failed:", id, e);
    }
  }

  const body =
    settledIds.length === 0
      ? `None of the selected orders were still awaiting payment, so $${leftover.toFixed(2)} was credited to your wallet instead.`
      : `${settledIds.length} order${settledIds.length === 1 ? "" : "s"} paid — $${settledSum.toFixed(2)}.` +
        (leftover > 0
          ? ` $${leftover.toFixed(2)} was credited to your wallet because ${skippedCount} selected order${skippedCount === 1 ? " was" : "s were"} no longer payable.`
          : "");
  await notify(admin, {
    entityId,
    kind: "order_batch_settled",
    title: "Batch payment processed",
    body,
  });
  const accountId = await accountIdForEntity(admin, entityId);
  if (accountId) {
    const { batchPaymentEmail } = await import("./email-templates.server");
    await sendClientEmail(admin, {
      clientId: accountId,
      ...batchPaymentEmail({
        settledCount: settledIds.length,
        settledSum,
        leftover,
        skippedCount,
      }),
    });
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
        const storeId = meta(session)["flysales_store_id"];
        if (!storeId) throw new Error("subscription session missing flysales_store_id");
        const plan = meta(session)["plan"] === "unlimited" ? "unlimited" : "basic";
        const customerId = idOf(session["customer"]);
        const subscriptionId = idOf(session["subscription"]);
        const store = await findStoreById(admin, storeId);
        if (!store) throw new Error(`subscription session for unknown store ${storeId}`);
        const patch: Database["public"]["Tables"]["stores"]["Update"] = {
          subscription_status: "active",
          subscription_plan: plan,
        };
        if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
        const { error } = await admin.from("stores").update(patch).eq("id", storeId);
        if (error) throw new Error(error.message);
        if (customerId) {
          await admin
            .from("entities")
            .update({ stripe_customer_id: customerId })
            .eq("id", store.entity_id);
          // Backfill userId on the Customer so search-based reads resolve.
          const accountId = await accountIdForEntity(admin, store.entity_id);
          if (accountId) {
            try {
              await stripe.customers.update(customerId, {
                metadata: { userId: accountId, flysales_user_id: accountId },
              });
            } catch (e) {
              console.error("customer metadata backfill failed", e);
            }
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
        const accountId = await accountIdForEntity(admin, store.entity_id);
        if (accountId) {
          const { subscriptionActiveEmail } = await import("./email-templates.server");
          await sendClientEmail(admin, {
            clientId: accountId,
            ...subscriptionActiveEmail({
              planLabel: planLabel(plan),
              priceUsd: PLANS[plan].priceUsd,
              nextBilling: nextBilling ?? null,
            }),
          });
        }
      } else if (kind === "spymarket_subscription") {
        const subscriptionId = idOf(session["subscription"]);
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSpyMarketSubscription(
            admin,
            sub as unknown as Record<string, unknown>,
            env,
          );
        }
        const accountId = meta(session)["flysales_user_id"];
        const plan = meta(session)["plan"] ?? "starter";
        if (accountId) {
          const { spymarketActiveEmail } = await import("./email-templates.server");
          await sendClientEmail(admin, {
            clientId: accountId,
            ...spymarketActiveEmail({
              planLabel: plan.charAt(0).toUpperCase() + plan.slice(1),
            }),
          });
        }
      } else if (kind === "wallet_topup") {
        const piId = idOf(session["payment_intent"]);
        if (piId) await handleWalletTopup(stripe, admin, piId);
      } else if (kind === "order_batch") {
        const piId = idOf(session["payment_intent"]);
        if (piId) await handleOrderBatchPayment(stripe, admin, piId);
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      if (await syncSpyMarketSubscription(admin, event.data.object, env)) return;
      await syncSubscriptionFromStripe(admin, event.data.object);
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      {
        const subId = String(sub["id"] ?? "");
        const { data: spy } = await admin
          .from("spymarket_subscriptions")
          .select("id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (spy) {
          const { error } = await admin
            .from("spymarket_subscriptions")
            .update({ status: "canceled", cancel_at_period_end: false })
            .eq("id", spy.id);
          if (error) throw new Error(error.message);
          return;
        }
      }
      const store = await findStoreByStripeSubscription(admin, String(sub["id"] ?? ""));
      if (!store) {
        console.error("subscription.deleted for unknown store", sub["id"]);
        return;
      }
      // Access ends with the subscription — fall back to the Basic tier.
      // The wallet balance is the client's money: never zeroed or expired.
      // The catalogue and in-flight orders stay untouched.
      const { error } = await admin
        .from("stores")
        .update({
          subscription_status: "canceled",
          subscription_plan: "basic",
          pending_plan_change: null,
          pending_plan_change_date: null,
        })
        .eq("id", store.id);
      if (error) throw new Error(error.message);
      await admin
        .from("entities")
        .update({ cancel_notice_sent_at: null })
        .eq("id", store.entity_id);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = idOf(invoice["subscription"]);
      const store = subscriptionId
        ? await findStoreByStripeSubscription(admin, subscriptionId)
        : null;
      if (!store) {
        console.error("invoice.payment_failed for unknown subscription", subscriptionId);
        return;
      }
      const wasAlreadyPastDue = store.subscription_status === "past_due";
      const { error } = await admin
        .from("stores")
        .update({ subscription_status: "past_due" })
        .eq("id", store.id);
      if (error) throw new Error(error.message);
      // Notify once, on the transition into past_due — Stripe retries for
      // days and the client must not get an email per retry. Nothing is
      // blocked at this stage; restrictions only apply if Stripe ultimately
      // cancels the subscription.
      if (!wasAlreadyPastDue) {
        await notify(admin, {
          storeId: store.id,
          entityId: store.entity_id,
          kind: "subscription_payment_failed",
          title: "Subscription payment failed",
          body: "We could not charge your card for your FlySales subscription. Stripe will retry automatically — update your payment method from the Billing page to keep your plan.",
        });
        const accountId = await accountIdForEntity(admin, store.entity_id);
        if (accountId) {
          const { paymentFailedEmail } = await import("./email-templates.server");
          await sendClientEmail(admin, {
            clientId: accountId,
            ...paymentFailedEmail(),
          });
        }
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
      } else if (kind === "order_batch") {
        const piId = String(event.data.object["id"] ?? "");
        if (piId) await handleOrderBatchPayment(stripe, admin, piId);
      }
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const piId = idOf(charge["payment_intent"]);
      const refundedUsd = (Number(charge["amount_refunded"]) || 0) / 100;
      if (!piId || refundedUsd <= 0) return;
      // The original credit's reference is the payment intent id — it tells
      // us which entity this refund debits.
      const { data: original } = await admin
        .from("wallet_transactions")
        .select("entity_id, amount")
        .eq("reference", piId)
        .maybeSingle();
      if (!original) {
        console.error("refund for unknown payment intent", piId);
        return;
      }
      await debitWalletOnce(admin, {
        entityId: original.entity_id,
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
