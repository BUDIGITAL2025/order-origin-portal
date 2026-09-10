/**
 * Purchase orders — server functions (sourcing agent + admin).
 *
 * This is the internal execution layer of a stock purchase the CLIENT HAS
 * ALREADY PAID FOR. Every entry point re-checks that, so nothing can ever
 * reach a supplier on unsettled money.
 *
 * Walls enforced here, not in the UI:
 *   - the agent never receives the client identity, the client price, freight,
 *     import or the margin — only the supplier layer and their own fee;
 *   - the PO document and the supplier email carry no client information;
 *   - the client only ever sees the neutral public status.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";

type PurchaseStatus = Database["public"]["Enums"]["stock_purchase_status"];

const uuid = z.string().uuid();

/** Statuses where the internal PO workflow applies (money already in). */
const WORKFLOW_STATUSES = [
  "paid",
  "po_sent",
  "invoice_uploaded",
  "invoice_verified",
  "invoice_discrepancy",
  "supplier_paid",
  "in_production",
  "shipped",
  "delivered",
] as const satisfies readonly PurchaseStatus[];

/** Neutral label so an agent can talk about a purchase without knowing who. */
function clientLabel(storeId: string): string {
  return `Client #${storeId.slice(0, 6).toUpperCase()}`;
}

type PurchaseRow = {
  id: string;
  store_id: string;
  status: string;
  path: string;
  product_name: string;
  variant_label: string | null;
  sku: string | null;
  quantity: number;
  supplier_unit_price: number | string | null;
  sourcing_fee_rate: number | string | null;
  sourced_by: string | null;
  supplier_id: string | null;
  delivery_address: string | null;
  reveal_consignee: boolean | null;
  po_number: string | null;
  po_document_path: string | null;
  po_generated_at: string | null;
  po_sent_at: string | null;
  po_sent_channel: string | null;
  po_payment_terms: string | null;
  po_lead_days: number | null;
  supplier_invoice_path: string | null;
  supplier_invoice_number: string | null;
  supplier_invoice_currency: string | null;
  supplier_invoice_total: number | string | null;
  supplier_invoice_uploaded_at: string | null;
  supplier_invoice_state: string | null;
  supplier_invoice_note: string | null;
  supplier_paid_at: string | null;
  supplier_payment_method: string | null;
  supplier_payment_reference: string | null;
  supplier_payment_proof_path: string | null;
  paid_at: string | null;
  created_at: string;
};

/** Everything an agent may see about a purchase — supplier layer only. */
function agentView(p: PurchaseRow) {
  const supplierUnit = p.supplier_unit_price != null ? Number(p.supplier_unit_price) : null;
  const expected = supplierUnit != null ? Math.round(supplierUnit * p.quantity * 100) / 100 : null;
  const invoiced = p.supplier_invoice_total != null ? Number(p.supplier_invoice_total) : null;
  return {
    id: p.id,
    status: p.status,
    path: p.path,
    client_label: clientLabel(p.store_id),
    product_name: p.product_name,
    variant_label: p.variant_label,
    sku: p.sku,
    quantity: p.quantity,
    supplier_unit_price: supplierUnit,
    expected_total: expected,
    fee_rate: p.sourcing_fee_rate != null ? Number(p.sourcing_fee_rate) : null,
    supplier_id: p.supplier_id,
    po_number: p.po_number,
    po_generated_at: p.po_generated_at,
    po_sent_at: p.po_sent_at,
    po_sent_channel: p.po_sent_channel,
    po_payment_terms: p.po_payment_terms,
    po_lead_days: p.po_lead_days,
    has_po_document: !!p.po_document_path,
    invoice_number: p.supplier_invoice_number,
    invoice_currency: p.supplier_invoice_currency,
    invoice_total: invoiced,
    invoice_state: p.supplier_invoice_state,
    invoice_note: p.supplier_invoice_note,
    invoice_uploaded_at: p.supplier_invoice_uploaded_at,
    has_invoice_document: !!p.supplier_invoice_path,
    supplier_paid_at: p.supplier_paid_at,
    paid_at: p.paid_at,
    created_at: p.created_at,
  };
}

