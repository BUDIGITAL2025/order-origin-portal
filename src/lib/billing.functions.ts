import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  autoTopupSettingsSchema,
  changePlanSchema,
  notificationIdsSchema,
  stripeEnvSchema,
  subscriptionCheckoutSchema,
  topUpCheckoutSchema,
} from "./schemas";

// Local copy of the server StripeEnv — this module ships a client RPC stub,
// so it must not import the server-only Stripe module at runtime.
type StripeEnv = "sandbox" | "live";

type Result<T> = T | { error: string };

async function stripeErrorText(error: unknown): Promise<string> {
  const { getStripeErrorMessage } = await import("./stripe.server");
  return getStripeErrorMessage(error);
}

const BILLING_PROFILE_SELECT =
  "subscription_plan, fee_waived, status, stripe_customer_id, stripe_subscription_id, subscription_status, auto_topup_enabled, auto_topup_threshold, auto_topup_amount, default_payment_method_id";

/**
 * Billing overview for the signed-in client: plan/subscription state (from
 * the profile — written only by the webhook), live next-billing date and
 * saved card from Stripe, wallet balance, and unread notifications.
 */
export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => stripeEnvSchema.parse(input))
  .handler(async ({ data: environment, context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: latestTxn }, { data: notifications }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select(BILLING_PROFILE_SELECT)
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("wallet_transactions")
          .select("balance_after")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("notifications")
          .select("id, kind, title, body, created_at")
          .is("read_at", null)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
    if (!profile) throw new Error("Profile not found");

    const base = {
      profile,
      balance: latestTxn ? Number(latestTxn.balance_after) : 0,
      notifications: notifications ?? [],
      nextBillingDate: null as string | null,
      paymentMethod: null as {
        brand: string;
        last4: string;
        expMonth: number;
        expYear: number;
      } | null,
      stripeError: null as string | null,
    };

    const hasSubscription =
      profile.stripe_subscription_id &&
      (profile.subscription_status === "active" ||
        profile.subscription_status === "past_due");
    const hasCard = Boolean(profile.default_payment_method_id);
    if (!hasSubscription && !hasCard) return base;

    try {
      const { createStripeClient } = await import("./stripe.server");
      const stripe = createStripeClient(environment);
      let nextBillingDate: string | null = null;
      if (hasSubscription && profile.stripe_subscription_id) {
        const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        const item = sub.items?.data?.[0] as
          | { current_period_end?: number }
          | undefined;
        const periodEnd =
          item?.current_period_end ??
          (sub as unknown as { current_period_end?: number }).current_period_end;
        nextBillingDate = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      }
      let paymentMethod = base.paymentMethod;
      if (profile.default_payment_method_id) {
        try {
          const pm = await stripe.paymentMethods.retrieve(
            profile.default_payment_method_id,
          );
          if (pm.card) {
            paymentMethod = {
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            };
          }
        } catch {
          // Saved card no longer exists in Stripe — show nothing.
        }
      }
      return { ...base, nextBillingDate, paymentMethod };
    } catch (error) {
      return { ...base, stripeError: await stripeErrorText(error) };
    }
  });

/**
 * Start a NEW subscription: creates a Checkout Session (subscription mode) and
 * returns the Stripe URL — the client is redirected there. State changes only
 * ever come from the webhook; the redirect back carries no authority.
 * Waived clients never enter Stripe billing.
 */
