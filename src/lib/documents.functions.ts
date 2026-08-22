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
        "id, client_id, document_type, document_number, amount, issued_at, created_at, order_id, orders(external_order_number), profiles(company_name)",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.type) query = query.eq("document_type", data.type);
    if (data.clientId) query = query.eq("client_id", data.clientId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