const SELECT = "*";

async function loadForAgent(userId: string, purchaseId: string) {
  const { getAdminClient } = await import("./admin.server");
  const admin = await getAdminClient();
  const { data, error } = await admin
    .from("stock_purchases")
    .select(SELECT)
    .eq("id", purchaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.sourced_by !== userId) throw new Error("Purchase not found");
  if (!(WORKFLOW_STATUSES as readonly string[]).includes(data.status)) {
    throw new Error("This purchase is not paid yet.");
  }
  return { admin, purchase: data as unknown as PurchaseRow };
}

async function assertCollaborator(context: { supabase: unknown; userId: string }) {
  const { getAdminClient } = await import("./admin.server");
  const { requireCollaborator } = await import("./sourcing.server");
  const admin = await getAdminClient();
  await requireCollaborator(admin, context.userId);
}

// ===================== Agent: list & detail =====================

export const deskListPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCollaborator(context);
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("stock_purchases")
      .select(SELECT)
      .eq("sourced_by", context.userId)
      .in("status", [...WORKFLOW_STATUSES])
      .order("paid_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const { purchaseRef } = await import("./purchases.server");
    return (data ?? []).map((p) => ({
      ...agentView(p as unknown as PurchaseRow),
      ref: purchaseRef(p.id),
    }));
  });

export const deskGetPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ purchase_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const { purchaseRef } = await import("./purchases.server");
    const { getPaymentTermsDefault } = await import("./po.server");

    const { data: supplier } = purchase.supplier_id
      ? await admin
          .from("suppliers")
          .select("id, name, contact_name, contact_email, contact_phone, address, country")
          .eq("id", purchase.supplier_id)
          .maybeSingle()
      : { data: null };

    // Fall back to the supplier linked on the quote line that was sourced.
    let fallback = supplier;
    if (!fallback) {
      const { data: line } = await admin
        .from("stock_purchases")
        .select("quote_line_id")
        .eq("id", purchase.id)
        .maybeSingle();
      if (line?.quote_line_id) {
        const { data: ql } = await admin
          .from("quote_lines")
          .select("supplier_id")
          .eq("id", line.quote_line_id)
          .maybeSingle();
        if (ql?.supplier_id) {
          const { data: s } = await admin
            .from("suppliers")
            .select("id, name, contact_name, contact_email, contact_phone, address, country")
            .eq("id", ql.supplier_id)
            .maybeSingle();
          fallback = s ?? null;
        }
      }
    }

    const { data: events } = await admin
      .from("purchase_events")
      .select("id, event, detail, actor_role, created_at")
      .eq("purchase_id", purchase.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      purchase: { ...agentView(purchase), ref: purchaseRef(purchase.id) },
      supplier: fallback,
      events: events ?? [],
      default_payment_terms: await getPaymentTermsDefault(admin),
    };
  });

// ===================== Agent: supplier details =====================

export const deskSaveSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchase_id: uuid,
        name: z.string().trim().min(2).max(160),
        contact_name: z.string().trim().max(120).optional(),
        contact_email: z.string().trim().email().max(160).or(z.literal("")).optional(),
        contact_phone: z.string().trim().max(60).optional(),
        address: z.string().trim().max(400).optional(),
        country: z.string().trim().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const { upsertSupplierByName } = await import("./sourcing.server");
    const { logPurchaseEvent } = await import("./po.server");

    const supplierId =
      purchase.supplier_id ?? (await upsertSupplierByName(admin, data.name)).id;

    const { error } = await admin
      .from("suppliers")
      .update({
        name: data.name,
        contact_name: data.contact_name || null,
        contact_email: data.contact_email || null,
        contact_phone: data.contact_phone || null,
        address: data.address || null,
        country: data.country || null,
      })
      .eq("id", supplierId);
    if (error) throw new Error(error.message);

    if (purchase.supplier_id !== supplierId) {
      await admin.from("stock_purchases").update({ supplier_id: supplierId }).eq("id", purchase.id);
    }
    await logPurchaseEvent(admin, {
      purchaseId: purchase.id,
      event: "supplier_details_saved",
      detail: data.name,
      actorId: context.userId,
      actorRole: "agent",
    });
    return { ok: true, supplier_id: supplierId };
  });

