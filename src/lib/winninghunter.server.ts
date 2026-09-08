/**
 * Server-only gateway for the WinningHunter API — phase 1 of the SpyMarket
 * provider migration. The TrendTrack gateway (spymarket-tools.server.ts) is
 * untouched and keeps running in parallel; this module is the ONLY place that
 * talks to app.winninghunter.com.
 *
 * Source of truth: docs/winninghunter-api-reference.md.
 *
 * Cost model (differs from TrendTrack): a flat 1 credit per successful metered
 * call, whatever the page size — so we always ask for the biggest page the
 * endpoint allows instead of trimming rows. Every call (cache hits included)
 * is written to public.spy_api_calls with provider='winninghunter'.
 *
 * Failure handling per their error docs:
 *  - 429 WITHOUT a `credits` object = rate limit → one retry after a backoff.
 *  - 429 WITH a `credits` object    = quota exhausted → stop, never retry.
 *  - 401/403/404/400 → surfaced verbatim, no retry (no credit is charged).
 */
import type { Json } from "@/integrations/supabase/types";

const BASE_URL = "https://app.winninghunter.com";
/** Ad searches: their index refreshes on a daily cadence — 24h cache. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** The credits probe itself costs a credit, so its answer is cached hard. */
const CREDITS_TTL_MS = 15 * 60 * 1000;
const PROVIDER = "winninghunter";
/** Documented ceiling: 60 requests per rolling 60s per billing account. */
export const RATE_LIMIT_PER_MIN = 60;
/** Flat price of a metered call, per the reference. */
export const CREDITS_PER_CALL = 1;

export interface WhOk<T> {
  status: "ok";
  data: T;
  rowsReturned: number;
  creditsCost: number;
  creditsRemaining: number | null;
  cacheHit: boolean;
}
export interface WhExhausted {
  status: "exhausted";
  message: string;
  remaining: number | null;
  purchaseUrl: string | null;
}
export interface WhRateLimited {
  status: "rate_limited";
  message: string;
}
export type WhResult<T> = WhOk<T> | WhExhausted | WhRateLimited;

export interface WhCallOptions {
  userId: string;
  /** Log label, e.g. "adlibrary". */
  endpoint: string;
  /** API path, e.g. "/api/v1/adlibrary". */
  path: string;
  method?: "GET" | "POST" | undefined;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: Record<string, unknown> | undefined;
  summary?: Record<string, unknown> | undefined;
  /** Default true. Nothing on the v1 surface is free except our own cache. */
  metered?: boolean | undefined;
  cacheable?: boolean | undefined;
  cacheTtlMs?: number | undefined;
  timeoutMs?: number | undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Row count across the shapes their endpoints use: `{data:[…]}` (ads),
 * `{brands:[…]}`, `{result:[…]}` (trends passthrough) or a bare array.
 */
export function whRowsOf(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const key of ["data", "brands", "result", "results", "items"]) {
      const v = rec[key];
      if (Array.isArray(v)) return v.length;
    }
  }
  return 0;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function logCall(entry: {
  userId: string;
  endpoint: string;
  summary: Record<string, unknown>;
  rowsReturned: number;
  creditsCost: number;
  creditsRemaining: number | null;
  cached: boolean;
  ok: boolean;
  statusCode?: number | undefined;
  durationMs?: number | undefined;
  error?: string | undefined;
}): Promise<void> {
  const admin = await getAdmin();
  const { error } = await admin.from("spy_api_calls").insert({
    provider: PROVIDER,
    endpoint: entry.endpoint,
    credits_cost: entry.creditsCost,
    credits_remaining: entry.creditsRemaining,
    status_code: entry.statusCode ?? null,
    ok: entry.ok,
    cached: entry.cached,
    rows_returned: entry.rowsReturned,
    duration_ms: entry.durationMs ?? null,
    summary: entry.summary as unknown as Json,
    error: entry.error ?? null,
    called_by: entry.userId,
  });
  if (error) console.error("[winninghunter] call log insert failed:", error.message);
}

/** Credits this user burned today (UTC) on WinningHunter, cache hits excluded. */
export async function getWhDayTotal(userId: string): Promise<number> {
  const admin = await getAdmin();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("spy_api_calls")
    .select("credits_cost")
    .eq("provider", PROVIDER)
    .eq("called_by", userId)
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + Number(r.credits_cost ?? 0), 0);
}

