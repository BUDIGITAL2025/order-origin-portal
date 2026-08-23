import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adminDisputeFilterSchema,
  disputeIdSchema,
  disputeMessageSchema,
  openDisputeSchema,
  resolveDisputeSchema,
} from "./schemas";

const DISPUTE_BUCKET = "dispute-evidence";

/** Sign evidence photo paths so only this viewer gets temporary URLs. */
async function signEvidence(paths: string[]): Promise<Array<{ path: string; url: string }>> {
  if (paths.length === 0) return [];
  const { getAdminClient } = await import("./admin.server");
  const admin = await getAdminClient();
  const { data } = await admin.storage.from(DISPUTE_BUCKET).createSignedUrls(paths, 600);
  return paths.map((path, i) => ({ path, url: data?.[i]?.signedUrl ?? "" }));
}

// ============= Client =============

/** Client: my disputes, newest first. RLS scopes to own stores. */
export const listMyDisputes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("disputes")
      .select(
        "id, order_id, reason, description, status, resolution, credit_amount, resolved_at, created_at, orders(external_order_number, status, total_amount)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Client: one dispute with its message thread and signed evidence URLs. */
export const getMyDispute = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => disputeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: dispute, error } = await context.supabase
      .from("disputes")
      .select(
        "id, order_id, reason, description, evidence_urls, status, resolution, credit_amount, resolved_at, created_at, orders(external_order_number, status, total_amount, destination_country)",
      )
      .eq("id", data.dispute_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!dispute) throw new Error("Dispute not found");
    const { data: messages, error: msgError } = await context.supabase
      .from("dispute_messages")
      .select("id, author_role, body, created_at")
      .eq("dispute_id", dispute.id)
      .order("created_at", { ascending: true });
    if (msgError) throw new Error(msgError.message);
    const evidence = await signEvidence((dispute.evidence_urls ?? []) as string[]);
    return { dispute, messages: messages ?? [], evidence };
  });

/** Client: open a dispute. All eligibility rules are enforced in the database. */
export const openDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => openDisputeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: disputeId, error } = await context.supabase.rpc("open_dispute", {
      p_order_id: data.order_id,
      p_reason: data.reason,
      p_description: data.description,
      p_evidence_urls: data.evidence_urls ?? [],
    });
    if (error) throw new Error(error.message);
    const row = disputeId as unknown as { id: string } | null;
    if (!row?.id) throw new Error("Dispute was not created");
    return { dispute_id: row.id };
  });

/** Client/admin: post a message on a dispute thread (access checked in the DB). */
export const postDisputeMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => disputeMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("post_dispute_message", {
      p_dispute_id: data.dispute_id,
      p_body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Admin =============

/** Admin: the disputes queue, oldest first, optionally filtered by status. */
export const adminListDisputes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminDisputeFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("disputes")
      .select(
        "id, order_id, reason, description, status, resolution, credit_amount, resolved_at, created_at, orders(external_order_number, status, total_amount, destination_country), stores(store_name, entities(legal_name))",
      )
      .order("created_at", { ascending: true });
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query.limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Admin: full dispute detail including internal notes and order SKUs. */
export const adminGetDispute = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => disputeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { data: dispute, error } = await context.supabase
      .from("disputes")
      .select(
        "id, order_id, store_id, reason, description, evidence_urls, status, resolution, credit_amount, resolved_at, created_at, orders(external_order_number, status, total_amount, destination_country, paid_at, shipped_at, delivered_at, order_items(sku, quantity, unit_price, line_total))",
      )
      .eq("id", data.dispute_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!dispute) throw new Error("Dispute not found");
    const { data: messages, error: msgError } = await context.supabase
      .from("dispute_messages")
      .select("id, author_role, body, created_at")
      .eq("dispute_id", dispute.id)
      .order("created_at", { ascending: true });
    if (msgError) throw new Error(msgError.message);
    // Internal notes live in an admin-only table (RLS: has_role admin).
    const { data: internal, error: internalError } = await context.supabase
      .from("dispute_internal_notes")
      .select("admin_notes")
      .eq("dispute_id", dispute.id)
      .maybeSingle();
    if (internalError) throw new Error(internalError.message);
    const evidence = await signEvidence((dispute.evidence_urls ?? []) as string[]);
    return {
      dispute: { ...dispute, admin_notes: internal?.admin_notes ?? null },
      messages: messages ?? [],
      evidence,
    };
  });

/** Admin: mark a dispute as under investigation. */
export const adminMarkInvestigating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => disputeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("disputes")
      .update({ status: "investigating" })
      .eq("id", data.dispute_id)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: resolve a dispute. The database function enforces the rules
 * (wallet_credit requires an amount, rejected requires a client-facing
 * reason) and credits the entity wallet with the dispute id as the
 * idempotency reference — a credit can never land twice.
 */
