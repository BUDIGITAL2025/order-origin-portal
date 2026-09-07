import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeEnvSchema } from "./schemas";

type Result<T> = T | { error: string };

async function stripeErrorText(error: unknown): Promise<string> {
  const { getStripeErrorMessage } = await import("./stripe.server");
  return getStripeErrorMessage(error);
}

/** A PaymentIntent that needs 3-D Secure surfaces this shape to the browser. */
function requiresActionPayload(
  error: unknown,
): { paymentIntentId: string; clientSecret: string } | null {
  const raw = error as {
    code?: string;
    payment_intent?: { id?: string; client_secret?: string; status?: string };
    raw?: {
      code?: string;
      payment_intent?: { id?: string; client_secret?: string; status?: string };
    };
  };
  const pi = raw?.payment_intent ?? raw?.raw?.payment_intent;
  const code = raw?.code ?? raw?.raw?.code;
  if (
    pi?.id &&
    pi.client_secret &&
    (code === "authentication_required" || pi.status === "requires_action")
  ) {
    return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
  }
  return null;
}

const walletScopeSchema = z.object({
  storeId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
});
const cardScopeSchema = walletScopeSchema.extend({ environment: stripeEnvSchema });

/**
 * The saved card + auto top-up state for the caller's wallet. Reads the
 * entity columns only (no Stripe round-trip) — brand/last4/expiry are kept
 * in sync every time a card is saved.
 */
export const getMyPaymentMethod = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => walletScopeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { resolveEntityForCaller, entityCard } = await import("./cards.server");
    const admin = await getAdminClient();
    const entity = await resolveEntityForCaller(admin, context.userId, data);
    return {
      entityId: entity.id,
      card: entityCard(entity),
      autoTopup: {
        enabled: entity.auto_topup_enabled,
        threshold: entity.auto_topup_threshold,
        amount: entity.auto_topup_amount,
      },
    };
  });

/**
 * Start "add card" / "replace card": a Stripe SetupIntent for off-session
 * use. The browser confirms it with Stripe Elements — card numbers never
 * reach our servers.
 */
export const createCardSetupIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => cardScopeSchema.parse(input))
  .handler(async ({ data, context }): Promise<Result<{ clientSecret: string }>> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const { getAdminClient } = await import("./admin.server");
      const billing = await import("./billing.server");
      const { resolveEntityForCaller, assertNotSuspended } = await import("./cards.server");
      const admin = await getAdminClient();
      const stripe = createStripeClient(data.environment);
      const entity = await resolveEntityForCaller(admin, context.userId, data);
      await assertNotSuspended(admin, entity, context.userId);

      const email = (context.claims?.email as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        ...(email ? { email } : {}),
        userId: context.userId,
        existingCustomerId: entity.stripe_customer_id,
      });
      if (entity.stripe_customer_id !== customerId) {
        await admin.from("entities").update({ stripe_customer_id: customerId }).eq("id", entity.id);
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { flysales_entity_id: entity.id, kind: "save_card" },
      });
      if (!setupIntent.client_secret) {
        throw new Error("Stripe did not return a client secret");
      }
      return { clientSecret: setupIntent.client_secret };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

/**
 * Finish "add card" / "replace card" after the browser confirmed the
 * SetupIntent: store the new card as the entity's single saved card and
 * detach the previous one in Stripe.
 */