// ===================== Agent: generate the PO =====================

export const deskGeneratePo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchase_id: uuid,
        payment_terms: z.string().trim().min(3).max(600).optional(),
        lead_days: z.number().int().min(1).max(365).optional(),
        notes: z.string().trim().max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const po = await import("./po.server");

    if (!purchase.supplier_id) throw new Error("Confirm the supplier details first.");
    if (purchase.supplier_unit_price == null) {
      throw new Error("This purchase has no agreed supplier price.");
    }
    const { data: supplier } = await admin
      .from("suppliers")
      .select("name, contact_name, contact_email, contact_phone, address, country")
      .eq("id", purchase.supplier_id)
      .maybeSingle();
    if (!supplier) throw new Error("Supplier not found");

    const poNumber = purchase.po_number ?? (await po.nextPoNumber(admin));
    const paymentTerms =
      data.payment_terms ?? purchase.po_payment_terms ?? (await po.getPaymentTermsDefault(admin));
    const leadDays = data.lead_days ?? purchase.po_lead_days ?? null;

    const deliveryOnWarehouse = purchase.path === "flysales";
    const deliveryLines = deliveryOnWarehouse
      ? po.warehouseAddressLines()
      : (purchase.delivery_address ?? "")
          .split(/\r?\n|,\s*/)
          .map((l) => l.trim())
          .filter(Boolean);

    const bytes = await po.renderPurchaseOrderPdf({
      poNumber,
      issuedAt: new Date(),
      supplier: {
        name: supplier.name,
        contactName: supplier.contact_name,
        email: supplier.contact_email,
        phone: supplier.contact_phone,
        addressLines: [supplier.address, supplier.country].filter(Boolean) as string[],
      },
      lines: [
        {
          sku: purchase.sku ?? "",
          description: purchase.variant_label
            ? `${purchase.product_name} — ${purchase.variant_label}`
            : purchase.product_name,
          quantity: purchase.quantity,
          unitPrice: Number(purchase.supplier_unit_price),
        },
      ],
      leadDays,
      paymentTerms,
      incoterms: "EXW (Ex Works)",
      deliveryLabel: deliveryOnWarehouse ? "Ship to" : "Delivery address",
      deliveryLines: deliveryLines.length ? deliveryLines : ["Advised separately"],
      notes: data.notes ?? null,
    });

    const path = `${purchase.id}/${poNumber}.pdf`;
    const { error: upErr } = await admin.storage
      .from(po.PURCHASE_DOCS_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { error } = await admin
      .from("stock_purchases")
      .update({
        po_number: poNumber,
        po_document_path: path,
        po_generated_at: new Date().toISOString(),
        po_payment_terms: paymentTerms,
        po_lead_days: leadDays,
      })
      .eq("id", purchase.id);
    if (error) throw new Error(error.message);

    await po.logPurchaseEvent(admin, {
      purchaseId: purchase.id,
      event: "po_generated",
      detail: poNumber,
      actorId: context.userId,
      actorRole: "agent",
    });
    return { ok: true, po_number: poNumber };
  });

/** Short-lived link to the PO or the supplier invoice. */
export const deskPurchaseDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ purchase_id: uuid, kind: z.enum(["po", "invoice"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const { PURCHASE_DOCS_BUCKET } = await import("./po.server");
    const path = data.kind === "po" ? purchase.po_document_path : purchase.supplier_invoice_path;
    if (!path) throw new Error("There is no document to download yet.");
    const { data: signed, error } = await admin.storage
      .from(PURCHASE_DOCS_BUCKET)
      .createSignedUrl(path, 300);
    if (error || !signed) throw new Error(error?.message ?? "Could not create the link");
    return { url: signed.signedUrl };
  });

// ===================== Agent: send the PO =====================

