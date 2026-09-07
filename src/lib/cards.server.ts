import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type EntityRow = Database["public"]["Tables"]["entities"]["Row"];

export type CardSummary = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

/** Card details we persist on the entity so reads never need a Stripe call. */
export function cardSummary(pm: Stripe.PaymentMethod): CardSummary | null {
  if (!pm.card) return null;
  return {
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
  };
}

export function entityCard(entity: {
  default_payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
}): CardSummary | null {
  if (!entity.default_payment_method_id || !entity.card_brand || !entity.card_last4) {
    return null;
  }
  return {
    brand: entity.card_brand,
    last4: entity.card_last4,
    expMonth: entity.card_exp_month ?? 0,
    expYear: entity.card_exp_year ?? 0,
  };
}

/**
 * Resolve the entity that owns the wallet for this caller, from either the
 * current workspace or an explicit entity id. Always scoped to the caller's
 * own account — never trust the id from the browser on its own.
 */
export async function resolveEntityForCaller(
  admin: Admin,
  accountId: string,
  args: { storeId?: string | undefined; entityId?: string | undefined },
): Promise<EntityRow> {
  if (args.storeId) {
    const { data, error } = await admin
      .from("stores")
      .select("entities!inner(*)")
      .eq("id", args.storeId)
      .eq("entities.account_id", accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.entities) throw new Error("Workspace not found for your account");
    return data.entities as EntityRow;
  }
  if (args.entityId) {
    const { data, error } = await admin
      .from("entities")
      .select("*")
      .eq("id", args.entityId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Entity not found for this account");
    return data;
  }
  const { data, error } = await admin
    .from("entities")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Complete your account profile first");
  return data;
}

/** Reject new money-in while the account or entity is suspended. */
export async function assertNotSuspended(
  admin: Admin,
  entity: EntityRow,
  accountId: string,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("status")
    .eq("id", accountId)
    .maybeSingle();
  if (entity.status === "suspended" || profile?.status === "suspended") {
    throw new Error(
      "This account is suspended — card payments are disabled. Contact your account manager.",
    );
  }
}

/**
 * ONE saved card per entity. Attaches the new PaymentMethod, makes it the
 * customer's invoice default, persists brand/last4/expiry on the entity and
 * detaches the previous card in Stripe — in that order, so a failure never
 * leaves the entity without a usable card.
 */
export async function saveCardOnEntity(
  stripe: Stripe,
  admin: Admin,
  args: {
    entity: EntityRow;
    customerId: string;
    paymentMethodId: string;
  },
): Promise<CardSummary | null> {
  const { entity, customerId, paymentMethodId } = args;

  let pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (!pm.customer) {
    pm = await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  } else if (typeof pm.customer === "string" && pm.customer !== customerId) {
    throw new Error("This card belongs to another customer");
  }

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const summary = cardSummary(pm);
  const { error } = await admin
    .from("entities")
    .update({
      stripe_customer_id: customerId,
      default_payment_method_id: paymentMethodId,
      card_brand: summary?.brand ?? null,
      card_last4: summary?.last4 ?? null,
      card_exp_month: summary?.expMonth ?? null,
      card_exp_year: summary?.expYear ?? null,
    })
    .eq("id", entity.id);
  if (error) throw new Error(error.message);

  // Replace: the old card is detached only after the new one is stored.
  const previous = entity.default_payment_method_id;
  if (previous && previous !== paymentMethodId) {
    try {
      await stripe.paymentMethods.detach(previous);
    } catch (e) {
      console.error("detach of replaced card failed:", previous, e);
    }
  }
  return summary;
}

/** Clear the saved card from the entity (and Stripe). */
export async function clearCardOnEntity(
  stripe: Stripe,
  admin: Admin,
  entity: EntityRow,
  opts: { disableAutoTopup: boolean },
): Promise<void> {
  if (entity.default_payment_method_id) {
    try {
      await stripe.paymentMethods.detach(entity.default_payment_method_id);
    } catch (e) {
      console.error("detach of removed card failed:", e);
    }
  }
  const patch: Database["public"]["Tables"]["entities"]["Update"] = {
    default_payment_method_id: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
  };
  if (opts.disableAutoTopup) {
    patch.auto_topup_enabled = false;
    patch.auto_topup_threshold = null;
    patch.auto_topup_amount = null;
  }
  const { error } = await admin.from("entities").update(patch).eq("id", entity.id);
  if (error) throw new Error(error.message);
}

/**
 * Credit a succeeded top-up PaymentIntent to the wallet through the EXISTING
 * idempotent path (reference = payment intent id), so the webhook replay of
 * the same intent is a no-op. `release` mirrors the webhook behaviour of
 * settling awaiting_payment orders oldest-first; the cover-the-difference
 * flow turns it OFF because it pays a specific selection right after.
 */
export async function applyTopupCredit(
  admin: Admin,
  args: {
    entityId: string;
    paymentIntentId: string;
    amountUsd: number;
    description: string;
    release: boolean;
  },
): Promise<{ credited: boolean }> {
  const billing = await import("./billing.server");
  const creditTxn = await billing.creditWalletOnce(admin, {
    entityId: args.entityId,
    amountUsd: args.amountUsd,
    reference: args.paymentIntentId,
    description: args.description,
  });
  if (!creditTxn) return { credited: false };

  try {
    const { issueWalletTopupReceipt } = await import("./documents.server");
    await issueWalletTopupReceipt(admin, creditTxn.id);
  } catch (e) {
    console.error("wallet top-up receipt failed:", creditTxn.id, e);
  }

  if (args.release) {
    const { data: releasedRows, error } = await admin.rpc("release_awaiting_payment_orders", {
      p_entity_id: args.entityId,
    });
    if (error) console.error("release_awaiting_payment_orders failed:", error.message);
    const released = (releasedRows ?? []) as Array<{ order_id: string }>;
    if (released.length > 0) {
      const { issueOrderReceipt } = await import("./documents.server");
      for (const o of released) {
        try {
          await issueOrderReceipt(admin, o.order_id);
        } catch (e) {
          console.error("order receipt failed:", o.order_id, e);
        }
      }
      const { releaseAfterPayment } = await import("./middleware.server");
      await releaseAfterPayment(
        admin,
        released.map((o) => o.order_id),
      );
    }
  }
  return { credited: true };
}

/** Stable, short idempotency key for a card charge attempt. */
export async function idempotencyKey(prefix: string, parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${hex.slice(0, 40)}`;
}

/** Round money to cents the same way the ledger does. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
