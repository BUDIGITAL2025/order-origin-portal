/**
 * Server-side helpers for the quotes admin stack.
 * Keeps quotes.functions.ts a thin createServerFn wrapper.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type QuoteRequestRow = Database["public"]["Tables"]["quote_requests"]["Row"];

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

/** Internal-only fields, stored in the admin-only quote_request_internal table. */
export type QuoteInternal = {
  admin_notes: string | null;
  internal_reference: string | null;
};

export type AdminQuote = QuoteRequestRow & {
  profiles: AdminQuoteProfile;
  admin_notes: string | null;
  internal_reference: string | null;
};

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
export function mapQuoteForAdmin(row: unknown, internal?: QuoteInternal | null): AdminQuote {
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
  return {
    ...rest,
    profiles,
    admin_notes: internal?.admin_notes ?? null,
    internal_reference: internal?.internal_reference ?? null,
  };
}

/**
 * Flags open quote requests that breached their 48h sourcing target: stamps
 * quote_breach_notified_at and records a notification (visible to admins via
 * the notifications admin policy). Idempotent — already-stamped rows skip.
 */
export async function flagBreachedQuotes(
  admin: SupabaseClient<Database>,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: breached, error } = await admin
    .from("quote_requests")
    .select("id, store_id, product_name, product_url")
    .in("status", ["submitted", "sourcing"])
    .lt("quote_due_at", nowIso)
    .is("quote_breach_notified_at", null);
  if (error || !breached?.length) return 0;

  for (const q of breached) {
    await admin.from("notifications").insert({
      kind: "quote_sla_breach",
      store_id: q.store_id,
      title: "Quote request past its 48h target",
      body: `A quote request (${q.product_name ?? q.product_url}) is still awaiting a quote past its 48-hour sourcing target.`,
    });
    await admin
      .from("quote_requests")
      .update({ quote_breach_notified_at: nowIso })
      .eq("id", q.id);
  }
  return breached.length;
}