export const deskSendPo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchase_id: uuid,
        channel: z.enum(["email", "download"]),
        message: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const po = await import("./po.server");
    if (!purchase.po_document_path || !purchase.po_number) {
      throw new Error("Generate the purchase order first.");
    }

    let sent = true;
    let error: string | undefined;

    if (data.channel === "email") {
      const { data: supplier } = await admin
        .from("suppliers")
        .select("name, contact_name, contact_email")
        .eq("id", purchase.supplier_id!)
        .maybeSingle();
      if (!supplier?.contact_email) throw new Error("Add the supplier email address first.");

      const { data: file, error: dlError } = await admin.storage
        .from(po.PURCHASE_DOCS_BUCKET)
        .download(purchase.po_document_path);
      if (dlError || !file) throw new Error(dlError?.message ?? "Could not read the PO document");
      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(await file.arrayBuffer())),
      );

      const { renderEmail } = await import("./email-layout.server");
      const { sendLoggedEmail } = await import("./email.server");
      const total = po.poTotal([
        {
          sku: purchase.sku ?? "",
          description: purchase.product_name,
          quantity: purchase.quantity,
          unitPrice: Number(purchase.supplier_unit_price ?? 0),
        },
      ]);
      const built = renderEmail({
        heading: `Purchase order ${purchase.po_number}`,
        preheader: `New purchase order ${purchase.po_number}`,
        paragraphs: [
          `Dear ${supplier.contact_name || supplier.name},`,
          "Please find our purchase order attached as a PDF. Kindly confirm acceptance, the production lead time and the readiness date by reply.",
          ...(data.message ? [data.message] : []),
        ],
        panel: {
          title: "Order summary",
          rows: [
            { label: "PO number", value: purchase.po_number },
            {
              label: "Item",
              value: purchase.variant_label
                ? `${purchase.product_name} — ${purchase.variant_label}`
                : purchase.product_name,
            },
            { label: "Quantity", value: String(purchase.quantity) },
            { label: "Total (USD)", value: `$${total.toFixed(2)}`, strong: true },
          ],
        },
        note: "This purchase order is issued under EXW terms; our forwarder will arrange collection.",
      });

      const result = await sendLoggedEmail(admin, {
        to: supplier.contact_email,
        subject: `Purchase order ${purchase.po_number}`,
        text: built.text,
        html: built.html,
        kind: "purchase_order",
        relatedId: purchase.id,
        attachments: [
          {
            filename: `${purchase.po_number}.pdf`,
            contentBase64: base64,
            contentType: "application/pdf",
          },
        ],
      });
      sent = result.sent;
      if (result.error) error = result.error;
      if (!sent) throw new Error(error ?? "The email could not be sent.");
    }

    const now = new Date().toISOString();
    await admin
      .from("stock_purchases")
      .update({
        status: purchase.status === "paid" ? "po_sent" : (purchase.status as PurchaseStatus),
        po_sent_at: now,
        po_sent_channel: data.channel,
      })
      .eq("id", purchase.id);

    await po.logPurchaseEvent(admin, {
      purchaseId: purchase.id,
      event: "po_sent",
      detail: data.channel === "email" ? "Emailed to the supplier" : "Downloaded for manual sending",
      actorId: context.userId,
      actorRole: "agent",
    });
    return { ok: true };
  });

// ===================== Agent: supplier invoice =====================

