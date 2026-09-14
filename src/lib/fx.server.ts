/**
 * Daily FX rates, cached in the database.
 *
 * Source: frankfurter.app (ECB reference rates, free, no key). One fetch per
 * calendar day; every attempt is logged. An admin can override a day's rate by
 * hand and that row is then treated as authoritative (manual = true).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { FxRates } from "./fx";

type Admin = SupabaseClient<Database>;

const ENDPOINT = "https://api.frankfurter.app/latest?base=USD&symbols=EUR,CNY";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toRates(row: {
  rate_date: string;
  eur: number | string;
  cny: number | string;
  source: string;
  manual: boolean;
}): FxRates {
  return {
    rate_date: row.rate_date,
    eur: Number(row.eur),
    cny: Number(row.cny),
    source: row.source,
    manual: row.manual,
  };
}

/**
 * Today's rates. Reads the cache first, fetches once a day, and falls back to
 * the most recent stored day when the provider is unreachable.
 */
export async function ensureDailyRates(admin: Admin): Promise<FxRates> {
  const date = today();
  const { data: cached } = await admin
    .from("fx_rates")
    .select("rate_date, eur, cny, source, manual")
    .eq("rate_date", date)
    .maybeSingle();
  if (cached) return toRates(cached);

  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Rate provider returned ${res.status}`);
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const eur = Number(body.rates?.["EUR"]);
    const cny = Number(body.rates?.["CNY"]);
    if (!Number.isFinite(eur) || !Number.isFinite(cny) || eur <= 0 || cny <= 0) {
      throw new Error("Rate provider returned no usable rates");
    }
    const { data: saved, error } = await admin
      .from("fx_rates")
      .upsert(
        { rate_date: date, base: "USD", eur, cny, source: "frankfurter.app", manual: false },
        { onConflict: "rate_date" },
      )
      .select("rate_date, eur, cny, source, manual")
      .single();
    if (error) throw new Error(error.message);
    await admin.from("fx_fetch_log").insert({
      rate_date: date,
      source: "frankfurter.app",
      status: "ok",
      duration_ms: Date.now() - started,
      payload: body as never,
    });
    return toRates(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rate fetch failed";
    await admin.from("fx_fetch_log").insert({
      rate_date: date,
      source: "frankfurter.app",
      status: "error",
      error: message,
      duration_ms: Date.now() - started,
    });
    const { data: last } = await admin
      .from("fx_rates")
      .select("rate_date, eur, cny, source, manual")
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) return toRates(last);
    throw new Error(`No exchange rate available: ${message}`);
  }
}

/** The rates of a specific past day, for re-reading a frozen quote. */
export async function ratesForDate(admin: Admin, date: string): Promise<FxRates | null> {
  const { data } = await admin
    .from("fx_rates")
    .select("rate_date, eur, cny, source, manual")
    .eq("rate_date", date)
    .maybeSingle();
  return data ? toRates(data) : null;
}
