/**
 * Every price the app sells, addressed by Stripe `lookup_key` — never by a
 * raw `price_xxx` id. Lookup keys are identical in test and live, so the same
 * code resolves the right price in either mode
 * (`stripe.prices.list({ lookup_keys: [...] })`).
 *
 * Amounts here are documentation of the intended catalogue; Stripe remains
 * the source of truth for what is actually charged.
 */
export const PRICE_CATALOGUE = {
  // Workspace subscription plans (src/lib/billing.server.ts PLAN_PRICE_IDS)
  flysales_basic: { label: "Sourcing Basic", usd: 49, interval: "month" },
  flysales_unlimited: { label: "Sourcing Unlimited", usd: 99, interval: "month" },

  // Wallet top-ups: a $1 unit price charged by quantity
  topup_unit: { label: "Wallet top-up unit", usd: 1, interval: null },

  // Intelligence module add-ons. SpyMarket's old $99/$189/$349 tiers were
  // legacy of the previous data provider and are archived in Stripe; the
  // module is a single $49/month subscription like SEO and Ads.
  module_spymarket_monthly: { label: "FlySales SpyMarket", usd: 49, interval: "month" },
  module_seo_monthly: { label: "FlySales SEO", usd: 49, interval: "month" },
  module_ads_monthly: { label: "FlySales Ads", usd: 39, interval: "month" },
  module_growth_bundle_monthly: { label: "Growth Bundle", usd: 99, interval: "month" },

  // Operational module. Fulfilment is NOT part of the Growth Bundle (that is
  // intelligence only) — it unlocks the warehouse service and is standalone.
  module_fulfilment_monthly: { label: "FlySales Fulfilment", usd: 49, interval: "month" },
} as const;

export type PriceLookupKey = keyof typeof PRICE_CATALOGUE;

export const MODULE_PRICE_IDS = {
  spymarket: "module_spymarket_monthly",
  seo: "module_seo_monthly",
  ads: "module_ads_monthly",
  bundle: "module_growth_bundle_monthly",
  fulfilment: "module_fulfilment_monthly",
} as const;