export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => subscriptionCheckoutSchema.parse(input))
  .handler(async ({ data, context }): Promise<Result<{ url: string }>> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const billing = await import("./billing.server");
      const { getAdminClient } = await import("./admin.server");
      const stripe = createStripeClient(data.environment);

      const { data: profile } = await context.supabase
        .from("profiles")
        .select(BILLING_PROFILE_SELECT)
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile) throw new Error("Complete your company profile first");
      if (profile.status !== "active") throw new Error("Your account is not active yet");
      if (profile.fee_waived) {
        throw new Error("Your plan is managed by FlySales — no payment needed.");
      }
      if (
        profile.subscription_status === "active" ||
        profile.subscription_status === "past_due"
      ) {
        throw new Error("You already have a subscription — use change plan instead.");
      }

      const email = (context.claims?.email as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        email,
        userId: context.userId,
        existingCustomerId: profile.stripe_customer_id,
      });

      // Persist the customer id immediately so the webhook can resolve the
      // profile even if the user closes the tab mid-checkout.
      if (profile.stripe_customer_id !== customerId) {
        const admin = await getAdminClient();
        await admin
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", context.userId);
      }

      const prices = await stripe.prices.list({
        lookup_keys: [billing.PLAN_PRICE_IDS[data.plan]],
      });
      const price = prices.data[0];
      if (!price) throw new Error("Plan price not found");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${data.returnUrl}?sub=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${data.returnUrl}?sub=cancel`,
        metadata: {
          kind: "flysales_subscription",
          flysales_user_id: context.userId,
          plan: data.plan,
        },
        subscription_data: {
          metadata: {
            flysales_user_id: context.userId,
            userId: context.userId,
            plan: data.plan,
          },
        },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { url: session.url };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

/**
 * Wallet top-up: Checkout Session in PAYMENT mode (embedded) with
 * setup_future_usage so the card stays on file for auto top-up. The amount is
 * free-form (>= $50) via price_data. Crediting happens ONLY in the webhook,
 * keyed on the payment intent id.
 */
export const createWalletTopupCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => topUpCheckoutSchema.parse(input))
  .handler(async ({ data, context }): Promise<Result<{ clientSecret: string }>> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const billing = await import("./billing.server");
      const { getAdminClient } = await import("./admin.server");
      const stripe = createStripeClient(data.environment);

      const { data: profile } = await context.supabase
        .from("profiles")
        .select(BILLING_PROFILE_SELECT)
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile) throw new Error("Complete your company profile first");
      if (profile.status !== "active") throw new Error("Your account is not active yet");

      const email = (context.claims?.email as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        email,
        userId: context.userId,
        existingCustomerId: profile.stripe_customer_id,
      });
      if (profile.stripe_customer_id !== customerId) {
        const admin = await getAdminClient();
        await admin
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", context.userId);
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "FlySales wallet top-up" },
              unit_amount: Math.round(data.amountUsd * 100),
            },
            quantity: 1,
          },
        ],
        // Surfaces as the product name in the payments dashboard.
        payment_intent_data: {
          description: "FlySales wallet top-up",
          setup_future_usage: "off_session",
          metadata: {
            kind: "wallet_topup",
            flysales_user_id: context.userId,
            amount_usd: String(data.amountUsd),
          },
        },
        metadata: {
          kind: "wallet_topup",
          flysales_user_id: context.userId,
          amount_usd: String(data.amountUsd),
        },
      });
      if (!session.client_secret) {
        throw new Error("Stripe did not return a client secret");
      }
      return { clientSecret: session.client_secret };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

/**
 * Change plan on an EXISTING subscription. Upgrades apply immediately with
 * proration; downgrades are scheduled and take effect at period end. The
 * webhook applies the resulting state to the profile in both cases.
 */
export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => changePlanSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<Result<{ applied: "immediate" | "period_end" }>> => {
      try {
        const { createStripeClient } = await import("./stripe.server");
        const billing = await import("./billing.server");
        const stripe = createStripeClient(data.environment);

        const { data: profile } = await context.supabase
          .from("profiles")
          .select(BILLING_PROFILE_SELECT)
          .eq("id", context.userId)
          .maybeSingle();
        if (!profile) throw new Error("Profile not found");
        if (profile.fee_waived) {
          throw new Error("Your plan is managed by FlySales — contact support.");
        }
        if (
          !profile.stripe_subscription_id ||
          profile.subscription_status !== "active"
        ) {
          throw new Error("No active subscription — subscribe first.");
        }

        const newPriceLookup = billing.PLAN_PRICE_IDS[data.plan];
        const prices = await stripe.prices.list({ lookup_keys: [newPriceLookup] });
        const newPrice = prices.data[0];
        if (!newPrice) throw new Error("Plan price not found");

        const sub = await stripe.subscriptions.retrieve(
          profile.stripe_subscription_id,
        );
        const item = sub.items?.data?.[0] as
          | {
              id: string;
              price?: { id: string; lookup_key?: string | null };
              current_period_start?: number;
              current_period_end?: number;
            }
          | undefined;
        if (!item) throw new Error("Subscription has no items");
        const currentLookup = item.price?.lookup_key ?? null;
        const currentPlan = billing.planFromLookupKey(currentLookup);
        if (currentPlan === data.plan) throw new Error("You are already on this plan");

        const isUpgrade = data.plan === "unlimited";
        if (isUpgrade) {
          // Immediate: Stripe invoices the prorated difference now.
          await stripe.subscriptions.update(profile.stripe_subscription_id, {
            items: [{ id: item.id, price: newPrice.id }],
            proration_behavior: "create_prorations",
          });
          return { applied: "immediate" };
        }

        // Downgrade at period end via a subscription schedule.
        const periodEnd =
          item.current_period_end ??
          (sub as unknown as { current_period_end?: number }).current_period_end;
        if (!periodEnd || !item.price?.id) {
          throw new Error("Cannot schedule the downgrade — missing billing period");
        }
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: profile.stripe_subscription_id,
        });
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: "release",
          proration_behavior: "none",
          phases: [
            {
              items: [{ price: item.price.id, quantity: 1 }],
              end_date: periodEnd,
            },
            { items: [{ price: newPrice.id, quantity: 1 }] },
          ],
        });
        return { applied: "period_end" };
      } catch (error) {
        return { error: await stripeErrorText(error) };
      }
    },
  );

/**
 * Auto top-up settings — entirely client-controlled. Enabling requires a
 * saved card (written by the top-up webhook) plus threshold and amount ($50+).
 */
export const saveAutoTopupSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => autoTopupSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.enabled) {
      if (data.threshold == null || data.amount == null) {
        throw new Error("Set both a threshold and an amount to enable auto top-up");
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("default_payment_method_id")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.default_payment_method_id) {
        throw new Error(
          "Make a card top-up first so we have a payment method on file",
        );
      }
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        auto_topup_enabled: data.enabled,
        auto_topup_threshold: data.enabled ? data.threshold : null,
        auto_topup_amount: data.enabled ? data.amount : null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Mark own notifications as read. */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => notificationIdsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", data.ids)
      .eq("client_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
