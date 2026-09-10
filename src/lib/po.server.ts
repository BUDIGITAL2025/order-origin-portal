/**
 * Purchase Orders — server-only.
 *
 * A PO is the SUPPLIER-facing execution of a stock purchase that the client
 * has already paid for. Hard rules encoded here:
 *   - a PO can only exist for a purchase whose wallet payment settled;
 *   - the document carries ONLY supplier-layer money (the agreed EXW unit
 *     price from the quote), never the client price, freight, import or the
 *     margin;
 *   - it carries no client identity. PATH A ships to our warehouse; PATH B
 *     shows the bare delivery address, and the consignee company name only
 *     when an admin explicitly toggles `reveal_consignee` on that purchase.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { round2 } from "./admin.server";
import { LEGAL_ENTITY_NAME } from "./legal-entity";

type Admin = SupabaseClient<Database>;

export const PURCHASE_DOCS_BUCKET = "purchase-docs";

export const DEFAULT_PAYMENT_TERMS =
  "30% deposit on order confirmation, 70% balance before shipment.";

/** Internal states that the client must never see; they all read as "paid". */
export const INTERNAL_PURCHASE_STATES = [
  "po_sent",
  "invoice_uploaded",
  "invoice_verified",
  "invoice_discrepancy",
  "supplier_paid",
] as const;

export type InternalPurchaseState = (typeof INTERNAL_PURCHASE_STATES)[number];

/** The neutral state a client is allowed to see for a purchase. */
export function publicPurchaseStatus(status: string): string {
  return (INTERNAL_PURCHASE_STATES as readonly string[]).includes(status) ? "paid" : status;
}

export const INTERNAL_STATUS_LABELS: Record<string, string> = {
  paid: "Paid by client",
  po_sent: "PO sent",
  invoice_uploaded: "Invoice uploaded",
  invoice_verified: "Invoice verified",
  invoice_discrepancy: "Invoice discrepancy",
  supplier_paid: "Supplier paid",
  in_production: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
};

/** Where a purchase stands in the internal PO chain, for ordering/gating. */
export const INTERNAL_STEPS = [
  "paid",
  "po_sent",
  "invoice_uploaded",
  "invoice_verified",
  "supplier_paid",
  "in_production",
  "shipped",
  "delivered",
] as const;

// ---------- Config ----------

export interface IssuerConfig {
  name: string;
  addressLines: string[];
  taxId: string;
}

export function getIssuerConfig(): IssuerConfig {
  return {
    name: process.env["SUPPLIER_LEGAL_NAME"]?.trim() || LEGAL_ENTITY_NAME,
    addressLines: (process.env["SUPPLIER_ADDRESS"] ?? "")
      .split(/\r?\n/)
      .flatMap((line) => line.split(";"))
      .map((line) => line.trim())
      .filter(Boolean),
    taxId: process.env["SUPPLIER_TAX_ID"]?.trim() || "",
  };
}

/** Warehouse address POs ship to on PATH A. */
export function warehouseAddressLines(): string[] {
  const raw = process.env["WAREHOUSE_ADDRESS"] ?? "";
  const lines = raw
    .split(/\r?\n/)
    .flatMap((l) => l.split(";"))
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : ["FlySales fulfilment warehouse", "Address supplied on request"];
}

export async function getPaymentTermsDefault(admin: Admin): Promise<string> {
  const { data } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", "po_payment_terms")
    .maybeSingle();
  return data?.value?.trim() || DEFAULT_PAYMENT_TERMS;
}

// ---------- Timeline ----------

export async function logPurchaseEvent(
  admin: Admin,
  args: {
    purchaseId: string;
    event: string;
    detail?: string | null;
    actorId?: string | null;
    actorRole: "agent" | "admin" | "system";
  },
): Promise<void> {
  try {
    await admin.from("purchase_events").insert({
      purchase_id: args.purchaseId,
      event: args.event,
      detail: args.detail ?? null,
      actor_id: args.actorId ?? null,
      actor_role: args.actorRole,
    });
  } catch (e) {
    console.error("[po] event log failed", args.event, e);
  }
}

