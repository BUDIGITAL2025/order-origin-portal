/**
 * Stock purchases — server functions.
 *
 * Clients buy stock against an accepted quote line and pay from the wallet
 * (cover-the-difference applies). Admins quote freight and import on both paths
 * and advance the timeline. The card always funds the wallet; the wallet
 * always pays the purchase.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createStockPurchaseSchema,
  finalizeStockPurchaseSchema,
  freightQuoteSchema,
  payStockPurchaseSchema,
  purchaseStatusSchema,
  stockPurchaseIdSchema,
} from "./schemas";

const uuid = z.string().uuid();

export type PayOutcome =
  | { status: "paid"; charged: number; total: number }
  | { status: "requires_action"; clientSecret: string; paymentIntentId: string }
  | { error: string };

async function stripeErrorText(error: unknown): Promise<string> {
  const { getStripeErrorMessage } = await import("./stripe.server");
  return getStripeErrorMessage(error);
}

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

// ===================== Client =====================

/**
 * Accepted quote variants the client can order stock against, with the
 * client-facing price only (never the chain behind it).
 */
export const listOrderableLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();

    // Ownership: the workspace must belong to the caller's account.
    const { data: store } = await context.supabase
      .from("stores")
      .select("id")
      .eq("id", data.storeId)
      .maybeSingle();
    if (!store) throw new Error("Workspace not found");

    const { data: quotes } = await admin
      .from("quote_requests")
      .select("id, product_name, product_url")
      .eq("store_id", data.storeId);
    const quoteIds = (quotes ?? []).map((q) => q.id);
    if (quoteIds.length === 0) return [];
    const quoteById = new Map((quotes ?? []).map((q) => [q.id, q]));

    const { data: lines, error } = await admin
      .from("quote_lines")
      .select(
        "id, quote_request_id, variant_label, country_code, sku, unit_price, moq, production_lead_days, lead_time_days, status",
      )
      .in("quote_request_id", quoteIds)
      .eq("status", "accepted")
      .not("unit_price", "is", null);
    if (error) throw new Error(error.message);

    const lineIds = (lines ?? []).map((l) => l.id);
    const { data: products } = lineIds.length
      ? await admin
          .from("products")
          .select("id, quote_line_id, product_name, fulfilment_model, sku")
          .in("quote_line_id", lineIds)
      : { data: [] };
    const productByLine = new Map((products ?? []).map((p) => [p.quote_line_id, p]));

    return (lines ?? []).map((l) => {
      const product = productByLine.get(l.id) ?? null;
      const quote = quoteById.get(l.quote_request_id);
      return {
        line_id: l.id,
        quote_id: l.quote_request_id,
        product_id: product?.id ?? null,
        product_name: product?.product_name ?? quote?.product_name ?? "Product",
        variant_label: l.variant_label,
        country_code: l.country_code,
        sku: product?.sku ?? l.sku,
        unit_price: Number(l.unit_price),
        moq: l.moq ?? 1,
        production_lead_days: l.production_lead_days ?? l.lead_time_days ?? null,
        fulfilment_model: product?.fulfilment_model ?? null,
      };
    });
  });

/** The client's stock purchases for one workspace, newest first. */
export const listMyStockPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS scopes stock_purchases to workspaces the caller owns.
    const { data: rows, error } = await context.supabase
      .from("stock_purchases")
      .select("*, products(image_urls)")
      .eq("store_id", data.storeId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const { purchaseRef, purchaseTotal, publicPurchaseStatus } = await import("./purchases.server");
    return (rows ?? []).map((p) => ({
      ...p,
      // Internal purchase-order steps are never exposed to the client.
      status: publicPurchaseStatus(p.status),
      ref: purchaseRef(p.id),
      payable_total: purchaseTotal(p),
    }));
  });

