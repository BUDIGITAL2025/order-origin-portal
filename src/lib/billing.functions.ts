import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  autoTopupSettingsSchema,
  batchOrderCheckoutSchema,
  batchOrderIdsSchema,
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

// Store-scoped variants of the shared schemas — the caller's current store
// (from the store switcher) carries the subscription; entity-level flows
// (top-up, auto top-up) resolve the entity from that same store.
const billingOverviewInputSchema = z.object({
  storeId: z.string().uuid(),
  environment: stripeEnvSchema,
});
// storeId is optional: subscribing without a workspace yet creates a draft
// workspace and attaches the subscription (and its quota) to it.
const storeSubscriptionCheckoutSchema = subscriptionCheckoutSchema.extend({
  storeId: z.string().uuid().optional(),
});
const storeChangePlanSchema = changePlanSchema.extend({ storeId: z.string().uuid() });
const storeStripeEnvSchema = z.object({ storeId: z.string().uuid(), environment: stripeEnvSchema });
// Top-ups credit the entity wallet. Storeless accounts pass entityId
// directly; with a store, storeId resolves the owning entity.
const entityTopUpCheckoutSchema = topUpCheckoutSchema
  .extend({
    storeId: z.string().uuid().optional(),
    entityId: z.string().uuid().optional(),
  })
  .refine((v) => v.storeId != null || v.entityId != null, {
    message: "storeId or entityId is required",
  });
const entityAutoTopupSettingsSchema = autoTopupSettingsSchema.extend({
  storeId: z.string().uuid(),
});

