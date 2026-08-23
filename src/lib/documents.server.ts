/**
 * Payment Receipts ("Payment Receipt" documents).
 *
 * These are NOT tax invoices — they are proof-of-payment documents the
 * client can hand to their accountant. The word "invoice" must never appear
 * in the UI, filenames or PDF header (the footer states this explicitly).
 *
 * Issued automatically when money moves:
 *   - an order is paid          → order_receipt
 *   - a wallet top-up is credit → wallet_topup
 *   - a subscription charge     → subscription
 *
 * Flow: render the PDF, upload it to the private `documents` storage bucket,
 * then insert the immutable documents row (DB triggers block UPDATE/DELETE),
 * so a document is complete the moment its row exists.
 *
 * Idempotency: unique partial indexes on order_id / wallet_transaction_id /
 * payment_reference make replayed Stripe events and cron sweeps no-ops.
 *
 * The issuing entity (legal name / address / tax id) comes from environment
 * config (SUPPLIER_LEGAL_NAME, SUPPLIER_ADDRESS, SUPPLIER_TAX_ID) so it can
 * change without touching code.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { round2 } from "./admin.server";
import { planLabel } from "./plans";

type Admin = SupabaseClient<Database>;

export const DOCUMENTS_BUCKET = "documents";
export type DocumentType = "order_receipt" | "wallet_topup" | "subscription";

// ---------- Supplier (issuing entity) — environment-driven ----------

interface SupplierConfig {
  name: string;
  addressLines: string[];
  taxId: string;
}

function getSupplierConfig(): SupplierConfig {
  return {
    name: process.env["SUPPLIER_LEGAL_NAME"]?.trim() || "FlySales",
    addressLines: (process.env["SUPPLIER_ADDRESS"] ?? "")
      .split(/\r?\n/)
      .flatMap((line) => line.split(";"))
      .map((line) => line.trim())
      .filter(Boolean),
    taxId: process.env["SUPPLIER_TAX_ID"]?.trim() || "",
  };
}

// ---------- PDF rendering ----------

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.11, 0.13, 0.18);
const MUTED = rgb(0.45, 0.48, 0.55);
const HAIRLINE = rgb(0.88, 0.89, 0.92);
const ACCENT = rgb(0.15, 0.35, 0.72);
const BAND = rgb(0.95, 0.96, 0.98);

const usdFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(n: number): string {
  return `$${usdFmt.format(round2(n))}`;
}

/** pdf-lib standard fonts encode WinAnsi only — replace anything outside latin-1. */
function s(value: unknown): string {
  return String(value ?? "").replace(/[^\x20-\x7E\xA0-\xFF]|[\x80-\x9F]/g, "?");
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export interface ReceiptLine {
  description: string;
  detail?: string | null;
  quantity: number | null;
  unitPrice: number | null;
  total: number;
}

export interface ReceiptData {
  documentNumber: string;
  documentKind: string;
  issuedAt: Date;
  paymentDate: Date;
  paymentMethod: string;
  referenceLines: Array<[string, string]>;
  client: { company: string; contact: string; country: string; vat: string };
  lines: ReceiptLine[];
  total: number;
}

function drawRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
) {
  const t = s(text);
  page.drawText(t, { x: rightX - font.widthOfTextAtSize(t, size), y, size, font, color });
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const t = s(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let out = t;
  while (out.length > 1 && font.widthOfTextAtSize(out + "...", size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "...";
}

export async function renderReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const supplier = getSupplierConfig();

  // Table column anchors.
  const colDesc = MARGIN + 6;
  const colSku = 305;
  const qtyRight = 400;
  const unitRight = 480;
  const amountRight = RIGHT - 6;

  let page = doc.addPage([PAGE_W, PAGE_H]);

  const drawFooter = () => {
    page.drawLine({ start: { x: MARGIN, y: 70 }, end: { x: RIGHT, y: 70 }, thickness: 0.5, color: HAIRLINE });
    page.drawText("This document is a payment receipt - it is not a tax invoice.", {
      x: MARGIN,
      y: 56,
      size: 8.5,
      font: bold,
      color: MUTED,
    });
    page.drawText(
      s(`${supplier.name} · Receipt ${data.documentNumber} · Issued ${pdfDate(data.issuedAt)}`),
      { x: MARGIN, y: 44, size: 8, font: regular, color: MUTED },
    );
  };

  const drawTableHeader = (y: number): number => {
    page.drawRectangle({ x: MARGIN, y: y - 6, width: RIGHT - MARGIN, height: 20, color: BAND });
    page.drawText("Description", { x: colDesc, y, size: 8.5, font: bold, color: MUTED });
    page.drawText("SKU", { x: colSku, y, size: 8.5, font: bold, color: MUTED });
    drawRight(page, "Qty", qtyRight, y, bold, 8.5, MUTED);
    drawRight(page, "Unit price", unitRight, y, bold, 8.5, MUTED);
    drawRight(page, "Amount", amountRight, y, bold, 8.5, MUTED);
    return y - 26;
  };

  // ---- Header: brand left, issuing entity right ----
  let y = PAGE_H - MARGIN;
  page.drawText("FlySales", { x: MARGIN, y: y - 18, size: 20, font: bold, color: ACCENT });
  let sy = y - 14;
  drawRight(page, supplier.name, RIGHT, sy, bold, 10);
  sy -= 13;
  for (const line of supplier.addressLines) {
    drawRight(page, line, RIGHT, sy, regular, 8.5, MUTED);
    sy -= 11;
  }
  if (supplier.taxId) {
    drawRight(page, `VAT: ${supplier.taxId}`, RIGHT, sy, regular, 8.5, MUTED);
    sy -= 11;
  }
  y -= 46;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1.5, color: ACCENT });
  y -= 32;

  // ---- Title ----
  page.drawText("PAYMENT RECEIPT", { x: MARGIN, y: y - 12, size: 15, font: bold, color: INK });
  drawRight(page, data.documentKind, RIGHT, y - 10, regular, 9, MUTED);
  y -= 42;

  // ---- Meta (left) and billed-to (right) ----
  const blockTop = y;
  const meta: Array<[string, string]> = [
    ["Receipt number", data.documentNumber],
    ["Issue date", pdfDate(data.issuedAt)],
    ["Payment date", pdfDate(data.paymentDate)],
    ["Payment method", data.paymentMethod],
    ...data.referenceLines,
  ];
  for (const [label, value] of meta) {
    page.drawText(s(label), { x: MARGIN, y, size: 8.5, font: regular, color: MUTED });
    page.drawText(fit(value, bold, 9.5, 240), { x: MARGIN + 110, y, size: 9.5, font: bold, color: INK });
    y -= 15;
  }
  let by = blockTop;
  drawRight(page, "BILLED TO", RIGHT, by, bold, 8.5, MUTED);
  by -= 14;
  drawRight(page, fit(data.client.company, bold, 10, 220), RIGHT, by, bold, 10);
  by -= 13;
  drawRight(page, fit(data.client.contact, regular, 9, 220), RIGHT, by, regular, 9, MUTED);
  by -= 12;
  drawRight(page, fit(data.client.country, regular, 9, 220), RIGHT, by, regular, 9, MUTED);
  by -= 12;
  if (data.client.vat) {
    drawRight(page, `VAT: ${data.client.vat}`, RIGHT, by, regular, 9, MUTED);
    by -= 12;
  }
  y = Math.min(y, by) - 24;

  // ---- Line items ----
  y = drawTableHeader(y);
  for (const line of data.lines) {
    if (y < 130) {
      drawFooter();
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = drawTableHeader(PAGE_H - MARGIN);
    }
    page.drawText(fit(line.description, regular, 9.5, colSku - colDesc - 12), {
      x: colDesc,
      y,
      size: 9.5,
      font: regular,
      color: INK,
    });
    page.drawText(fit(line.detail ?? "—", regular, 8.5, 110), {
      x: colSku,
      y,
      size: 8.5,
      font: regular,
      color: MUTED,
    });
    drawRight(page, line.quantity != null ? String(line.quantity) : "—", qtyRight, y, regular, 9.5);
    drawRight(page, line.unitPrice != null ? money(line.unitPrice) : "—", unitRight, y, regular, 9.5);
    drawRight(page, money(line.total), amountRight, y, regular, 9.5);
    y -= 11;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: HAIRLINE });
    y -= 9;
  }

  // ---- Total ----
  y -= 4;
  page.drawText("Total (USD)", { x: colSku, y, size: 10.5, font: bold, color: INK });
  drawRight(page, money(data.total), amountRight, y, bold, 10.5);

  drawFooter();
  return doc.save();
}

