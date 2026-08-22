import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { round2 } from "./admin.server";

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