export const confirmSavedCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    cardScopeSchema.extend({ setupIntentId: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const { getAdminClient } = await import("./admin.server");
      const { resolveEntityForCaller, saveCardOnEntity } = await import("./cards.server");
      const admin = await getAdminClient();
      const stripe = createStripeClient(data.environment);
      const entity = await resolveEntityForCaller(admin, context.userId, data);

      const si = await stripe.setupIntents.retrieve(data.setupIntentId);
      if (si.metadata?.["flysales_entity_id"] !== entity.id) {
        throw new Error("This setup does not belong to your account");
      }
      if (si.status !== "succeeded") {
        throw new Error("The card was not confirmed — try again.");
      }
      const pmId =
        typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
      const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
      if (!pmId || !customerId) throw new Error("Stripe returned no payment method");

      const card = await saveCardOnEntity(stripe, admin, {
        entity,
        customerId,
        paymentMethodId: pmId,
      });
      return { card };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

/** Remove the saved card. Auto top-up is switched off in the same write. */
export const removeSavedCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => cardScopeSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const { getAdminClient } = await import("./admin.server");
      const { resolveEntityForCaller, clearCardOnEntity } = await import("./cards.server");
      const admin = await getAdminClient();
      const stripe = createStripeClient(data.environment);
      const entity = await resolveEntityForCaller(admin, context.userId, data);
      await clearCardOnEntity(stripe, admin, entity, { disableAutoTopup: true });
      return { ok: true, autoTopupWasOn: entity.auto_topup_enabled };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

const chargeTopupSchema = cardScopeSchema.extend({
  amountUsd: z.number().min(1).max(100_000),
});

type ChargeOutcome =
  | { status: "succeeded"; amountUsd: number }
  | { status: "requires_action"; clientSecret: string; paymentIntentId: string }
  | { error: string };

/**
 * Fast top-up: charge the saved card off-session and credit the wallet
 * through the existing idempotent top-up path (reference = payment intent
 * id), so the webhook replay never credits twice.
 */
export const chargeSavedCardTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => chargeTopupSchema.parse(input))
  .handler(async ({ data, context }): Promise<ChargeOutcome> => {
    const { createStripeClient } = await import("./stripe.server");
    const { getAdminClient } = await import("./admin.server");
    const cards = await import("./cards.server");
    const admin = await getAdminClient();
    const stripe = createStripeClient(data.environment);
    const entity = await cards.resolveEntityForCaller(admin, context.userId, data);

    try {
      await cards.assertNotSuspended(admin, entity, context.userId);
      if (!entity.stripe_customer_id || !entity.default_payment_method_id) {
        throw new Error("No saved card — add one first.");
      }
      const amount = cards.round2(data.amountUsd);
      const key = await cards.idempotencyKey("flysales-fast-topup", [
        entity.id,
        String(Math.round(amount * 100)),
        new Date().toISOString().slice(0, 16),
      ]);
      const pi = await stripe.paymentIntents.create(
        {
          amount: Math.round(amount * 100),
          currency: "usd",
          customer: entity.stripe_customer_id,
          payment_method: entity.default_payment_method_id,
          off_session: true,
          confirm: true,
          description: "FlySales wallet top-up",
          metadata: {
            kind: "wallet_topup",
            flysales_entity_id: entity.id,
            flysales_user_id: context.userId,
            amount_usd: String(amount),
          },
        },
        { idempotencyKey: key },
      );
      if (pi.status !== "succeeded") {
        throw new Error(`The card charge did not complete (${pi.status}).`);
      }
      await cards.applyTopupCredit(admin, {
        entityId: entity.id,
        paymentIntentId: pi.id,
        amountUsd: pi.amount_received / 100,
        description: "Wallet top-up (saved card)",
        release: true,
      });
      return { status: "succeeded", amountUsd: pi.amount_received / 100 };
    } catch (error) {
      const action = requiresActionPayload(error);
      if (action) return { status: "requires_action", ...action };
      return { error: await stripeErrorText(error) };
    }
  });

/**
 * Finish a top-up that needed 3-D Secure: the browser authenticated the
 * PaymentIntent, we verify it succeeded and credit through the same
 * idempotent path.
 */
export const finalizeCardTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    cardScopeSchema.extend({ paymentIntentId: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const { getAdminClient } = await import("./admin.server");
      const cards = await import("./cards.server");
      const admin = await getAdminClient();
      const stripe = createStripeClient(data.environment);
      const entity = await cards.resolveEntityForCaller(admin, context.userId, data);

      const pi = await stripe.paymentIntents.retrieve(data.paymentIntentId);
      if (pi.metadata?.["flysales_entity_id"] !== entity.id) {
        throw new Error("This payment does not belong to your account");
      }
      if (pi.status !== "succeeded") {
        throw new Error("The card payment was not completed.");
      }
      await cards.applyTopupCredit(admin, {
        entityId: entity.id,
        paymentIntentId: pi.id,
        amountUsd: pi.amount_received / 100,
        description: "Wallet top-up (saved card)",
        release: true,
      });
      return { status: "succeeded" as const, amountUsd: pi.amount_received / 100 };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

// ===================== Cover the difference =====================

const coverPaySchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
  environment: stripeEnvSchema,
});

type CoverOutcome =
  | { status: "paid"; settled: Array<{ order_id: string; amount: number }>; charged: number }
  | { status: "requires_action"; clientSecret: string; paymentIntentId: string }
  | { error: string };

/**
 * Settle the selected awaiting_payment orders from the wallet and issue the
 * receipts / middleware release, exactly like payOrdersFromWallet.
 */
async function settleFromWallet(
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  },
  orderIds: string[],
): Promise<Array<{ order_id: string; amount: number }>> {
  const { data: settled, error } = await supabase.rpc("pay_orders_from_wallet", {
    p_order_ids: orderIds,
  });
  if (error) throw new Error(error.message);
  const rows = (settled ?? []) as Array<{ order_id: string; amount: number }>;
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
    const { releaseAfterPayment } = await import("./middleware.server");
    await releaseAfterPayment(
      admin,
      rows.map((r) => r.order_id),
    );
  }
  return rows;
}

