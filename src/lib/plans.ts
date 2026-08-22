/** Subscription plans and monthly quote quotas (mirrors the DB enforcement). */
export const PLANS = {
  basic: { label: "Basic", priceUsd: 49, quoteQuota: 5 },
  unlimited: { label: "Unlimited", priceUsd: 99, quoteQuota: null },
} as const;

export type SubscriptionPlan = keyof typeof PLANS;
export type PricingTier = "starter" | "growth" | "scale";

export const TIER_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

export function planLabel(plan: string | null | undefined): string {
  return PLANS[(plan as SubscriptionPlan) ?? "basic"]?.label ?? plan ?? "—";
}

/** Monthly quote allowance; null means unlimited. */
export function planQuota(plan: string | null | undefined): number | null {
  return PLANS[(plan as SubscriptionPlan) ?? "basic"]?.quoteQuota ?? 5;
}

/** Effective tier = manual override wins over the auto-calculated value. */
export function effectiveTier(
  pricingTier: string | null | undefined,
  tierOverride: string | null | undefined,
): PricingTier {
  return (tierOverride ?? pricingTier ?? "starter") as PricingTier;
}

/** First day of the month after the given period start — when the quota resets. */
export function quotaResetDate(periodStart: string | null | undefined): string {
  if (!periodStart) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart);
  if (!m) return "—";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const next = month === 12 ? { y: year + 1, mo: 1 } : { y: year, mo: month + 1 };
  return `01/${String(next.mo).padStart(2, "0")}/${next.y}`;
}
