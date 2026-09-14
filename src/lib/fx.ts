/**
 * Multi-currency supplier prices.
 *
 * Suppliers quote in USD, EUR or RMB (CNY). Clients only ever see USD, so
 * every amount is converted at entry time and the rate used is FROZEN onto
 * the quote line — exactly like the agent's fee tier. A published price never
 * moves again because the market moved.
 */

export const SUPPLIER_CURRENCIES = ["USD", "EUR", "CNY"] as const;
export type SupplierCurrency = (typeof SUPPLIER_CURRENCIES)[number];

export type FxRates = {
  /** Date the rates belong to, YYYY-MM-DD. */
  rate_date: string;
  /** Units of EUR per 1 USD. */
  eur: number;
  /** Units of CNY per 1 USD. */
  cny: number;
  source: string;
  manual: boolean;
};

export const CURRENCY_SYMBOL: Record<SupplierCurrency, string> = {
  USD: "$",
  EUR: "€",
  CNY: "¥",
};

export const CURRENCY_LABEL: Record<SupplierCurrency, string> = {
  USD: "USD $",
  EUR: "EUR €",
  CNY: "RMB ¥",
};

export function isSupplierCurrency(value: unknown): value is SupplierCurrency {
  return typeof value === "string" && (SUPPLIER_CURRENCIES as readonly string[]).includes(value);
}

/** How many units of `currency` one USD buys. USD is always 1. */
export function rateFor(currency: SupplierCurrency, rates: FxRates): number {
  if (currency === "USD") return 1;
  const rate = currency === "EUR" ? rates.eur : rates.cny;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No ${currency} rate available today.`);
  return rate;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert a supplier amount into USD at a given rate (units per USD). */
export function toUsd(amount: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return round2(amount);
  return round2(amount / rate);
}

export function formatCurrency(amount: number, currency: SupplierCurrency): string {
  const symbol = CURRENCY_SYMBOL[currency];
  return `${symbol}${amount.toFixed(2)}`;
}

/** "¥82.00 → $11.53 @ 7.11" — what the agent and admin see; never the client. */
export function fxNote(amount: number, currency: SupplierCurrency, rate: number): string {
  if (currency === "USD") return formatCurrency(amount, "USD");
  return `${formatCurrency(amount, currency)} → $${toUsd(amount, rate).toFixed(2)} @ ${Number(
    rate,
  ).toFixed(4)}`;
}