/**
 * Cover the difference: when the wallet does not cover the selected orders
 * and a card is on file, charge the card for the EXACT shortfall, credit it
 * to the wallet as a normal top-up, then pay the orders from the wallet.
 * The card always funds the wallet; the wallet always pays the order.
 */
export const payOrdersWithCardShortfall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => coverPaySchema.parse(input))
  .handler(async ({ data, context }): Promise<CoverOutcome> => {
    const { createStripeClient } = await import("./stripe.server");
    const { getAdminClient } = await import("./admin.server");
    const billing = await import("./billing.server");
    const cards = await import("./cards.server");
    const admin = await getAdminClient();

    try {
      // RLS scopes this read to the caller's own workspaces.
      const { data: rows, error } = await context.supabase
        .from("orders")
        .select("id, total_amount, stores!inner(entity_id)")
        .in("id", data.orderIds)
        .eq("status", "awaiting_payment");
      if (error) throw new Error(error.message);
      const orders = (rows ?? []) as unknown as Array<{
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

      const entity = await cards.resolveEntityForCaller(admin, context.userId, {
        entityId,
      });
      await cards.assertNotSuspended(admin, entity, context.userId);

      const total = cards.round2(orders.reduce((acc, o) => acc + Number(o.total_amount ?? 0), 0));
      const balance = await billing.getWalletBalance(admin, entityId);
      const shortfall = cards.round2(total - balance);

      let charged = 0;
      if (shortfall > 0) {
        if (!entity.stripe_customer_id || !entity.default_payment_method_id) {
          throw new Error(
            "Your wallet does not cover these orders and no card is saved. Top up first.",
          );
        }
        const key = await cards.idempotencyKey("flysales-cover", [
          entityId,
          [...orders.map((o) => o.id)].sort().join(","),
          String(Math.round(shortfall * 100)),
        ]);
        const pi = await createStripeClient(data.environment).paymentIntents.create(
          {
            amount: Math.round(shortfall * 100),
            currency: "usd",
            customer: entity.stripe_customer_id,
            payment_method: entity.default_payment_method_id,
            off_session: true,
            confirm: true,
            description: "FlySales wallet top-up (order payment)",
            metadata: {
              kind: "wallet_topup_cover",
              flysales_entity_id: entityId,
              flysales_user_id: context.userId,
              amount_usd: String(shortfall),
              flysales_order_ids: [...orders.map((o) => o.id)].sort().join(",").slice(0, 480),
            },
          },
          { idempotencyKey: key },
        );
        if (pi.status !== "succeeded") {
          throw new Error(`The card charge did not complete (${pi.status}).`);
        }
        await cards.applyTopupCredit(admin, {
          entityId,
          paymentIntentId: pi.id,
          amountUsd: pi.amount_received / 100,
          description: "Wallet top-up to cover order payment",
          release: false,
        });
        charged = pi.amount_received / 100;
      }

      const settled = await settleFromWallet(
        context.supabase as never,
        orders.map((o) => o.id),
      );
      return { status: "paid", settled, charged };
    } catch (error) {
      const action = requiresActionPayload(error);
      if (action) return { status: "requires_action", ...action };
      return { error: await stripeErrorText(error) };
    }
  });

/**
 * Finish a cover-the-difference payment that needed 3-D Secure: verify the
 * PaymentIntent succeeded, credit the wallet, then pay the orders.
 */
export const finalizeCoverPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    coverPaySchema.extend({ paymentIntentId: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CoverOutcome> => {
    try {
      const { createStripeClient } = await import("./stripe.server");
      const { getAdminClient } = await import("./admin.server");
      const cards = await import("./cards.server");
      const admin = await getAdminClient();
      const client = createStripeClient(data.environment);

      const pi = await client.paymentIntents.retrieve(data.paymentIntentId);
      const entityId = pi.metadata?.["flysales_entity_id"];
      if (!entityId) throw new Error("This payment is not a FlySales top-up");
      // Ownership check: the entity must belong to the caller's account.
      await cards.resolveEntityForCaller(admin, context.userId, { entityId });
      if (pi.status !== "succeeded") {
        throw new Error("The card payment was not completed.");
      }
      await cards.applyTopupCredit(admin, {
        entityId,
        paymentIntentId: pi.id,
        amountUsd: pi.amount_received / 100,
        description: "Wallet top-up to cover order payment",
        release: false,
      });
      const settled = await settleFromWallet(context.supabase as never, data.orderIds);
      return { status: "paid", settled, charged: pi.amount_received / 100 };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });
