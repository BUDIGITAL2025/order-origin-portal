import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { adminDocumentsFilterSchema, documentIdSchema } from "./schemas";

/**
 * Client: my payment receipts, newest first. RLS scopes to the caller.
 * The order number is embedded for display.
 */
export const listMyDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("documents")
      .select(
        "id, document_type, document_number, amount, issued_at, order_id, wallet_transaction_id, orders(external_order_number)",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Short-lived signed URL (60s) to download the PDF from the private bucket.
 * Ownership/admin rights are enforced by reading the row through the
 * caller's own RLS-scoped client first — the service role only signs.
 */
export const getDocumentDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => documentIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase
      .from("documents")
      .select("id, storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("Document not found");
    if (!doc.storage_path) throw new Error("This receipt is not available yet");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { DOCUMENTS_BUCKET } = await import("./documents.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (signError || !signed?.signedUrl) {
      throw new Error(signError?.message ?? "Could not create download link");
    }
    return { url: signed.signedUrl };
  });

/**
 * Admin utility: issue any missing receipts — wallet credits (top-ups and
 * dispute credits) and paid orders that have no document yet. Idempotent:
 * issuance is keyed on unique indexes, so re-runs are no-ops. Used to
 * backfill receipts that failed silently at webhook time (e.g. storeless
 * entities before documents.store_id became nullable).
 */
export const adminBackfillReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { issueWalletTopupReceipt, issueOrderReceipt } = await import("./documents.server");

    const [{ data: credits, error: cErr }, { data: walletDocs, error: wdErr }] =
      await Promise.all([
        admin.from("wallet_transactions").select("id").eq("type", "credit"),
        admin.from("documents").select("wallet_transaction_id").not("wallet_transaction_id", "is", null),
      ]);
    if (cErr) throw new Error(cErr.message);
    if (wdErr) throw new Error(wdErr.message);
    const haveWalletDoc = new Set((walletDocs ?? []).map((d) => d.wallet_transaction_id));
    const missingCredits = (credits ?? []).filter((t) => !haveWalletDoc.has(t.id));

    const [{ data: paidOrders, error: oErr }, { data: orderDocs, error: odErr }] =
      await Promise.all([
        admin.from("orders").select("id").not("paid_at", "is", null),
        admin.from("documents").select("order_id").not("order_id", "is", null),
      ]);
    if (oErr) throw new Error(oErr.message);
    if (odErr) throw new Error(odErr.message);
    const haveOrderDoc = new Set((orderDocs ?? []).map((d) => d.order_id));
    const missingOrders = (paidOrders ?? []).filter((o) => !haveOrderDoc.has(o.id));

    const walletResults: Array<{ id: string; result: string }> = [];
    for (const t of missingCredits) {
      try {
        walletResults.push({ id: t.id, result: await issueWalletTopupReceipt(admin, t.id) });
      } catch (e) {
        walletResults.push({ id: t.id, result: `error: ${e instanceof Error ? e.message : e}` });
      }
    }
    const orderResults: Array<{ id: string; result: string }> = [];
    for (const o of missingOrders) {
      try {
        orderResults.push({ id: o.id, result: await issueOrderReceipt(admin, o.id) });
      } catch (e) {
        orderResults.push({ id: o.id, result: `error: ${e instanceof Error ? e.message : e}` });
      }
    }
    return { walletResults, orderResults };
  });

/** Admin: receipts across all clients, filterable by type and client. */
export const adminListDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminDocumentsFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("documents")
      .select(
        "id, entity_id, store_id, document_type, document_number, amount, issued_at, created_at, order_id, orders(external_order_number), entities(legal_name)",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.type) query = query.eq("document_type", data.type);
    // clientId in the filter schema identifies the ENTITY post-hierarchy.
    if (data.clientId) query = query.eq("entity_id", data.clientId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
