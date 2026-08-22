/**
 * Server-side helpers for the quotes admin stack.
 * Keeps quotes.functions.ts a thin createServerFn wrapper.
 */
import type { Tables } from "@/integrations/supabase/types";

type QuoteRequestRow = Tables<"quote_requests">["Row"];

/** Flat profile-ish shape the admin quote pages render. */
export type AdminQuoteProfile = {
  company_name: string | null;
  contact_name: string | null;
  platform: string | null;
  store_url: string | null;
  integration_mode: string | null;
  country: string | null;
  pricing_tier: string | null;
  tier_override: string | null;
  avg_daily_units_30d: number | null;
  subscription_plan: string | null;
};

export type AdminQuote = QuoteRequestRow & { profiles: AdminQuoteProfile };

type QuoteChainStore = {
  store_name: string | null;
  store_url: string | null;
  platform: string | null;
  integration_mode: string | null;
  pricing_tier: string | null;
  tier_override: string | null;
  avg_daily_units_30d: number | null;
  subscription_plan: string | null;
  entities?: {
    legal_name: string | null;
    country: string | null;
    profiles?: { contact_name: string | null } | null;
  } | null;
};

/**
 * Maps a quote_requests row joined through the store → entity → account
 * chain back to the flat shape admin pages consume (`quote.profiles.*`),
 * with company_name carrying the entity's legal name.
 */
export function mapQuoteForAdmin(row: unknown): AdminQuote {
  const { stores, ...rest } = row as QuoteRequestRow & {
    stores?: QuoteChainStore | null;
  };
  const entity = stores?.entities ?? null;
  const profile = entity?.profiles ?? null;
  const profiles: AdminQuoteProfile = {
    company_name: entity?.legal_name ?? null,
    contact_name: profile?.contact_name ?? null,
    platform: stores?.platform ?? null,
    store_url: stores?.store_url ?? null,
    integration_mode: stores?.integration_mode ?? null,
    country: entity?.country ?? null,
    pricing_tier: stores?.pricing_tier ?? null,
    tier_override: stores?.tier_override ?? null,
    avg_daily_units_30d: stores?.avg_daily_units_30d ?? null,
    subscription_plan: stores?.subscription_plan ?? null,
  };
  return { ...rest, profiles };
}