/** Order stock against an accepted quote variant. */
export const createStockPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createStockPurchaseSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { round2 } = await import("./admin.server");
    const { WAREHOUSE_MIN_UNITS } = await import("./sourcing.server");
    const admin = await getAdminClient();

    const { data: line, error } = await admin
      .from("quote_lines")
      .select(
        "id, quote_request_id, variant_label, sku, unit_price, moq, status, supplier_unit_price, sourcing_fee_rate, sourced_by",
      )
      .eq("id", data.quote_line_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!line) throw new Error("Quote variant not found");
    if (line.status !== "accepted") throw new Error("Accept this quote variant first");
    if (line.unit_price == null) throw new Error("This variant has no published price yet");

    const { data: quote } = await admin
      .from("quote_requests")
      .select("id, store_id, product_name, stores!inner(id, entity_id, entities!inner(account_id))")
      .eq("id", line.quote_request_id)
      .maybeSingle();
    const chain = quote as unknown as {
      id: string;
      store_id: string;
      product_name: string | null;
      stores: { entity_id: string; entities: { account_id: string } };
    } | null;
    if (!chain || chain.stores.entities.account_id !== context.userId) {
      throw new Error("Quote request not found");
    }

    const moq = line.moq ?? 1;
    const minimum = data.path === "flysales" ? Math.max(moq, WAREHOUSE_MIN_UNITS) : moq;
    if (data.quantity < minimum) {
      throw new Error(`Minimum order for this option is ${minimum} units.`);
    }
    if (data.path === "direct" && !data.delivery_address) {
      throw new Error("Add the delivery address for a direct shipment.");
    }

    const { data: product } = await admin
      .from("products")
      .select("id, product_name, sku")
      .eq("quote_line_id", line.id)
      .maybeSingle();

    const unitPrice = Number(line.unit_price);
    const goodsTotal = round2(unitPrice * data.quantity);

    const { data: created, error: insertError } = await admin
      .from("stock_purchases")
      .insert({
        store_id: chain.store_id,
        entity_id: chain.stores.entity_id,
        quote_request_id: chain.id,
        quote_line_id: line.id,
        product_id: product?.id ?? null,
        path: data.path,
        status: "requested",
        product_name: product?.product_name ?? chain.product_name ?? "Product",
        variant_label: line.variant_label,
        sku: product?.sku ?? line.sku,
        quantity: data.quantity,
        unit_price: unitPrice,
        goods_total: goodsTotal,
        // Goods are Ex Works on both paths: the payable total only exists once
        // freight and import have been quoted.
        total_amount: null,
        delivery_address: data.path === "direct" ? (data.delivery_address ?? null) : null,
        supplier_unit_price: line.supplier_unit_price,
        sourcing_fee_rate: line.sourcing_fee_rate,
        sourced_by: line.sourced_by,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);

    const { purchaseRef } = await import("./purchases.server");
    return { ok: true, purchase: { ...created, ref: purchaseRef(created.id) } };
  });

/**
 * Pay a purchase from the wallet. When the balance falls short and a card is
 * on file, charge the card for the exact shortfall, credit it to the wallet
 * as a normal top-up, then debit the wallet for the purchase.
 */
export const payStockPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => payStockPurchaseSchema.parse(input))
  .handler(async ({ data, context }): Promise<PayOutcome> => {
    const { getAdminClient } = await import("./admin.server");
    const billing = await import("./billing.server");
    const cards = await import("./cards.server");
    const purchases = await import("./purchases.server");
    const admin = await getAdminClient();

    try {
      // RLS scopes this read to the caller's own workspaces.
      const { data: row, error } = await context.supabase
        .from("stock_purchases")
        .select("*")
        .eq("id", data.purchase_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Stock purchase not found");
      if (row.status === "paid" || row.paid_at) {
        return { status: "paid", charged: 0, total: Number(row.total_amount ?? 0) };
      }
      if (!purchases.isPayable(row)) {
        throw new Error("This purchase is not ready to pay yet.");
      }
      const total = purchases.purchaseTotal(row)!;

      const entity = await cards.resolveEntityForCaller(admin, context.userId, {
        entityId: row.entity_id,
      });
      await cards.assertNotSuspended(admin, entity, context.userId);

      const balance = await billing.getWalletBalance(admin, row.entity_id);
      const shortfall = cards.round2(total - balance);

      let charged = 0;
      if (shortfall > 0) {
        if (!entity.stripe_customer_id || !entity.default_payment_method_id) {
          throw new Error(
            "Your wallet does not cover this purchase and no card is saved. Top up first.",
          );
        }
        const { createStripeClient } = await import("./stripe.server");
        const key = await cards.idempotencyKey("flysales-purchase", [
          row.id,
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
            description: "FlySales wallet top-up (stock purchase)",
            metadata: {
              kind: "wallet_topup_cover",
              flysales_entity_id: row.entity_id,
              flysales_user_id: context.userId,
              flysales_purchase_id: row.id,
              amount_usd: String(shortfall),
            },
          },
          { idempotencyKey: key },
        );
        if (pi.status !== "succeeded") {
          throw new Error(`The card charge did not complete (${pi.status}).`);
        }
        await cards.applyTopupCredit(admin, {
          entityId: row.entity_id,
          paymentIntentId: pi.id,
          amountUsd: pi.amount_received / 100,
          description: "Wallet top-up to cover a stock purchase",
          release: false,
        });
        charged = pi.amount_received / 100;
      }

      await billing.debitWalletOnce(admin, {
        entityId: row.entity_id,
        amountUsd: total,
        reference: purchases.purchaseWalletReference(row.id),
        description: `Stock purchase ${purchases.purchaseRef(row.id)}`,
      });
      await purchases.settlePaidPurchase(admin, row.id, total);
      return { status: "paid", charged, total };
    } catch (error) {
      const action = requiresActionPayload(error);
      if (action) return { status: "requires_action", ...action };
      return { error: await stripeErrorText(error) };
    }
  });

/** Finish a purchase payment that needed 3-D Secure. */
export const finalizeStockPurchasePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => finalizeStockPurchaseSchema.parse(input))
  .handler(async ({ data, context }): Promise<PayOutcome> => {
    try {
      const { getAdminClient } = await import("./admin.server");
      const billing = await import("./billing.server");
      const cards = await import("./cards.server");
      const purchases = await import("./purchases.server");
      const { createStripeClient } = await import("./stripe.server");
      const admin = await getAdminClient();

      const { data: row } = await context.supabase
        .from("stock_purchases")
        .select("*")
        .eq("id", data.purchase_id)
        .maybeSingle();
      if (!row) throw new Error("Stock purchase not found");
      const total = purchases.purchaseTotal(row);
      if (total == null) throw new Error("This purchase is not ready to pay yet.");

      const pi = await createStripeClient(data.environment).paymentIntents.retrieve(
        data.paymentIntentId,
      );
      if (pi.metadata?.["flysales_entity_id"] !== row.entity_id) {
        throw new Error("This payment does not belong to your account");
      }
      if (pi.status !== "succeeded") throw new Error("The card payment was not completed.");

      await cards.applyTopupCredit(admin, {
        entityId: row.entity_id,
        paymentIntentId: pi.id,
        amountUsd: pi.amount_received / 100,
        description: "Wallet top-up to cover a stock purchase",
        release: false,
      });
      await billing.debitWalletOnce(admin, {
        entityId: row.entity_id,
        amountUsd: total,
        reference: purchases.purchaseWalletReference(row.id),
        description: `Stock purchase ${purchases.purchaseRef(row.id)}`,
      });
      await purchases.settlePaidPurchase(admin, row.id, total);
      return { status: "paid", charged: pi.amount_received / 100, total };
    } catch (error) {
      return { error: await stripeErrorText(error) };
    }
  });