export const deskUploadInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchase_id: uuid,
        file_name: z.string().min(1).max(200),
        mime_type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
        base64: z.string().min(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const po = await import("./po.server");
    const { extractSupplierInvoice, logInvoiceAiCall, MAX_INVOICE_BYTES } = await import(
      "./invoice-ai.server"
    );

    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_INVOICE_BYTES) throw new Error("That file is too large (max 15 MB).");

    const ext = data.mime_type === "application/pdf" ? "pdf" : data.mime_type.split("/")[1];
    const path = `${purchase.id}/invoice-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(po.PURCHASE_DOCS_BUCKET)
      .upload(path, bytes, { contentType: data.mime_type, upsert: true });
    if (upErr) throw new Error(upErr.message);

    let extract;
    try {
      const result = await extractSupplierInvoice({
        base64: data.base64,
        mimeType: data.mime_type,
        fileName: data.file_name,
      });
      extract = result.extract;
      await logInvoiceAiCall(admin, {
        purchaseId: purchase.id,
        userId: context.userId,
        durationMs: result.durationMs,
        status: "ok",
      });
    } catch (e) {
      await logInvoiceAiCall(admin, {
        purchaseId: purchase.id,
        userId: context.userId,
        durationMs: 0,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }

    const expected =
      purchase.supplier_unit_price != null
        ? Math.round(Number(purchase.supplier_unit_price) * purchase.quantity * 100) / 100
        : null;
    const invoiced = extract.total_amount;
    // Within 1% of what we agreed is a match; anything else needs a human.
    const matches =
      expected != null && invoiced != null && Math.abs(invoiced - expected) <= expected * 0.01;
    const state = invoiced == null ? "unreadable" : matches ? "verified" : "discrepancy";
    const status = state === "verified" ? "invoice_verified" : "invoice_discrepancy";

    const { error } = await admin
      .from("stock_purchases")
      .update({
        status: (state === "unreadable" ? "invoice_uploaded" : status) as PurchaseStatus,
        supplier_invoice_path: path,
        supplier_invoice_number: extract.invoice_number,
        supplier_invoice_currency: extract.currency,
        supplier_invoice_total: invoiced,
        supplier_invoice_extract: extract as unknown as Json,
        supplier_invoice_uploaded_at: new Date().toISOString(),
        supplier_invoice_state: state,
      })
      .eq("id", purchase.id);
    if (error) throw new Error(error.message);

    await po.logPurchaseEvent(admin, {
      purchaseId: purchase.id,
      event: "invoice_uploaded",
      detail:
        invoiced == null
          ? "Total could not be read from the invoice"
          : `Invoice total $${invoiced.toFixed(2)} vs expected $${(expected ?? 0).toFixed(2)}`,
      actorId: context.userId,
      actorRole: "agent",
    });

    return { ok: true, state, expected, invoiced, extract };
  });

export const deskAnnotateInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ purchase_id: uuid, note: z.string().trim().min(2).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCollaborator(context);
    const { admin, purchase } = await loadForAgent(context.userId, data.purchase_id);
    const { logPurchaseEvent } = await import("./po.server");
    await admin
      .from("stock_purchases")
      .update({ supplier_invoice_note: data.note })
      .eq("id", purchase.id);
    await logPurchaseEvent(admin, {
      purchaseId: purchase.id,
      event: "invoice_note",
      detail: data.note,
      actorId: context.userId,
      actorRole: "agent",
    });
    return { ok: true };
  });

// ===================== Admin: supplier payments =====================

export const adminListSupplierPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data, error } = await admin
      .from("stock_purchases")
      .select("*, suppliers(name, contact_email), stores(store_name, entities(legal_name))")
      .in("status", ["po_sent", "invoice_uploaded", "invoice_verified", "invoice_discrepancy"])
      .order("supplier_invoice_uploaded_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const { purchaseRef } = await import("./purchases.server");
    return (data ?? []).map((row) => {
      const p = row as typeof row & {
        suppliers?: { name: string | null; contact_email: string | null } | null;
        stores?: { store_name: string | null; entities?: { legal_name: string | null } | null };
      };
      const expected =
        p.supplier_unit_price != null
          ? Math.round(Number(p.supplier_unit_price) * p.quantity * 100) / 100
          : null;
      return {
        id: p.id,
        ref: purchaseRef(p.id),
        status: p.status,
        po_number: p.po_number,
        product_name: p.product_name,
        variant_label: p.variant_label,
        quantity: p.quantity,
        supplier_name: p.suppliers?.name ?? null,
        client_name: p.stores?.entities?.legal_name ?? null,
        workspace_name: p.stores?.store_name ?? null,
        expected_total: expected,
        invoiced_total: p.supplier_invoice_total != null ? Number(p.supplier_invoice_total) : null,
        invoice_number: p.supplier_invoice_number,
        invoice_state: p.supplier_invoice_state,
        invoice_note: p.supplier_invoice_note,
        has_invoice_document: !!p.supplier_invoice_path,
        po_sent_at: p.po_sent_at,
        invoice_uploaded_at: p.supplier_invoice_uploaded_at,
      };
    });
  });

export const adminPurchaseDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ purchase_id: uuid, kind: z.enum(["po", "invoice", "proof"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { PURCHASE_DOCS_BUCKET } = await import("./po.server");
    const { data: row } = await admin
      .from("stock_purchases")
      .select("po_document_path, supplier_invoice_path, supplier_payment_proof_path")
      .eq("id", data.purchase_id)
      .maybeSingle();
    const path =
      data.kind === "po"
        ? row?.po_document_path
        : data.kind === "invoice"
          ? row?.supplier_invoice_path
          : row?.supplier_payment_proof_path;
    if (!path) throw new Error("There is no document to open.");
    const { data: signed, error } = await admin.storage
      .from(PURCHASE_DOCS_BUCKET)
      .createSignedUrl(path, 300);
    if (error || !signed) throw new Error(error?.message ?? "Could not create the link");
    return { url: signed.signedUrl };
  });

/**
 * Record that WE paid the supplier (the money moved outside the platform).
 * This is the moment the agent's commission is confirmed, and the moment the
 * purchase enters production for the client.
 */
export const adminRecordSupplierPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchase_id: uuid,
        paid_on: z.string().min(4).max(40),
        method: z.enum(["wire", "alibaba", "other"]),
        reference: z.string().trim().max(160).optional(),
        proof_base64: z.string().min(20).optional(),
        proof_name: z.string().max(200).optional(),
        proof_mime: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const po = await import("./po.server");

    const { data: row, error: loadError } = await admin
      .from("stock_purchases")
      .select("*")
      .eq("id", data.purchase_id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!row) throw new Error("Purchase not found");
    if (!row.paid_at) throw new Error("The client has not paid this purchase yet.");

    let proofPath: string | null = row.supplier_payment_proof_path ?? null;
    if (data.proof_base64 && data.proof_mime) {
      const bytes = Uint8Array.from(atob(data.proof_base64), (c) => c.charCodeAt(0));
      const ext = data.proof_mime === "application/pdf" ? "pdf" : data.proof_mime.split("/")[1];
      proofPath = `${row.id}/payment-proof-${Date.now()}.${ext}`;
      const { error: upErr } = await admin.storage
        .from(po.PURCHASE_DOCS_BUCKET)
        .upload(proofPath, bytes, { contentType: data.proof_mime, upsert: true });
      if (upErr) throw new Error(upErr.message);
    }

    const now = new Date().toISOString();
    const { error } = await admin
      .from("stock_purchases")
      .update({
        status: "in_production",
        in_production_at: now,
        supplier_paid_at: new Date(data.paid_on).toISOString(),
        supplier_payment_method: data.method,
        supplier_payment_reference: data.reference || null,
        supplier_payment_proof_path: proofPath,
        supplier_paid_by: context.userId,
      })
      .eq("id", row.id);
    if (error) throw new Error(error.message);

    await po.logPurchaseEvent(admin, {
      purchaseId: row.id,
      event: "supplier_paid",
      detail: `Paid by ${data.method}${data.reference ? ` · ${data.reference}` : ""}`,
      actorId: context.userId,
      actorRole: "admin",
    });
    await po.logPurchaseEvent(admin, {
      purchaseId: row.id,
      event: "in_production",
      detail: "Production started",
      actorId: context.userId,
      actorRole: "admin",
    });

    // Commission is confirmed when we actually commit the money.
    if (row.sourced_by && row.supplier_unit_price && row.sourcing_fee_rate) {
      try {
        const { accrueSourcingEarning } = await import("./sourcing.server");
        const { purchaseRef } = await import("./purchases.server");
        await accrueSourcingEarning(admin, {
          collaboratorUserId: row.sourced_by,
          reference: `purchase:${row.id}`,
          description: `Commission on stock purchase ${purchaseRef(row.id)}`,
          units: row.quantity,
          feeRate: Number(row.sourcing_fee_rate),
          supplierUnitPrice: Number(row.supplier_unit_price),
          quoteLineId: row.quote_line_id,
          stockPurchaseId: row.id,
        });
      } catch (e) {
        console.error("earnings accrual failed at supplier payment", row.id, e);
      }
    }

    return { ok: true };
  });
