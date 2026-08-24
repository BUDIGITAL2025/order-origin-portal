import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeEnvSchema } from "./schemas";

/**
 * SpyMarket interest capture. SpyMarket is a shell — no research tool, no
 * credits ledger, no external API. This module only records which plan an
 * account is interested in (one row per account; re-picking updates it).
 */

const planSchema = z.object({ plan: z.enum(["starter", "plus", "max"]) });

/** Client: my current SpyMarket waitlist registration, if any. */
export const getMySpyMarketInterest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("spymarket_interest")
      .select("id, plan_interest, created_at")
      .eq("account_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

/**
 * Client: register (or change) plan interest. One registration per account —
 * upsert on the UNIQUE(account_id) constraint, so picking a different plan
 * updates plan_interest in place. entity_id stamps the account's first
 * entity when one exists; the row stays valid without one (storeless).
 */
export const registerSpyMarketInterest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => planSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: entity } = await context.supabase
      .from("entities")
      .select("id")
      .eq("account_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: row, error } = await context.supabase
      .from("spymarket_interest")
      .upsert(
        {
          account_id: context.userId,
          entity_id: entity?.id ?? null,
          plan_interest: data.plan,
        },
        { onConflict: "account_id" },
      )
      .select("id, plan_interest, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Admin: the full waitlist with a count per plan — negotiation material. */
export const adminListSpyMarketInterest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("spymarket_interest")
      .select(
        "id, plan_interest, created_at, profiles(contact_name), entities(legal_name)",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const entries = (data ?? []).map((row) => ({
      id: row.id,
      plan_interest: row.plan_interest,
      created_at: row.created_at,
      contact_name:
        (row.profiles as { contact_name?: string } | null)?.contact_name ?? "—",
      entity_name:
        (row.entities as { legal_name?: string } | null)?.legal_name ?? null,
    }));
    const counts = { starter: 0, plus: 0, max: 0 };
    for (const e of entries) counts[e.plan_interest as keyof typeof counts] += 1;
    return { entries, counts, total: entries.length };
  });

// ============= Paid SpyMarket subscriptions =============

/** Human-readable Stripe price lookup keys, stable across test and live. */
export const SPYMARKET_PRICE_IDS = {
  starter: "spymarket_starter_monthly",
  plus: "spymarket_plus_monthly",
  max: "spymarket_max_monthly",
} as const;

const checkoutSchema = z.object({
  plan: z.enum(["starter", "plus", "max"]),
  returnUrl: z.string().trim().url("Invalid return URL").max(500),
  environment: stripeEnvSchema,
});

/** Client: my SpyMarket subscription for this Stripe environment, if any. */
export const getMySpyMarketSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ environment: stripeEnvSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("spymarket_subscriptions")
      .select("id, plan, status, cancel_at_period_end, current_period_end, created_at")
      .eq("account_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Client: Stripe Checkout for a SpyMarket plan. This is a separate
 * subscription from the FlySales workspace plan — its own Stripe
 * subscription, invoiced independently. Access to the tool starts at launch;
 * billing starts now, which is what the client agreed to on the page.
 */
export const createSpyMarketCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => checkoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createStripeClient, getStripeErrorMessage } = await import("./stripe.server");
    try {
      const billing = await import("./billing.server");
      const stripe = createStripeClient(data.environment);

      // Already subscribed in this environment → nothing to buy.
      const { data: existing } = await context.supabase
        .from("spymarket_subscriptions")
        .select("id, status")
        .eq("account_id", context.userId)
        .eq("environment", data.environment)
        .in("status", ["active", "past_due"])
        .limit(1)
        .maybeSingle();
      if (existing) {
        throw new Error("You already have a SpyMarket subscription.");
      }

      const { getAdminClient } = await import("./admin.server");
      const admin = await getAdminClient();
      const { data: entity } = await admin
        .from("entities")
        .select("id, stripe_customer_id")
        .eq("account_id", context.userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const email = (context.claims?.email as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        ...(email ? { email } : {}),
        userId: context.userId,
        existingCustomerId: entity?.stripe_customer_id ?? null,
      });
      if (entity && entity.stripe_customer_id !== customerId) {
        await admin.from("entities").update({ stripe_customer_id: customerId }).eq("id", entity.id);
      }

      const prices = await stripe.prices.list({
        lookup_keys: [SPYMARKET_PRICE_IDS[data.plan]],
      });
      const price = prices.data[0];
      if (!price) throw new Error("SpyMarket plan price not found");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${data.returnUrl}?spymarket=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${data.returnUrl}?spymarket=cancel`,
        metadata: {
          kind: "spymarket_subscription",
          flysales_user_id: context.userId,
          plan: data.plan,
        },
        subscription_data: {
          metadata: {
            kind: "spymarket_subscription",
            flysales_user_id: context.userId,
            userId: context.userId,
            plan: data.plan,
          },
        },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { url: session.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