export const adminResolveDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => resolveDisputeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.rpc("resolve_dispute", {
      p_dispute_id: data.dispute_id,
      p_resolution: data.resolution,
      ...(data.credit_amount != null ? { p_credit_amount: data.credit_amount } : {}),
      ...(data.admin_notes ? { p_admin_notes: data.admin_notes } : {}),
      ...(data.client_message ? { p_client_message: data.client_message } : {}),
    });
    if (error) throw new Error(error.message);

    // Notify the client (entity-level) and email the resolution.
    const { data: dispute } = await context.supabase
      .from("disputes")
      .select("order_id, store_id, orders(external_order_number), stores(entity_id)")
      .eq("id", data.dispute_id)
      .maybeSingle();
    const entityId = (dispute?.stores as { entity_id?: string } | null)?.entity_id;
    const orderNumber =
      (dispute?.orders as { external_order_number?: string } | null)?.external_order_number ??
      dispute?.order_id ??
      "";
    if (entityId) {
      const { notify } = await import("./billing.server");
      const { sendClientEmail } = await import("./email.server");
      const { getAdminClient } = await import("./admin.server");
      const admin = await getAdminClient();

      // A wallet-credit resolution is a payment event — issue the receipt.
      // Best-effort: the credit is the source of truth, documents never block it.
      if (data.resolution === "wallet_credit") {
        try {
          const { data: creditTxn } = await admin
            .from("wallet_transactions")
            .select("id")
            .eq("reference", data.dispute_id)
            .eq("type", "credit")
            .maybeSingle();
          if (creditTxn) {
            const { issueWalletTopupReceipt } = await import("./documents.server");
            await issueWalletTopupReceipt(admin, creditTxn.id);
          }
        } catch (e) {
          console.error("dispute credit receipt failed:", data.dispute_id, e);
        }
      }

      const label =
        data.resolution === "wallet_credit"
          ? `approved with a $${Number(data.credit_amount ?? 0).toFixed(2)} wallet credit`
          : data.resolution === "reshipped"
            ? "approved — a reshipment is on the way"
            : "rejected";
      const body = `Your dispute for order ${orderNumber} was ${label}.` +
        (data.client_message ? ` ${data.client_message}` : "");
      await notify(admin, {
        entityId,
        storeId: dispute?.store_id ?? null,
        kind: "dispute_resolved",
        title: "Dispute resolved",
        body,
      });
      const { data: entity } = await admin
        .from("entities")
        .select("account_id")
        .eq("id", entityId)
        .maybeSingle();
      if (entity?.account_id) {
        await sendClientEmail(admin, {
          clientId: entity.account_id,
          subject: `Dispute update — order ${orderNumber}`,
          text: body,
        });
      }
    }
    return { ok: true };
  });

/**
 * Admin: dispute rate per supplier SKU — recurring disputes on the same
 * product are the signal that a supplier is failing.
 */
export const adminDisputeSkuReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { data: disputes, error } = await context.supabase
      .from("disputes")
      .select("order_id, status, reason, created_at");
    if (error) throw new Error(error.message);
    const orderIds = [...new Set((disputes ?? []).map((d) => d.order_id))];
    if (orderIds.length === 0) return [];
    const { data: items, error: itemError } = await context.supabase
      .from("order_fulfillment_items")
      .select("order_id, sku")
      .in("order_id", orderIds);
    if (itemError) throw new Error(itemError.message);
    const skusByOrder = new Map<string, Set<string>>();
    for (const item of items ?? []) {
      const set = skusByOrder.get(item.order_id) ?? new Set<string>();
      set.add(item.sku);
      skusByOrder.set(item.order_id, set);
    }
    const bySku = new Map<
      string,
      { sku: string; disputes: number; open: number; approved: number; last_dispute_at: string }
    >();
    for (const dispute of disputes ?? []) {
      for (const sku of skusByOrder.get(dispute.order_id) ?? []) {
        const row =
          bySku.get(sku) ?? { sku, disputes: 0, open: 0, approved: 0, last_dispute_at: dispute.created_at };
        row.disputes += 1;
        if (dispute.status === "open" || dispute.status === "investigating") row.open += 1;
        if (dispute.status === "approved") row.approved += 1;
        if (dispute.created_at > row.last_dispute_at) row.last_dispute_at = dispute.created_at;
        bySku.set(sku, row);
      }
    }
    return [...bySku.values()].sort((a, b) => b.disputes - a.disputes);
  });
