/**
 * Volume-based sourcing agent fee.
 *
 * An agent's service fee falls as they deliver: 8% on their first 500 paid
 * transactions, 5% on the next 500, 3% from there on. The tiers live on the
 * agent's own row so admin can negotiate exceptions per person.
 *
 * A "paid transaction" is one settled money event the agent sourced — a stock
 * purchase whose supplier payment went out, or a per-order sale that was paid.
 * It is exactly the same anchor as the earnings ledger, so the counter and the
 * commission list always agree.
 *
 * The rate is read at QUOTING time and frozen onto the quote line, so an
 * accepted price never moves when the agent later crosses a tier.
 */

export type FeeTier = {
  /** Cumulative transaction count this tier covers up to; null = forever. */
  upto: number | null;
  /** Fee as a fraction of the supplier price, e.g. 0.08. */
  rate: number;
};

export const DEFAULT_FEE_TIERS: FeeTier[] = [
  { upto: 500, rate: 0.08 },
  { upto: 1000, rate: 0.05 },
  { upto: null, rate: 0.03 },
];

/** Tolerant read of the jsonb column — falls back to the standard terms. */
export function parseFeeTiers(value: unknown): FeeTier[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_FEE_TIERS;
  const tiers: FeeTier[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const rate = Number(t["rate"]);
    if (!Number.isFinite(rate) || rate < 0) continue;
    const uptoRaw = t["upto"];
    const upto =
      uptoRaw === null || uptoRaw === undefined || uptoRaw === "" ? null : Number(uptoRaw);
    tiers.push({ upto: upto != null && Number.isFinite(upto) ? upto : null, rate });
  }
  if (!tiers.length) return DEFAULT_FEE_TIERS;
  // Bounded tiers ascending, the open-ended one last.
  tiers.sort((a, b) => (a.upto ?? Number.POSITIVE_INFINITY) - (b.upto ?? Number.POSITIVE_INFINITY));
  return tiers;
}

/** The rate that applies to the agent's NEXT transaction. */
export function rateForCount(tiers: FeeTier[], count: number): number {
  for (const tier of tiers) {
    if (tier.upto == null || count < tier.upto) return tier.rate;
  }
  return tiers[tiers.length - 1]?.rate ?? 0;
}

export type TierProgress = {
  rate: number;
  count: number;
  /** Threshold that ends the current tier, null when it runs forever. */
  nextAt: number | null;
  /** Rate after that threshold, null when there is no next tier. */
  nextRate: number | null;
  remaining: number | null;
  /** 0–1 progress inside the current tier, for a bar. */
  progress: number;
};

export function tierProgress(tiers: FeeTier[], count: number): TierProgress {
  const list = tiers.length ? tiers : DEFAULT_FEE_TIERS;
  const rate = rateForCount(list, count);
  const index = list.findIndex((t) => t.upto == null || count < t.upto);
  const current = list[index === -1 ? list.length - 1 : index];
  const next = index === -1 ? undefined : list[index + 1];
  const floor = index <= 0 ? 0 : (list[index - 1]?.upto ?? 0);
  const nextAt = current?.upto ?? null;
  const remaining = nextAt == null ? null : Math.max(0, nextAt - count);
  const span = nextAt == null ? 0 : nextAt - floor;
  return {
    rate,
    count,
    nextAt,
    nextRate: nextAt == null ? null : (next?.rate ?? null),
    remaining,
    progress: span > 0 ? Math.min(1, Math.max(0, (count - floor) / span)) : 1,
  };
}

export function pct(rate: number): string {
  const n = rate * 100;
  return `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}%`;
}

/** "8% first 500 orders, 5% next 500, 3% thereafter" */
export function tierTermsSentence(tiers: FeeTier[]): string {
  const list = tiers.length ? tiers : DEFAULT_FEE_TIERS;
  const parts: string[] = [];
  let floor = 0;
  list.forEach((tier, i) => {
    if (tier.upto == null) {
      parts.push(`${pct(tier.rate)} thereafter`);
      return;
    }
    const span = tier.upto - floor;
    parts.push(
      i === 0 ? `${pct(tier.rate)} first ${span} orders` : `${pct(tier.rate)} next ${span}`,
    );
    floor = tier.upto;
  });
  return parts.join(", ");
}
