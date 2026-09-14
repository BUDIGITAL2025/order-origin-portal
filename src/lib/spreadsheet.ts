/**
 * Supplier spreadsheet import (XLSX / CSV).
 *
 * Spreadsheets are already structured, so they are parsed directly in the
 * browser — no AI call, no cost. The user maps the columns once and lands in
 * the same review table as an AI-read catalogue.
 */
import { SUPPLIER_CURRENCIES, type SupplierCurrency } from "./fx";

export const SHEET_FIELDS = [
  { key: "item_no", label: "Item no." },
  { key: "description", label: "Name / description" },
  { key: "color", label: "Spec / material" },
  { key: "size_text", label: "Size" },
  { key: "unit_price", label: "Unit price" },
  { key: "currency", label: "Currency" },
  { key: "available_qty", label: "Quantity" },
  { key: "remark", label: "Remark" },
] as const;

export type SheetField = (typeof SHEET_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<SheetField, number>>;

const HINTS: Record<SheetField, RegExp> = {
  item_no: /^(item|item ?no|item ?#|art(icle)?|sku|code|ref|model|货号|编号)/i,
  description: /(name|product|description|desc|title|品名|名称)/i,
  color: /(spec|material|colou?r|finish|规格|材质|颜色)/i,
  size_text: /(size|dimension|measure|尺寸|规格尺寸)/i,
  unit_price: /(unit ?price|price|fob|exw|cost|单价|价格)/i,
  currency: /(currency|curr\.?|币种)/i,
  available_qty: /(qty|quantity|pcs|units|stock|数量|库存)/i,
  remark: /(remark|note|comment|status|备注|说明)/i,
};

/** Columns we deliberately ignore: the platform applies the agent's tier fee. */
const COMMISSION_HINT = /(commission|markup|mark-up|margin|profit|agent ?fee|佣金|提成|利润)/i;

const UNAVAILABLE_HINT =
  /(no ?stock|out ?of ?stock|sold ?out|unavailable|discontinued|not ?available|缺货|无货|停产|售罄)/i;

export function headerLabel(cell: unknown, index: number): string {
  const text = cell == null ? "" : String(cell).trim();
  return text || `Column ${index + 1}`;
}

/** Best-guess mapping from detected header names. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const { key } of SHEET_FIELDS) {
    const hint = HINTS[key];
    const index = headers.findIndex((h, i) => !used.has(i) && hint.test(h.trim()));
    if (index >= 0) {
      mapping[key] = index;
      used.add(index);
    }
  }
  // "Unit Price (RMB)" and friends imply the currency without a column.
  return mapping;
}

/** Headers that look like supplier commission/markup — ignored on import. */
export function commissionColumns(headers: string[]): string[] {
  return headers.filter((h) => COMMISSION_HINT.test(h));
}

/** A currency named in a header such as "Unit Price (RMB)". */
export function currencyFromHeader(header: string | undefined): SupplierCurrency | null {
  if (!header) return null;
  if (/\b(rmb|cny|yuan|¥|人民币)\b/i.test(header) || /[¥￥]/.test(header)) return "CNY";
  if (/\b(eur|euro)\b/i.test(header) || header.includes("€")) return "EUR";
  if (/\b(usd|us\$|dollar)\b/i.test(header) || header.includes("$")) return "USD";
  return null;
}

export function normaliseCurrency(value: unknown, fallback: SupplierCurrency): SupplierCurrency {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if ((SUPPLIER_CURRENCIES as readonly string[]).includes(text)) return text as SupplierCurrency;
  if (/RMB|YUAN|¥|￥/.test(text)) return "CNY";
  if (/EURO|€/.test(text)) return "EUR";
  if (/US\$|\$|DOLLAR/.test(text)) return "USD";
  return fallback;
}

/** "no stock" / "sold out" remarks import flagged, visible but excluded. */
export function isUnavailableRemark(remark: string | null | undefined): boolean {
  return !!remark && UNAVAILABLE_HINT.test(remark);
}

export function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalised =
    cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

export type SheetImportRow = {
  row_ref: string | null;
  item_no: string | null;
  description: string | null;
  color: string | null;
  size_text: string | null;
  available_qty: number | null;
  unit_price: number | null;
  currency: SupplierCurrency;
  remark: string | null;
  unavailable: boolean;
};

/** Turn raw sheet cells plus a column mapping into reviewable draft rows. */
export function buildSheetRows(args: {
  headers: string[];
  body: unknown[][];
  mapping: ColumnMapping;
  defaultCurrency: SupplierCurrency;
}): SheetImportRow[] {
  const { headers, body, mapping } = args;
  const priceHeaderCurrency =
    mapping.unit_price != null ? currencyFromHeader(headers[mapping.unit_price]) : null;
  const fallback = priceHeaderCurrency ?? args.defaultCurrency;

  const cell = (row: unknown[], key: SheetField): unknown =>
    mapping[key] == null ? null : row[mapping[key]];
  const text = (row: unknown[], key: SheetField): string | null => {
    const value = cell(row, key);
    const s = value == null ? "" : String(value).trim();
    return s || null;
  };

  const rows: SheetImportRow[] = [];
  body.forEach((raw, i) => {
    if (!raw || raw.every((c) => c == null || String(c).trim() === "")) return;
    const remark = text(raw, "remark");
    const description = text(raw, "description");
    const itemNo = text(raw, "item_no");
    if (!description && !itemNo) return;
    rows.push({
      row_ref: itemNo ?? `Row ${i + 2}`,
      item_no: itemNo,
      description,
      color: text(raw, "color"),
      size_text: text(raw, "size_text"),
      available_qty: (() => {
        const n = parseNumber(cell(raw, "available_qty"));
        return n == null ? null : Math.max(0, Math.round(n));
      })(),
      unit_price: parseNumber(cell(raw, "unit_price")),
      currency:
        mapping.currency != null ? normaliseCurrency(cell(raw, "currency"), fallback) : fallback,
      remark,
      unavailable: isUnavailableRemark(remark),
    });
  });
  return rows;
}