export async function nextPoNumber(admin: Admin): Promise<string> {
  const { data, error } = await admin.rpc("generate_po_number");
  if (error || !data) throw new Error(error?.message ?? "Could not generate a PO number");
  return data as string;
}

// ---------- PDF ----------

const PAGE_W = 595.28;
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

function s(value: unknown): string {
  // Helvetica only speaks WinAnsi, so fold the common typographic characters
  // (em dash, curly quotes, ellipsis) to plain ASCII before stripping the rest.
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]|[\x80-\x9F]/g, "?");
}

function poDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
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

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = s(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 6);
}

export interface PoLine {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrderData {
  poNumber: string;
  issuedAt: Date;
  supplier: {
    name: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    addressLines: string[];
  };
  lines: PoLine[];
  leadDays: number | null;
  paymentTerms: string;
  incoterms: string;
  deliveryLabel: string;
  deliveryLines: string[];
  notes?: string | null;
}

export function poTotal(lines: PoLine[]): number {
  return round2(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
}

/**
 * Renders the branded, English purchase order. Everything drawn here is
 * supplier-layer only — there is deliberately no client block on this page.
 */
export async function renderPurchaseOrderPdf(data: PurchaseOrderData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const issuer = getIssuerConfig();

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const colDesc = MARGIN + 6;
  const colSku = 300;
  const qtyRight = 400;
  const unitRight = 480;
  const amountRight = RIGHT - 6;

  // Header
  let y = PAGE_H - MARGIN;
  page.drawText("FlySales", { x: MARGIN, y: y - 18, size: 20, font: bold, color: ACCENT });
  let sy = y - 14;
  drawRight(page, issuer.name, RIGHT, sy, bold, 10);
  sy -= 13;
  for (const line of issuer.addressLines) {
    drawRight(page, line, RIGHT, sy, regular, 8.5, MUTED);
    sy -= 11;
  }
  if (issuer.taxId) {
    drawRight(page, `Tax ID: ${issuer.taxId}`, RIGHT, sy, regular, 8.5, MUTED);
    sy -= 11;
  }
  y -= 46;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1.5, color: ACCENT });
  y -= 32;

  page.drawText("PURCHASE ORDER", { x: MARGIN, y: y - 12, size: 15, font: bold, color: INK });
  drawRight(page, data.poNumber, RIGHT, y - 10, bold, 12, ACCENT);
  y -= 42;

  // Meta (left) / supplier (right)
  const blockTop = y;
  const meta: Array<[string, string]> = [
    ["PO number", data.poNumber],
    ["Issue date", poDate(data.issuedAt)],
    ["Incoterms", data.incoterms],
    ["Production lead time", data.leadDays ? `${data.leadDays} days` : "As agreed"],
  ];
  for (const [label, value] of meta) {
    page.drawText(s(label), { x: MARGIN, y, size: 8.5, font: regular, color: MUTED });
    page.drawText(fit(value, bold, 9.5, 200), {
      x: MARGIN + 120,
      y,
      size: 9.5,
      font: bold,
      color: INK,
    });
    y -= 15;
  }

  let by = blockTop;
  drawRight(page, "SUPPLIER", RIGHT, by, bold, 8.5, MUTED);
  by -= 14;
  drawRight(page, fit(data.supplier.name, bold, 10, 220), RIGHT, by, bold, 10);
  by -= 13;
  for (const line of [
    data.supplier.contactName,
    data.supplier.email,
    data.supplier.phone,
    ...data.supplier.addressLines,
  ]) {
    if (!line) continue;
    drawRight(page, fit(line, regular, 9, 220), RIGHT, by, regular, 9, MUTED);
    by -= 12;
  }
  y = Math.min(y, by) - 24;