/** Resolve the store + its entity, verifying the store belongs to the caller's account. */
async function resolveStoreAndEntity(
  admin: Awaited<ReturnType<typeof import("./admin.server").getAdminClient>>,
  storeId: string,
  accountId: string,
) {
  const { data: store, error } = await admin
    .from("stores")
    .select("*, entities!inner(*)")
    .eq("id", storeId)
    .eq("entities.account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!store) throw new Error("Store not found for your account");
  const { entities: entity, ...storeRow } = store;
  return { store: storeRow, entity };
}

/**
 * Billing overview for the signed-in client's CURRENT store: subscription
 * state (from the store — written only by the webhook), live next-billing
 * date and saved card from Stripe, wallet balance, and unread notifications.
 */
export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => billingOverviewInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    const { store, entity } = await resolveStoreAndEntity(admin, data.storeId, userId);

    const [{ data: latestTxn }, { data: notifications }] = await Promise.all([
      admin
        .from("wallet_transactions")
        .select("balance_after")
        .eq("entity_id", entity.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("notifications")
        .select("id, kind, title, body, created_at")
        .or(`entity_id.eq.${entity.id},store_id.eq.${store.id}`)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const base = {
      store: {
        id: store.id,
        subscription_plan: store.subscription_plan,
        subscription_status: store.subscription_status,
        pending_plan_change: store.pending_plan_change,
        pending_plan_change_date: store.pending_plan_change_date,
        fee_waived: store.fee_waived,
        stripe_subscription_id: store.stripe_subscription_id,
      },
      entity: {
        id: entity.id,
        auto_topup_enabled: entity.auto_topup_enabled,
        auto_topup_threshold: entity.auto_topup_threshold,
        auto_topup_amount: entity.auto_topup_amount,
        has_default_payment_method: Boolean(entity.default_payment_method_id),
      },
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
      store.stripe_subscription_id &&
      (store.subscription_status === "active" || store.subscription_status === "past_due");
    const hasCard = Boolean(entity.default_payment_method_id);
    if (!hasSubscription && !hasCard) return base;

    try {
      const { createStripeClient } = await import("./stripe.server");
      const stripe = createStripeClient(data.environment);
      let nextBillingDate: string | null = null;
      if (hasSubscription && store.stripe_subscription_id) {
        const sub = await stripe.subscriptions.retrieve(store.stripe_subscription_id);
        const item = sub.items?.data?.[0] as
          | { current_period_end?: number }
          | undefined;
        const periodEnd =
          item?.current_period_end ??
          (sub as unknown as { current_period_end?: number }).current_period_end;
        nextBillingDate = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      }
      let paymentMethod = base.paymentMethod;
      if (entity.default_payment_method_id) {
        try {
          const pm = await stripe.paymentMethods.retrieve(entity.default_payment_method_id);
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
 * Start a NEW subscription for a store: creates a Checkout Session
 * (subscription mode) and returns the Stripe URL — the client is redirected
 * there. State changes only ever come from the webhook; the redirect back
 * carries no authority. Waived stores never enter Stripe billing.
 */
export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => storeSubscriptionCheckoutSchema.parse(input))
  .handler(async ({ data, context }): Promise<Result<{ url: string }>> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const billing = await import("./billing.server");
      const { getAdminClient } = await import("./admin.server");
      const stripe = createStripeClient(data.environment);
      const admin = await getAdminClient();

      let store: Awaited<ReturnType<typeof resolveStoreAndEntity>>["store"];
      let entity: Awaited<ReturnType<typeof resolveStoreAndEntity>>["entity"];
      if (data.storeId) {
        ({ store, entity } = await resolveStoreAndEntity(admin, data.storeId, context.userId));
      } else {
        // Storeless subscribe: resolve the caller's first entity and reuse an
        // unsubscribed workspace, or create a draft one. The subscription and
        // quota attach to it; Shopify connects later, nothing is recreated.
        const { data: entityRow, error: entityError } = await admin
          .from("entities")
          .select("*")
          .eq("account_id", context.userId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (entityError) throw new Error(entityError.message);
        if (!entityRow) throw new Error("Complete your account profile first");
        entity = entityRow;
        const { data: existing } = await admin
          .from("stores")
          .select("*")
          .eq("entity_id", entity.id)
          .in("subscription_status", ["none", "canceled"])
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (existing) {
          store = existing;
        } else {
          const { data: created, error: storeError } = await admin
            .from("stores")
            .insert({
              entity_id: entity.id,
              platform: "other",
              store_url: null,
              store_name: `Workspace — ${entity.legal_name}`,
              integration_mode: "manual",
              status: "draft",
              provisioning_status: "not_started",
            })
            .select("*")
            .single();
          if (storeError) throw new Error(storeError.message);
          store = created;
        }
      }
      if (store.status === "suspended") throw new Error("This workspace is suspended — contact support.");
      if (store.fee_waived) {
        throw new Error("Your plan is managed by FlySales — no payment needed.");
      }
      if (
        store.subscription_status === "active" ||
        store.subscription_status === "past_due"
      ) {
        throw new Error("You already have a subscription — use change plan instead.");
      }

      const email = (context.claims?.email as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        ...(email ? { email } : {}),
        userId: context.userId,
        existingCustomerId: entity.stripe_customer_id,
      });

      // Persist the customer id immediately so the webhook can resolve the
      // entity even if the user closes the tab mid-checkout.
      if (entity.stripe_customer_id !== customerId) {
        await admin.from("entities").update({ stripe_customer_id: customerId }).eq("id", entity.id);
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
          flysales_store_id: store.id,
          plan: data.plan,
        },
        subscription_data: {
          metadata: {
            flysales_user_id: context.userId,
            flysales_store_id: store.id,
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
 * Client: settle selected awaiting_payment orders from the wallet in one go.
 * The Postgres function re-checks ownership, recomputes totals, debits with
 * order-id idempotency and credits back any order that was settled by another
 * route in the meantime.
 */
export const payOrdersFromWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => batchOrderIdsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: settled, error } = await context.supabase.rpc("pay_orders_from_wallet", {
      p_order_ids: data.orderIds,
    });
    if (error) throw new Error(error.message);
    const rows = (settled ?? []) as Array<{ order_id: string; amount: number }>;
    // Payment Receipt for each order the wallet just paid (best-effort;
    // issueOrderReceipt is idempotent and the cron sweep is the backstop).
    if (rows.length > 0) {
      const { getAdminClient } = await import("./admin.server");
      const { issueOrderReceipt } = await import("./documents.server");
      const admin = await getAdminClient();
      for (const row of rows) {
        try {
          await issueOrderReceipt(admin, row.order_id);
        } catch (e) {
          console.error("order receipt failed:", row.order_id, e);
        }
      }
    }
    return { settled: rows };
  });

/**
 * Client: one Stripe Checkout covering the summed total of the selected
 * awaiting_payment orders. The selection is persisted in
 * order_batch_payments (keyed on the session id) so the webhook settles
 * exactly these orders — never oldest-first.
 */
export const createBatchOrderCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => batchOrderCheckoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createStripeClient } = await import("./stripe.server");
    // RLS scopes this read to the caller's own stores.
    const { data: rows, error } = await context.supabase
      .from("orders")
      .select("id, total_amount, stores!inner(entity_id)")
      .in("id", data.orderIds)
      .eq("status", "awaiting_payment");
    if (error) throw new Error(error.message);
    const orders = (rows ?? []) as Array<{
      id: string;
      total_amount: number | string | null;
      stores: { entity_id: string };
    }>;
    if (orders.length === 0) {
      throw new Error("None of the selected orders are awaiting payment anymore.");
    }
    const entityIds = new Set(orders.map((o) => o.stores.entity_id));
    if (entityIds.size !== 1) throw new Error("Orders must belong to the same entity.");
    const entityId = orders[0]!.stores.entity_id;

    // Suspension gate: card payments of awaiting_payment orders are frozen
    // while suspended. Wallet payments are blocked inside pay_orders_from_wallet.
    const [{ data: entityRow }, { data: profileRow }] = await Promise.all([
      context.supabase.from("entities").select("status").eq("id", entityId).maybeSingle(),
      context.supabase.from("profiles").select("status").eq("id", context.userId).maybeSingle(),
    ]);
    if (entityRow?.status === "suspended" || profileRow?.status === "suspended") {
      throw new Error(
        "Payments are frozen while this account is suspended — contact your account manager.",
      );
    }
    const total = orders.reduce((acc, o) => acc + Number(o.total_amount ?? 0), 0);
    if (!(total > 0)) throw new Error("Selected orders have no payable total.");

    const stripe = createStripeClient(data.environment);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(total * 100),
            product_data: {
              name: `FlySales order payment — ${orders.length} order${orders.length === 1 ? "" : "s"}`,
            },
          },
        },
      ],
      success_url: `${data.returnUrl}?batch=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.returnUrl}?batch=cancel`,
      metadata: { flysales_entity_id: entityId, kind: "order_batch" },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    // The batch reference is the session id — only known after creation, so
    // stamp it onto the session AND its payment intent now.
    const batchMeta = { batch_reference: session.id };
    await stripe.checkout.sessions.update(session.id, { metadata: batchMeta });
    const piId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;
    if (piId) {
      await stripe.paymentIntents.update(piId, {
        metadata: { flysales_entity_id: entityId, kind: "order_batch", ...batchMeta },
      });
    }
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    const { error: insertError } = await admin.from("order_batch_payments").insert({
      entity_id: entityId,
      order_ids: orders.map((o) => o.id),
      amount: Math.round(total * 100) / 100,
      status: "pending",
      stripe_session_id: session.id,
      stripe_payment_intent_id: piId,
    });
    if (insertError) throw new Error(insertError.message);
    return { url: session.url };
  });

/**
 * Wallet top-up: Checkout Session in PAYMENT mode (embedded) with
 * setup_future_usage so the card stays on file for auto top-up. The amount is
 * free-form (>= $50) via price_data. Crediting happens ONLY in the webhook,
 * keyed on the payment intent id. Wallets live at the entity level — the
 * caller's current store resolves which entity is credited.
 */
export const createWalletTopupCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => entityTopUpCheckoutSchema.parse(input))
  .handler(async ({ data, context }): Promise<Result<{ clientSecret: string }>> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const billing = await import("./billing.server");
      const { getAdminClient } = await import("./admin.server");
      const stripe = createStripeClient(data.environment);
      const admin = await getAdminClient();

      let entity;
      if (data.storeId) {
        ({ entity } = await resolveStoreAndEntity(admin, data.storeId, context.userId));
      } else {
        const { data: row, error } = await admin
          .from("entities")
          .select("*")
          .eq("id", data.entityId!)
          .eq("account_id", context.userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) throw new Error("Entity not found for this account");
        entity = row;
      }

      // No top-ups while suspended — the wallet itself stays intact and
      // refunds keep flowing; only NEW money-in is paused.
      const { data: profileRow } = await context.supabase
        .from("profiles")
        .select("status")
        .eq("id", context.userId)
        .maybeSingle();
      if (entity.status === "suspended" || profileRow?.status === "suspended") {
        throw new Error(
          "This account is suspended — wallet top-ups are disabled. Contact your account manager.",
        );
      }

      const email = (context.claims?.email as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        ...(email ? { email } : {}),
        userId: context.userId,
        existingCustomerId: entity.stripe_customer_id,
      });
      if (entity.stripe_customer_id !== customerId) {
        await admin.from("entities").update({ stripe_customer_id: customerId }).eq("id", entity.id);
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
            flysales_entity_id: entity.id,
            flysales_user_id: context.userId,
            amount_usd: String(data.amountUsd),
          },
        },
        metadata: {
          kind: "wallet_topup",
          flysales_entity_id: entity.id,
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
 * Change plan on an EXISTING subscription (per store). Upgrades apply
 * immediately with proration; downgrades are scheduled and take effect at
 * period end. The webhook applies the resulting state to the store in both
 * cases.
 */
export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => storeChangePlanSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<Result<{ applied: "immediate" | "period_end" }>> => {
      try {
        const { createStripeClient } = await import("./stripe.server");
        const billing = await import("./billing.server");
        const { getAdminClient } = await import("./admin.server");
        const stripe = createStripeClient(data.environment);
        const admin = await getAdminClient();

        const { store } = await resolveStoreAndEntity(admin, data.storeId, context.userId);
        if (store.fee_waived) {
          throw new Error("Your plan is managed by FlySales — contact support.");
        }
        if (!store.stripe_subscription_id || store.subscription_status !== "active") {
          throw new Error("No active subscription — subscribe first.");
        }
        // No repeated changes: one scheduled change at a time.
        if (store.pending_plan_change) {
          throw new Error(
            "A plan change is already scheduled — keep your current plan or wait for it to take effect.",
          );
        }

        const newPriceLookup = billing.PLAN_PRICE_IDS[data.plan];
        const prices = await stripe.prices.list({ lookup_keys: [newPriceLookup] });
        const newPrice = prices.data[0];
        if (!newPrice) throw new Error("Plan price not found");

        const sub = await stripe.subscriptions.retrieve(store.stripe_subscription_id);
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
          await stripe.subscriptions.update(store.stripe_subscription_id, {
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
          from_subscription: store.stripe_subscription_id,
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
        // Record the pending change so the billing page can show it and
        // block stacking a second change.
        const { error: pendingError } = await admin
          .from("stores")
          .update({
            pending_plan_change: data.plan,
            pending_plan_change_date: new Date(periodEnd * 1000)
              .toISOString()
              .slice(0, 10),
          })
          .eq("id", store.id);
        if (pendingError) throw new Error(pendingError.message);
        return { applied: "period_end" };
      } catch (error) {
        return { error: await stripeErrorText(error) };
      }
    },
  );

/**
 * Auto top-up settings — entirely client-controlled, at the entity level.
 * Enabling requires a saved card (written by the top-up webhook) plus
 * threshold and amount ($50+).
 */
export const saveAutoTopupSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => entityAutoTopupSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    const { entity } = await resolveStoreAndEntity(admin, data.storeId, context.userId);

    if (data.enabled) {
      if (data.threshold == null || data.amount == null) {
        throw new Error("Set both a threshold and an amount to enable auto top-up");
      }
      if (!entity.default_payment_method_id) {
        throw new Error(
          "Make a card top-up first so we have a payment method on file",
        );
      }
    }
    const { error } = await admin
      .from("entities")
      .update({
        auto_topup_enabled: data.enabled,
        auto_topup_threshold: data.enabled ? data.threshold : null,
        auto_topup_amount: data.enabled ? data.amount : null,
      })
      .eq("id", entity.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Mark own notifications as read — RLS scopes rows to the caller's account. */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => notificationIdsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Cancel a scheduled downgrade ("Keep current plan"): releases the Stripe
 * subscription schedule and clears the pending fields on the store. Free —
 * the client simply stays on the plan they already have.
 */
export const cancelPendingPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => storeStripeEnvSchema.parse(input))
  .handler(async ({ data, context }): Promise<Result<{ ok: true }>> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const { getAdminClient } = await import("./admin.server");
      const stripe = createStripeClient(data.environment);
      const admin = await getAdminClient();

      const { store } = await resolveStoreAndEntity(admin, data.storeId, context.userId);
      if (!store.pending_plan_change) {
        throw new Error("No pending plan change to cancel");
      }
      if (!store.stripe_subscription_id) throw new Error("No subscription found");

      const sub = await stripe.subscriptions.retrieve(store.stripe_subscription_id, {
        expand: ["schedule"],
      });
      const scheduleRef = (
        sub as unknown as { schedule?: string | { id: string } | null }
      ).schedule;
      const scheduleId =
        typeof scheduleRef === "string" ? scheduleRef : scheduleRef?.id;
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(scheduleId);
      }

      const { error } = await admin
        .from("stores")
        .update({ pending_plan_change: null, pending_plan_change_date: null })
        .eq("id", store.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });
