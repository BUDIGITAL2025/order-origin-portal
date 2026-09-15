/**
 * Quote pricing chain — shared by the sourcing desk, the owner view and the
 * server. One place so the number a form previews is the number that is saved.
 *
 *   base          = COGS + supplier shipping        (what the fee applies to)
 *   sourcing fee  = base × fee_rate                 (0 when fee_included)
 *   sourcing cost = base + sourcing fee
 *   margin        = COGS (USD) × margin%            (never on shipping or fee)
 *   client price  = sourcing cost + margin
 *   closed price  = client price + import tax       (passthrough, never marked up)
 */
import { isEuCountry } from "./countries";

/** Logistics partner's flat per-unit IOSS VAT handling + duty charge for the EU. */
export const EU_IMPORT_PASSTHROUGH_USD = 3.5;

export const PASSTHROUGH_NOTE =
  "EU destinations: $3.50/unit flat (logistics partner's IOSS + duty charge). Bulk/MOQ shipments: leave 0 — import costs are quoted as freight on the purchase.";

export const PASSTHROUGH_SHORT_NOTE =
  "Supplier tax passes through at exact cost — never marked up.";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default import passthrough for a destination country. */
export function defaultImportTax(countryCode: string): number {
  return isEuCountry(countryCode) ? EU_IMPORT_PASSTHROUGH_USD : 0;
}

/** What the fee is charged on: goods + supplier shipping, never the tax. */
export function feeBase(cogs: number, shipping: number): number {
  return round2(cogs + shipping);
}

export function sourcingFee(cogs: number, shipping: number, feeRate: number): number {
  return round2(feeBase(cogs, shipping) * feeRate);
}

/** base + the collaborator's fee, or just the base when the fee is already inside. */
export function sourcingCostOf(args: {
  cogs: number;
  shipping: number;
  feeRate: number;
  feeIncluded?: boolean;
}): number {
  const base = feeBase(args.cogs, args.shipping);
  if (args.feeIncluded) return base;
  return round2(base + sourcingFee(args.cogs, args.shipping, args.feeRate));
}

/**
 * Owner margin in absolute dollars per unit.
 *
 * The base is the COGS in USD ONLY — shipping and the agent fee are passed
 * through at cost, never marked up.
 */
export function marginAmount(cogsUsd: number, marginPct: number): number {
  return round2(cogsUsd * (marginPct / 100));
}

/** Sell price of the goods, before the tax passthrough. */
export function sellPrice(sourcingCost: number, cogsUsd: number, marginPct: number): number {
  return round2(sourcingCost + marginAmount(cogsUsd, marginPct));
}

/** One closed number for the client: goods + ship + fee + margin + tax at cost. */
export function closedPrice(
  sourcingCost: number,
  cogsUsd: number,
  marginPct: number,
  importTax: number,
): number {
  return round2(sellPrice(sourcingCost, cogsUsd, marginPct) + importTax);
}