// ---------- Issuance ----------

async function nextDocumentNumber(admin: Admin): Promise<string> {
  const { data, error } = await admin.rpc("generate_document_number");
  if (error || !data) throw new Error(error?.message ?? "Could not generate a document number");
  return data;
}

interface ClientBlock {
  company: string;
  contact: string;
  country: string;
  vat: string;
}

/** "Bill to" block now reads the entity's legal identity, with the account's contact name. */
async function getEntityBlock(admin: Admin, entityId: string): Promise<ClientBlock> {
  const { data, error } = await admin
    .from("entities")
    .select("legal_name, country, vat_number, account_id, profiles(contact_name)")
    .eq("id", entityId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Entity not found");
  return {
    company: data.legal_name,
    contact: data.profiles?.contact_name ?? "",
    country: data.country ?? "",
    vat: data.vat_number ?? "",
  };
}

/**
 * Pick a store under the entity to attach the document to. Storeless
 * entities (manual mode, onboarding) get null — documents.store_id is
 * nullable; the entity is the owner.
 */
async function resolveStoreIdForEntity(admin: Admin, entityId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("stores")
    .select("id")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/**
 * Upload the PDF, then insert the immutable row. The unique indexes turn a
 * concurrent/replayed attempt into "exists" instead of a second document.
 */
async function storeReceipt(
  admin: Admin,
  args: {
    entityId: string;
    storeId?: string | null;
    documentType: DocumentType;
    orderId?: string | null;
    walletTransactionId?: string | null;
    paymentReference?: string | null;
    amount: number;
    receipt: ReceiptData;
  },
): Promise<"issued" | "exists"> {
  const number = args.receipt.documentNumber;
  const pdf = await renderReceiptPdf(args.receipt);
  const path = `${args.entityId}/${number}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf" });
  if (uploadError) throw new Error(uploadError.message);

  const storeId = args.storeId !== undefined
    ? args.storeId
    : await resolveStoreIdForEntity(admin, args.entityId);
  const { error: insertError } = await admin.from("documents").insert({
    entity_id: args.entityId,
    store_id: storeId,
    document_type: args.documentType,
    document_number: number,
    order_id: args.orderId ?? null,
    wallet_transaction_id: args.walletTransactionId ?? null,
    payment_reference: args.paymentReference ?? null,
    amount: round2(args.amount),
    storage_path: path,
  });
  if (insertError) {
    if (insertError.code === "23505") return "exists";
    throw new Error(insertError.message);
  }
  return "issued";
}

/** Order paid → order_receipt listing items, SKUs, prices and destination. */
export async function issueOrderReceipt(
  admin: Admin,
  orderId: string,
): Promise<"issued" | "exists" | "skipped"> {
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, store_id, external_order_number, payment_method, total_amount, destination_country, paid_at, stores(entity_id)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order || !order.paid_at) return "skipped";
  const entityId = order.stores?.entity_id;
  if (!entityId) return "skipped";

  const { data: existing } = await admin
    .from("documents")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) return "exists";

  const { data: items, error: itemsError } = await admin
    .from("order_items")
    .select("sku, quantity, unit_price, line_total, products(product_name)")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (itemsError) throw new Error(itemsError.message);

  const client = await getEntityBlock(admin, entityId);
  const lines: ReceiptLine[] = (items ?? []).map((item) => {
    const qty = Math.max(1, Number(item.quantity ?? 1));
    const unit = item.unit_price != null ? Number(item.unit_price) : null;
    return {
      description: item.products?.product_name ?? item.sku ?? "Item",
      detail: item.sku,
      quantity: qty,
      unitPrice: unit,
      total:
        item.line_total != null ? Number(item.line_total) : round2((unit ?? 0) * qty),
    };
  });
  const total =
    order.total_amount != null
      ? Number(order.total_amount)
      : round2(lines.reduce((acc, l) => acc + l.total, 0));
  const number = await nextDocumentNumber(admin);

  return storeReceipt(admin, {
    entityId,
    storeId: order.store_id,
    documentType: "order_receipt",
    orderId: order.id,
    amount: total,
    receipt: {
      documentNumber: number,
      documentKind: "Order payment",
      issuedAt: new Date(),
      paymentDate: new Date(order.paid_at),
      paymentMethod: order.payment_method === "wallet" ? "Wallet balance" : "Card (Stripe)",
      referenceLines: [
        ["Order number", order.external_order_number ?? order.id.slice(0, 8)],
        ["Destination country", order.destination_country ?? "—"],
      ],
      client,
      lines,
      total,
    },
  });
}

/** Wallet top-up credited → wallet_topup receipt. */
export async function issueWalletTopupReceipt(
  admin: Admin,
  walletTransactionId: string,
): Promise<"issued" | "exists" | "skipped"> {
  const { data: txn, error } = await admin
    .from("wallet_transactions")
    .select("id, entity_id, type, amount, description, created_at")
    .eq("id", walletTransactionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!txn || txn.type !== "credit") return "skipped";

  const { data: existing } = await admin
    .from("documents")
    .select("id")
    .eq("wallet_transaction_id", txn.id)
    .maybeSingle();
  if (existing) return "exists";

  const client = await getEntityBlock(admin, txn.entity_id);
  const amount = Number(txn.amount);
  const number = await nextDocumentNumber(admin);

  // Dispute credits are wallet credits too, but no card was charged —
  // the receipt must say where the money came from.
  const isDisputeCredit = txn.description?.startsWith("Dispute credit") ?? false;

  return storeReceipt(admin, {
    entityId: txn.entity_id,
    documentType: "wallet_topup",
    walletTransactionId: txn.id,
    amount,
    receipt: {
      documentNumber: number,
      documentKind: isDisputeCredit ? "Dispute credit" : "Wallet top-up",
      issuedAt: new Date(),
      paymentDate: new Date(txn.created_at),
      paymentMethod: isDisputeCredit ? "Wallet credit (dispute resolution)" : "Card (Stripe)",
      referenceLines: [],
      client,
      lines: [
        {
          description: txn.description || "Wallet top-up",
          detail: isDisputeCredit ? "Goodwill credit" : "Prepaid wallet credit",
          quantity: null,
          unitPrice: null,
          total: amount,
        },
      ],
      total: amount,
    },
  });
}

/**
 * Subscription payment succeeded (invoice.payment_succeeded) → subscription
 * receipt for the billed period. Keyed on the Stripe invoice id, which is
 * unique per period — a replayed event hits the unique index and stops.
 *
 * Subscriptions live on the store, but Stripe billing (customer id) is on
 * the entity — the receipt is issued to the entity that owns the matching
 * Stripe customer, using that store's plan for the line item.
 */
export async function issueSubscriptionReceipt(
  admin: Admin,
  invoice: Record<string, unknown>,
): Promise<"issued" | "exists" | "skipped"> {
  const invoiceId = typeof invoice["id"] === "string" ? invoice["id"] : null;
  if (!invoiceId) return "skipped";
  const customerRef = invoice["customer"];
  const customerId =
    typeof customerRef === "string"
      ? customerRef
      : customerRef && typeof customerRef === "object" && "id" in customerRef
        ? String((customerRef as { id: unknown }).id)
        : null;
  if (!customerId) return "skipped";

  const { data: existing } = await admin
    .from("documents")
    .select("id")
    .eq("payment_reference", invoiceId)
    .maybeSingle();
  if (existing) return "exists";

  const { data: entity } = await admin
    .from("entities")
    .select("id, legal_name, country, vat_number, profiles(contact_name)")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!entity) {
    console.error("subscription receipt: unknown Stripe customer", customerId);
    return "skipped";
  }

  const { data: store } = await admin
    .from("stores")
    .select("id, subscription_plan")
    .eq("entity_id", entity.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const amountPaid = Number(invoice["amount_paid"] ?? 0) / 100;
  if (!(amountPaid > 0)) return "skipped";

  const invoiceLines =
    (invoice["lines"] as { data?: Array<{ period?: { start?: number; end?: number } }> } | undefined)
      ?.data ?? [];
  const period = invoiceLines[0]?.period;
  const paidUnix =
    (invoice["status_transitions"] as { paid_at?: number } | undefined)?.paid_at ??
    (typeof invoice["created"] === "number" ? invoice["created"] : Date.now() / 1000);

  const plan = store?.subscription_plan === "unlimited" ? "unlimited" : "basic";
  const referenceLines: Array<[string, string]> = [["Stripe reference", invoiceId]];
  if (period?.start && period?.end) {
    referenceLines.unshift([
      "Billing period",
      `${pdfDate(new Date(period.start * 1000))} - ${pdfDate(new Date(period.end * 1000))}`,
    ]);
  }
  const number = await nextDocumentNumber(admin);

  return storeReceipt(admin, {
    entityId: entity.id,
    storeId: store?.id ?? null,
    documentType: "subscription",
    paymentReference: invoiceId,
    amount: amountPaid,
    receipt: {
      documentNumber: number,
      documentKind: "Subscription payment",
      issuedAt: new Date(),
      paymentDate: new Date(paidUnix * 1000),
      paymentMethod: "Card (Stripe)",
      referenceLines,
      client: {
        company: entity.legal_name,
        contact: entity.profiles?.contact_name ?? "",
        country: entity.country ?? "",
        vat: entity.vat_number ?? "",
      },
      lines: [
        {
          description: `FlySales ${planLabel(plan)} subscription`,
          detail: "Monthly plan",
          quantity: 1,
          unitPrice: amountPaid,
          total: amountPaid,
        },
      ],
      total: amountPaid,
    },
  });
}

/**
 * Backstop sweep: issue order receipts for any paid order that lacks one
 * (wallet-paid at intake, admin-resolved orders, a failed first attempt).
 * The unique index on documents.order_id makes re-runs no-ops.
 */
export async function issueMissingOrderReceipts(
  admin: Admin,
  maxPerRun = 25,
): Promise<{ issued: number; errors: number }> {
  const { data: orders, error } = await admin
    .from("orders")
    .select("id")
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  const ids = (orders ?? []).map((o) => o.id);
  if (ids.length === 0) return { issued: 0, errors: 0 };

  const { data: docs, error: docsError } = await admin
    .from("documents")
    .select("order_id")
    .in("order_id", ids);
  if (docsError) throw new Error(docsError.message);
  const have = new Set((docs ?? []).map((d) => d.order_id));

  let issued = 0;
  let errors = 0;
  for (const id of ids.filter((x) => !have.has(x)).slice(0, maxPerRun)) {
    try {
      const result = await issueOrderReceipt(admin, id);
      if (result === "issued") issued += 1;
    } catch (e) {
      errors += 1;
      console.error("order receipt sweep failed for order", id, e);
    }
  }
  return { issued, errors };
}
