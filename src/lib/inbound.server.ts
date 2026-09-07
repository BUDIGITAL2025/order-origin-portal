/**
 * Inbound shipments & stock-in fulfilment — server-only helpers.
 *
 * Client declares what is coming in, our warehouse counts it, and the service
 * fee is charged from the wallet on COUNTED pieces via the single-writer
 * wallet function (reference `inbound:<shipment id>` → charged once, ever).
 *
 * Nothing here touches the per-order dropship flow.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { round2 } from "./admin.server";

type Admin = SupabaseClient<Database>;

/** Service fee per piece (unloading, counting, packaging materials, storage). */
export const SERVICE_FEE_PER_PIECE = 0.5;
/** Optional quality control, chosen per shipment at declaration. */
export const QC_FEE_PER_PIECE = 0.2;
/** Minimum units per variation accepted on an inbound shipment. */
export const MIN_UNITS_PER_VARIATION = 10;

export function inboundFee(pieces: number, qc: boolean): number {
  return round2(pieces * (SERVICE_FEE_PER_PIECE + (qc ? QC_FEE_PER_PIECE : 0)));
}

export function inboundWalletReference(shipmentId: string): string {
  return `inbound:${shipmentId}`;
}

// ---------- Code 128 (subset B) ----------

const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

/** Bar widths (modules) for a Code128-B encoding of `value`. */
function code128bBars(value: string): number[] {
  const chars = value.replace(/[^\x20-\x7E]/g, "");
  const codes: number[] = [104]; // START B
  let sum = 104;
  chars.split("").forEach((ch, i) => {
    const v = ch.charCodeAt(0) - 32;
    codes.push(v);
    sum += v * (i + 1);
  });
  codes.push(sum % 103); // checksum
  codes.push(106); // STOP
  const bars: number[] = [];
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0]!;
    for (const digit of pattern) bars.push(Number(digit));
  }
  return bars;
}

export interface LabelLine {
  sku: string;
  product_name: string;
  quantity: number;
}

/**
 * One printable label per SKU/variation: FS- SKU as text plus a Code 128
 * barcode, product name, quantity block and the warehouse reference.
 */
export async function renderLabelsPdf(args: {
  shipmentRef: string;
  warehouseReference: string;
  workspaceName: string;
  lines: LabelLine[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 283.46; // 100mm
  const H = 425.2; // 150mm
  const ink = rgb(0.08, 0.09, 0.12);
  const muted = rgb(0.42, 0.45, 0.52);

  const clean = (t: string) => t.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

  for (const line of args.lines) {
    const page = doc.addPage([W, H]);
    let y = H - 34;

    page.drawText(clean(args.warehouseReference), {
      x: 18, y, size: 9, font: bold, color: muted,
    });
    y -= 26;

    const name = clean(line.product_name);
    const wrapped: string[] = [];
    let current = "";
    for (const word of name.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (bold.widthOfTextAtSize(next, 13) > W - 36 && current) {
        wrapped.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) wrapped.push(current);
    for (const l of wrapped.slice(0, 3)) {
      page.drawText(l, { x: 18, y, size: 13, font: bold, color: ink });
      y -= 17;
    }

    y -= 16;
    page.drawText("SKU", { x: 18, y, size: 8, font: regular, color: muted });
    y -= 20;
    page.drawText(clean(line.sku), { x: 18, y, size: 20, font: bold, color: ink });

    // Barcode
    y -= 96;
    const bars = code128bBars(line.sku);
    const totalModules = bars.reduce((a, b) => a + b, 0);
    const moduleW = (W - 36) / totalModules;
    let x = 18;
    let dark = true;
    const barH = 74;
    for (const width of bars) {
      if (dark) {
        page.drawRectangle({ x, y, width: width * moduleW, height: barH, color: ink });
      }
      x += width * moduleW;
      dark = !dark;
    }

    y -= 22;
    page.drawText(clean(line.sku), { x: 18, y, size: 9, font: regular, color: muted });

    y -= 34;
    page.drawRectangle({
      x: 18, y: y - 12, width: W - 36, height: 44,
      borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 1,
    });
    page.drawText("QUANTITY", { x: 28, y: y + 18, size: 8, font: regular, color: muted });
    page.drawText(`${line.quantity} units`, { x: 28, y, size: 17, font: bold, color: ink });

    y -= 40;
    page.drawText(clean(`Shipment ${args.shipmentRef} · ${args.workspaceName}`), {
      x: 18, y, size: 8, font: regular, color: muted,
    });
  }

  return doc.save();
}

/** SKU list matching the declaration, for the supplier. */
export function buildSkuCsv(lines: LabelLine[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    ["SKU", "Product", "Quantity"].join(","),
    ...lines.map((l) => [esc(l.sku), esc(l.product_name), String(l.quantity)].join(",")),
  ];
  return rows.join("\r\n");
}

/**
 * Payment receipt for the inbound service fee. Keyed on the wallet reference,
 * so a replayed confirmation never issues a second document.
 */
export async function issueInboundFeeReceipt(
  admin: Admin,
  shipmentId: string,
): Promise<"issued" | "exists" | "skipped"> {
  const { data: shipment, error } = await admin
    .from("inbound_shipments")
    .select("id, entity_id, store_id, counted_pieces, fee_charged, qc, wallet_reference, completed_at")
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shipment || !shipment.fee_charged || Number(shipment.fee_charged) <= 0) return "skipped";

  const reference = shipment.wallet_reference ?? inboundWalletReference(shipmentId);
  const { data: existing } = await admin
    .from("documents")
    .select("id")
    .eq("payment_reference", reference)
    .maybeSingle();
  if (existing) return "exists";

  const { issueInboundReceiptDocument } = await import("./documents.server");
  return issueInboundReceiptDocument(admin, {
    entityId: shipment.entity_id,
    storeId: shipment.store_id,
    reference,
    pieces: shipment.counted_pieces ?? 0,
    qc: shipment.qc,
    amount: Number(shipment.fee_charged),
    paidAt: shipment.completed_at ? new Date(shipment.completed_at) : new Date(),
  });
}