/** Credits burned today (UTC) by the whole team — the header "spent today" chip. */
export async function getWhSpentToday(): Promise<number> {
  const admin = await getAdmin();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("spy_api_calls")
    .select("credits_cost")
    .eq("provider", PROVIDER)
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + Number(r.credits_cost ?? 0), 0);
}

interface CreditsEnvelope {
  remaining: number | null;
  purchaseUrl: string | null;
}

/** Their 429/credits payloads carry a `credits` object; a rate limit does not. */
function readCreditsEnvelope(body: unknown): CreditsEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const credits = (body as Record<string, unknown>)["credits"];
  if (!credits || typeof credits !== "object") return null;
  const c = credits as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const purchase = (body as Record<string, unknown>)["purchase"];
  const url =
    purchase && typeof purchase === "object"
      ? ((purchase as Record<string, unknown>)["url"] as string | undefined)
      : undefined;
  return {
    remaining: num(c["total_remaining"]) ?? num(c["remaining"]),
    purchaseUrl: typeof url === "string" ? url : null,
  };
}

/**
 * The single WinningHunter call path. Nothing else in the app may fetch from
 * app.winninghunter.com.
 */
export async function whCall<T = Json>(opts: WhCallOptions): Promise<WhResult<T>> {
  const apiKey = process.env["WINNINGHUNTER_API_KEY"];
  if (!apiKey) throw new Error("WINNINGHUNTER_NOT_CONFIGURED");

  const metered = opts.metered !== false;
  const cacheable = opts.cacheable ?? true;
  const ttl = opts.cacheTtlMs ?? CACHE_TTL_MS;
  const summary = opts.summary ?? {};
  const cacheKey = `wh:${opts.endpoint}:${stableStringify({
    path: opts.path,
    query: opts.query ?? {},
    body: opts.body ?? {},
  })}`;

  if (cacheable) {
    const admin = await getAdmin();
    const { data: hit } = await admin
      .from("spymarket_cache")
      .select("payload, fetched_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < ttl) {
      const rows = whRowsOf(hit.payload);
      await logCall({
        userId: opts.userId,
        endpoint: opts.endpoint,
        summary,
        rowsReturned: rows,
        creditsCost: 0,
        creditsRemaining: null,
        cached: true,
        ok: true,
      });
      return {
        status: "ok",
        data: hit.payload as T,
        rowsReturned: rows,
        creditsCost: 0,
        creditsRemaining: null,
        cacheHit: true,
      };
    }
  }

  const url = new URL(`${BASE_URL}${opts.path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  };

  const timeoutMs = opts.timeoutMs ?? 30_000;
  // Fresh signal per attempt: a shared one would hand the retry an
  // almost-expired timer inherited from the first attempt.
  const doFetch = () => fetch(url.toString(), { ...init, signal: AbortSignal.timeout(timeoutMs) });

  const startedAt = Date.now();
  let res: Response;
  let bodyText: string;
  try {
    res = await doFetch();
    bodyText = await res.text();

    if (res.status === 429) {
      const parsed = safeJson(bodyText);
      const envelope = readCreditsEnvelope(parsed);
      if (envelope) {
        // Quota exhausted — retrying cannot help and burns rate-limit budget.
        await logCall({
          userId: opts.userId,
          endpoint: opts.endpoint,
          summary,
          rowsReturned: 0,
          creditsCost: 0,
          creditsRemaining: envelope.remaining,
          cached: false,
          ok: false,
          statusCode: 429,
          durationMs: Date.now() - startedAt,
          error: "credits exhausted",
        });
        return {
          status: "exhausted",
          message: errorTextOf(parsed) ?? "No WinningHunter API credits remaining.",
          remaining: envelope.remaining,
          purchaseUrl: envelope.purchaseUrl,
        };
      }
      // Rate limit: single retry after a short backoff, per their docs.
      const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      const waitMs = Math.min((Number.isFinite(retryAfter) ? retryAfter : 2) * 1000, 10_000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      res = await doFetch();
      bodyText = await res.text();
      if (res.status === 429) {
        await logCall({
          userId: opts.userId,
          endpoint: opts.endpoint,
          summary,
          rowsReturned: 0,
          creditsCost: 0,
          creditsRemaining: null,
          cached: false,
          ok: false,
          statusCode: 429,
          durationMs: Date.now() - startedAt,
          error: "rate limited (after retry)",
        });
        return {
          status: "rate_limited",
          message: `WinningHunter rate limit reached (max ${RATE_LIMIT_PER_MIN} requests per minute). No credits were charged.`,
        };
      }
    }
  } catch (err) {
    const isTimeout =
      (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) ||
      (err instanceof Error && err.name === "TimeoutError");
    await logCall({
      userId: opts.userId,
      endpoint: opts.endpoint,
      summary,
      rowsReturned: 0,
      creditsCost: 0,
      creditsRemaining: null,
      cached: false,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: isTimeout
        ? `timeout after ${Math.round(timeoutMs / 1000)}s`
        : `network: ${err instanceof Error ? err.message : String(err)}`,
    });
    if (isTimeout) throw new Error("WINNINGHUNTER_TIMEOUT");
    throw err instanceof Error ? err : new Error(String(err));
  }

  const parsed = safeJson(bodyText);

  if (!res.ok) {
    const message = errorTextOf(parsed) ?? `WinningHunter error ${res.status}`;
    await logCall({
      userId: opts.userId,
      endpoint: opts.endpoint,
      summary,
      rowsReturned: 0,
      creditsCost: 0,
      creditsRemaining: null,
      cached: false,
      ok: false,
      statusCode: res.status,
      durationMs: Date.now() - startedAt,
      error: `HTTP_${res.status}: ${message}`,
    });
    throw new Error(`WINNINGHUNTER_HTTP_${res.status}: ${message}`);
  }

  const payload = (parsed ?? {}) as T;
  const rows = whRowsOf(payload);
  const cost = metered ? CREDITS_PER_CALL : 0;
  const remaining = readCreditsEnvelope(parsed)?.remaining ?? null;

  if (cacheable) {
    const admin = await getAdmin();
    const { error } = await admin.from("spymarket_cache").upsert({
      cache_key: cacheKey,
      provider: PROVIDER,
      endpoint: opts.endpoint,
      payload: payload as unknown as Json,
      fetched_at: new Date().toISOString(),
    });
    if (error) console.error("[winninghunter] cache upsert failed:", error.message);
  }

  await logCall({
    userId: opts.userId,
    endpoint: opts.endpoint,
    summary,
    rowsReturned: rows,
    creditsCost: cost,
    creditsRemaining: remaining,
    cached: false,
    ok: true,
    statusCode: res.status,
    durationMs: Date.now() - startedAt,
  });

  return {
    status: "ok",
    data: payload,
    rowsReturned: rows,
    creditsCost: cost,
    creditsRemaining: remaining,
    cacheHit: false,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorTextOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  for (const key of ["error", "message"]) {
    const v = rec[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ad library — the four ad networks WinningHunter indexes
// ---------------------------------------------------------------------------

export type WhPlatform = "meta" | "tiktok" | "pinterest" | "google";

export const WH_AD_ENDPOINTS: Record<WhPlatform, { endpoint: string; path: string; maxLimit: number }> = {
  meta: { endpoint: "adlibrary", path: "/api/v1/adlibrary", maxLimit: 50 },
  tiktok: { endpoint: "tiktok-ads", path: "/api/v1/tiktok-ads", maxLimit: 50 },
  pinterest: { endpoint: "pinterest-ads", path: "/api/v1/pinterest-ads", maxLimit: 50 },
  google: { endpoint: "google-ads", path: "/api/v1/google-ads", maxLimit: 48 },
};

export interface WhAdSearchInput {
  platform: WhPlatform;
  keyword?: string | undefined;
  searchScope?: string | undefined;
  countries?: string | undefined;
  storeBasedIn?: string | undefined;
  sorting?: string | undefined;
  sortDirection?: "asc" | "desc" | undefined;
  mediaType?: string | undefined;
  activeStatus?: string | undefined;
  minAdSpend?: number | undefined;
  maxAdSpend?: number | undefined;
  minAdSets?: number | undefined;
  maxAdSets?: number | undefined;
  minDaysRunning?: number | undefined;
  maxDaysRunning?: number | undefined;
  minActiveAds?: number | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
  lastSeenFrom?: string | undefined;
  lastSeenTo?: string | undefined;
  limit: number;
  page?: number | undefined;
  scroll?: string | undefined;
}

/**
 * One page of ads from any of the four networks. Their param names differ per
 * platform (Google is 1-based `page`+`limit`; the rest use `scroll`), so the
 * mapping lives here and the UI stays platform-agnostic.
 */
export async function whSearchAds(
  userId: string,
  input: WhAdSearchInput,
): Promise<WhResult<Json>> {
  const spec = WH_AD_ENDPOINTS[input.platform];
  const limit = Math.min(Math.max(input.limit, 1), spec.maxLimit);
  const query: Record<string, string | number | undefined> = {};

  if (input.platform === "google") {
    query["search"] = input.keyword || undefined;
    query["searchkeyword"] = input.searchScope || undefined;
    query["page"] = input.page && input.page > 0 ? input.page : 1;
    query["limit"] = limit;
    query["sort"] = input.sorting || undefined;
    query["sort_dir"] = input.sortDirection ?? "desc";
    query["status"] = input.activeStatus || undefined;
    query["country_inc"] = input.countries || undefined;
    query["format"] = input.mediaType || undefined;
    query["date_from"] = input.createdFrom || undefined;
    query["date_to"] = input.createdTo || undefined;
    query["days_min"] = input.minDaysRunning;
    query["days_max"] = input.maxDaysRunning;
    query["adspend_min"] = input.minAdSpend;
    query["adspend_max"] = input.maxAdSpend;
  } else {
    query["keyword"] = input.keyword || undefined;
    query["searchkeyword"] = input.searchScope || undefined;
    query["countries"] = input.countries || undefined;
    query["sorting"] = input.sorting || undefined;
    query["sortdirection"] = input.sortDirection ?? "desc";
    query["page"] = input.page ?? 0;
    query["limit"] = limit;
    if (input.scroll) query["scroll"] = input.scroll;
    query["from"] = input.createdFrom || undefined;
    query["to"] = input.createdTo || undefined;
    query["fromlastseen"] = input.lastSeenFrom || undefined;
    query["tolastseen"] = input.lastSeenTo || undefined;
    query["mindays"] = input.minDaysRunning;
    query["maxdays"] = input.maxDaysRunning;

    if (input.platform === "meta") {
      // Meta `countries` is the ad-TARGETING market and 400s on MX/CO/CL/AR/PE;
      // store HQ filtering is a different parameter.
      query["store_based_in"] = input.storeBasedIn || undefined;
      query["mediafilter"] = input.mediaType || undefined;
      query["activestatus"] = input.activeStatus || undefined;
      query["minadspend"] = input.minAdSpend;
      query["maxadspend"] = input.maxAdSpend;
      query["minactiveads"] = input.minActiveAds;
      query["min"] = input.minAdSets;
      query["max"] = input.maxAdSets;
    }
    if (input.platform === "tiktok") {
      query["minadspend"] = input.minAdSpend;
      query["maxadspend"] = input.maxAdSpend;
      query["min"] = input.minAdSets;
      query["max"] = input.maxAdSets;
    }
  }

  return whCall({
    userId,
    endpoint: spec.endpoint,
    path: spec.path,
    query,
    summary: {
      platform: input.platform,
      keyword: input.keyword ?? null,
      countries: input.countries ?? null,
      limit,
      page: input.page ?? 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Status / credits
// ---------------------------------------------------------------------------

export interface WhStatus {
  configured: boolean;
  creditsRemaining: number | null;
  creditsLimit: number | null;
  spentToday: number;
  dayTotal: number;
  creditsPerCall: number;
  rateLimitPerMin: number;
  creditsCheckedAt: string | null;
}

/**
 * Header status. Their balance probe costs a credit, so it is only refreshed
 * every 15 minutes (cached like any other call) and never on a bare render
 * loop — the caller decides when to ask for a live read.
 */
export async function getWhStatus(userId: string, live: boolean): Promise<WhStatus> {
  const configured = !!process.env["WINNINGHUNTER_API_KEY"];
  const base: WhStatus = {
    configured,
    creditsRemaining: null,
    creditsLimit: null,
    spentToday: configured ? await getWhSpentToday() : 0,
    dayTotal: configured ? await getWhDayTotal(userId) : 0,
    creditsPerCall: CREDITS_PER_CALL,
    rateLimitPerMin: RATE_LIMIT_PER_MIN,
    creditsCheckedAt: null,
  };
  if (!configured || !live) return base;

  try {
    const result = await whCall<Record<string, unknown>>({
      userId,
      endpoint: "credits",
      path: "/api/v1/credits",
      summary: { probe: "credits" },
      cacheTtlMs: CREDITS_TTL_MS,
      timeoutMs: 15_000,
    });
    if (result.status !== "ok") return base;
    const credits = (result.data["credits"] ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      ...base,
      spentToday: await getWhSpentToday(),
      dayTotal: await getWhDayTotal(userId),
      creditsRemaining: num(credits["total_remaining"]) ?? num(credits["remaining"]),
      creditsLimit: num(credits["limit"]),
      creditsCheckedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[winninghunter] credits probe failed:", err instanceof Error ? err.message : err);
    return base;
  }
}