  // Delivery block (never a client company name unless revealed)
  page.drawText(data.deliveryLabel.toUpperCase(), {
    x: MARGIN,
    y,
    size: 8.5,
    font: bold,
    color: MUTED,
  });
  y -= 14;
  for (const line of data.deliveryLines) {
    page.drawText(fit(line, regular, 9.5, 300), {
      x: MARGIN,
      y,
      size: 9.5,
      font: regular,
      color: INK,
    });
    y -= 12;
  }
  y -= 16;

  // Line items
  page.drawRectangle({ x: MARGIN, y: y - 6, width: RIGHT - MARGIN, height: 20, color: BAND });
  page.drawText("Item", { x: colDesc, y, size: 8.5, font: bold, color: MUTED });
  page.drawText("SKU", { x: colSku, y, size: 8.5, font: bold, color: MUTED });
  drawRight(page, "Qty", qtyRight, y, bold, 8.5, MUTED);
  drawRight(page, "Unit price", unitRight, y, bold, 8.5, MUTED);
  drawRight(page, "Amount", amountRight, y, bold, 8.5, MUTED);
  y -= 26;

  for (const line of data.lines) {
    page.drawText(fit(line.description, regular, 9.5, colSku - colDesc - 12), {
      x: colDesc,
      y,
      size: 9.5,
      font: regular,
      color: INK,
    });
    page.drawText(fit(line.sku || "-", regular, 8.5, 90), {
      x: colSku,
      y,
      size: 8.5,
      font: regular,
      color: MUTED,
    });
    drawRight(page, String(line.quantity), qtyRight, y, regular, 9.5);
    drawRight(page, money(line.unitPrice), unitRight, y, regular, 9.5);
    drawRight(page, money(round2(line.quantity * line.unitPrice)), amountRight, y, regular, 9.5);
    y -= 11;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: RIGHT, y },
      thickness: 0.5,
      color: HAIRLINE,
    });
    y -= 9;
  }

  y -= 4;
  page.drawText("Total (USD)", { x: colSku, y, size: 10.5, font: bold, color: INK });
  drawRight(page, money(poTotal(data.lines)), amountRight, y, bold, 10.5);
  y -= 30;

  // Terms
  page.drawText("PAYMENT TERMS", { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  for (const line of wrap(data.paymentTerms, regular, 9.5, RIGHT - MARGIN)) {
    page.drawText(line, { x: MARGIN, y, size: 9.5, font: regular, color: INK });
    y -= 12;
  }
  y -= 10;
  page.drawText("DELIVERY TERMS", { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  for (const line of wrap(
    `${data.incoterms}. Goods are collected by our appointed forwarder; please advise readiness, carton dimensions and gross weight before pickup.`,
    regular,
    9.5,
    RIGHT - MARGIN,
  )) {
    page.drawText(line, { x: MARGIN, y, size: 9.5, font: regular, color: INK });
    y -= 12;
  }

  if (data.notes) {
    y -= 10;
    page.drawText("NOTES", { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
    y -= 14;
    for (const line of wrap(data.notes, regular, 9.5, RIGHT - MARGIN)) {
      page.drawText(line, { x: MARGIN, y, size: 9.5, font: regular, color: INK });
      y -= 12;
    }
  }

  // Footer
  page.drawLine({
    start: { x: MARGIN, y: 70 },
    end: { x: RIGHT, y: 70 },
    thickness: 0.5,
    color: HAIRLINE,
  });
  page.drawText(s(`${issuer.name} · Purchase order ${data.poNumber}`), {
    x: MARGIN,
    y: 52,
    size: 8,
    font: regular,
    color: MUTED,
  });
  page.drawText("Please confirm acceptance of this purchase order by reply.", {
    x: MARGIN,
    y: 41,
    size: 8,
    font: regular,
    color: MUTED,
  });

  return doc.save();
}