// ===================== Admin =====================

export const adminListStockPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z
          .enum([
            "requested",
            "freight_quoted",
            "paid",
            "in_production",
            "shipped",
            "delivered",
            "cancelled",
          ])
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    let query = admin
      .from("stock_purchases")
      .select("*, products(image_urls), stores(store_name, entities(legal_name))")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const { purchaseRef, purchaseTotal } = await import("./purchases.server");
    return (rows ?? []).map((p) => {
      const chain = p as typeof p & {
        stores?: { store_name: string | null; entities?: { legal_name: string | null } | null };
      };
      return {
        ...p,
        ref: purchaseRef(p.id),
        payable_total: purchaseTotal(p),
        client_name: chain.stores?.entities?.legal_name ?? null,
        workspace_name: chain.stores?.store_name ?? null,
      };
    });
  });

/** Both paths: quote freight and import so the client can pay the full total. */
export const adminQuoteFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => freightQuoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { round2 } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: row } = await admin
      .from("stock_purchases")
      .select("id, goods_total, status")
      .eq("id", data.purchase_id)
      .maybeSingle();
    if (!row) throw new Error("Stock purchase not found");
    if (row.status !== "requested" && row.status !== "freight_quoted") {
      throw new Error("This purchase is already paid");
    }

    const { error } = await admin
      .from("stock_purchases")
      .update({
        freight_cost: data.freight_cost,
        import_cost: data.import_cost,
        total_amount: round2(Number(row.goods_total) + data.freight_cost + data.import_cost),
        status: "freight_quoted",
        freight_quoted_at: new Date().toISOString(),
      })
      .eq("id", data.purchase_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Advance the timeline and record tracking. */
export const adminAdvancePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => purchaseStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const now = new Date().toISOString();
    const stamps: Record<string, string> = {
      in_production: "in_production_at",
      shipped: "shipped_at",
      delivered: "delivered_at",
    };
    const stampColumn = stamps[data.status];
    const { error } = await admin
      .from("stock_purchases")
      .update({
        status: data.status,
        ...(stampColumn ? { [stampColumn]: now } : {}),
        ...(data.tracking_number ? { tracking_number: data.tracking_number } : {}),
        ...(data.tracking_carrier ? { tracking_carrier: data.tracking_carrier } : {}),
      })
      .eq("id", data.purchase_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: one purchase in full, for the detail drawer. */
export const adminGetStockPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => stockPurchaseIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: row, error } = await admin
      .from("stock_purchases")
      .select("*, stores(store_name, entities(legal_name))")
      .eq("id", data.purchase_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Stock purchase not found");
    const { purchaseRef, purchaseTotal } = await import("./purchases.server");
    return { ...row, ref: purchaseRef(row.id), payable_total: purchaseTotal(row) };
  });
