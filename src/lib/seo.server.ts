/**
 * Server-only gateway for the DataForSEO v3 API — the FlySales SEO research
 * module (admin-only, internal use under our own account). EVERY call goes
 * through dataforseoCall(): HTTP Basic auth, 30s timeout, response cache with
 * a per-data-type TTL, full usage logging with the REAL cost DataForSEO
 * returns in the response envelope, and a per-user daily soft spend cap.
 *
 * Cost model: never estimated after the fact. Before firing we show the
 * published price (or the learned average from our own log once we have real
 * observations for that endpoint); after firing we record the exact `cost`
 * field DataForSEO returns. Cache hits cost exactly zero.
 *
 * The browser never talks to DataForSEO directly.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const BASE_URL = "https://api.dataforseo.com";
const TIMEOUT_MS = 30_000;

/** Per-user soft limit in USD. Beyond this every paid call needs a confirm. */
export const DAILY_SOFT_LIMIT_USD = 5;

/** TTL per data type, as agreed for Phase 1. */
export const TTL = {
  serp: 24 * 60 * 60 * 1000,
  keywords: 7 * 24 * 60 * 60 * 1000,
  domain: 7 * 24 * 60 * 60 * 1000,
  backlinks: 7 * 24 * 60 * 60 * 1000,
  /** Locations/languages never change meaningfully — cache ~1 year. */
  permanent: 365 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Published prices (USD) from docs/dataforseo-api-reference.md, used ONLY for
 * the "this will cost" hint before the first real observation lands in our
 * log. Once we have real data the learned average wins.
 */
export const PUBLISHED_PRICE: Record<string, number> = {
  "dataforseo_labs/google/domain_rank_overview/live": 0.012,
  "keywords_data/google_ads/search_volume/live": 0.09,
  "keywords_data/google_ads/keywords_for_keywords/live": 0.09,
  "serp/google/organic/live/advanced": 0.0025,
  // Phase 2 — competitor intelligence (Labs) and backlinks.
  "dataforseo_labs/google/competitors_domain/live": 0.012,
  "dataforseo_labs/google/domain_intersection/live": 0.012,
  "dataforseo_labs/google/ranked_keywords/live": 0.012,
  "backlinks/summary/live": 0.024,
  "backlinks/backlinks/live": 0.024,
  "backlinks/referring_domains/live": 0.024,
  "backlinks/anchors/live": 0.024,
  // Phase 3 — OnPage crawl. Billed once, at task_post, per crawled page
  // ($0.00015/page basic). 50 pages is the study's cap.
  "on_page/task_post": 0.0075,
};


/**
 * Per-returned-row surcharge (USD). Labs endpoints bill $0.00012/item, the
 * Backlinks list family $0.000036/row. Used only for the pre-flight estimate —
 * the charged figure always comes from the API envelope.
 */
export const PER_ITEM_PRICE: Record<string, number> = {
  "dataforseo_labs/google/domain_rank_overview/live": 0.00012,
  "dataforseo_labs/google/competitors_domain/live": 0.00012,
  "dataforseo_labs/google/domain_intersection/live": 0.00012,
  "dataforseo_labs/google/ranked_keywords/live": 0.00012,
  "backlinks/backlinks/live": 0.000036,
  "backlinks/referring_domains/live": 0.000036,
  "backlinks/anchors/live": 0.000036,
};

/** Pre-flight estimate for an endpoint asked to return up to `limit` rows. */
export async function estimateFor(endpoint: string, limit = 0): Promise<number> {
  const base = await priceFor(endpoint);
  const perItem = PER_ITEM_PRICE[endpoint] ?? 0;
  return round6(base + perItem * limit);
}

export interface SeoOk<T = JsonValue> {
  status: "ok";
  data: T;
  cost: number;
  cacheHit: boolean;
  balance: number | null;
}
export interface SeoConfirm {
  status: "confirm";
  spentToday: number;
  estimatedCost: number;
  limit: number;
}
export type SeoResult<T = JsonValue> = SeoOk<T> | SeoConfirm;

export interface CallOptions {
  userId: string;
  /** Log label / cache key prefix, e.g. "serp/google/organic/live/advanced". */
  endpoint: string;
  /** Full path after the base URL, e.g. "/v3/serp/google/organic/live/advanced". */
  path: string;
  method?: "GET" | "POST";
  /** DataForSEO task object — wrapped in an array for POST endpoints. */
  task?: Record<string, unknown>;
  /** Compact description stored in the usage log. */
  summary?: Record<string, JsonValue>;
  /** Cache lifetime; 0 disables caching. */
  ttlMs: number;
  /** false for the free endpoints (user_data, locations). */
  metered?: boolean;
  /** Price shown to the user before firing — used for the soft-cap check. */
  estimatedCost?: number;
  /** User accepted going past the daily soft cap. */
  confirmOverage?: boolean;
  /**
   * Async task endpoints (OnPage `task_post`) carry the task id on the task
   * envelope and leave `result` null. Set this to receive the envelope.
   */
  returnTaskEnvelope?: boolean;
}


// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
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

async function hashPayload(endpoint: string, payload: unknown): Promise<string> {
  const text = `${endpoint}|${stableStringify(payload)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function authHeader(): string {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login || !password) {
    throw new Error("DataForSEO credentials are not configured.");
  }
  return `Basic ${btoa(`${login}:${password}`)}`;
}

export function hasCredentials(): boolean {
  return Boolean(process.env["DATAFORSEO_LOGIN"] && process.env["DATAFORSEO_PASSWORD"]);
}

/** USD spent today (UTC) by this user; cache hits are zero and don't count. */
export async function getUserDaySpend(userId: string): Promise<number> {
  const admin = await getAdmin();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("seo_api_calls")
    .select("cost")
    .eq("called_by", userId)
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(error.message);
  return round6((data ?? []).reduce((s, r) => s + Number(r.cost ?? 0), 0));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

async function logCall(entry: {
  userId: string;
  endpoint: string;
  payloadHash: string;
  cost: number;
  status: string;
  cached: boolean;
  durationMs: number;
  summary: Record<string, JsonValue>;
}): Promise<void> {
  const admin = await getAdmin();
  const { error } = await admin.from("seo_api_calls").insert({
    endpoint: entry.endpoint,
    payload_hash: entry.payloadHash,
    cost: entry.cost,
    status: entry.status,
    cached: entry.cached,
    duration_ms: entry.durationMs,
    summary: entry.summary as never,
    called_by: entry.userId,
  });
  if (error) console.error("[seo] usage log insert failed:", error.message);
}

/** Learned average real cost per call for an endpoint (from our own log). */
export async function getLearnedCosts(): Promise<Record<string, number>> {
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("seo_api_calls")
    .select("endpoint, cost")
    .eq("cached", false)
    .eq("status", "ok")
    .gt("cost", 0)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[seo] learned cost read failed:", error.message);
    return {};
  }
  const acc: Record<string, { sum: number; n: number }> = {};
  for (const row of data ?? []) {
    const key = row.endpoint;
    const bucket = acc[key] ?? { sum: 0, n: 0 };
    bucket.sum += Number(row.cost);
    bucket.n += 1;
    acc[key] = bucket;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = round6(v.sum / v.n);
  return out;
}

/** What we tell the user a call will cost, before firing it. */
export async function priceFor(endpoint: string): Promise<number> {
  const learned = await getLearnedCosts();
  return learned[endpoint] ?? PUBLISHED_PRICE[endpoint] ?? 0;
}

// ---------------------------------------------------------------------------
// the gateway
// ---------------------------------------------------------------------------

interface Envelope {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{
    id?: string;
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: unknown;
  }>;

}

export async function dataforseoCall<T = JsonValue>(opts: CallOptions): Promise<SeoResult<T>> {
  const {
    userId,
    endpoint,
    path,
    method = "POST",
    task,
    summary = {},
    ttlMs,
    metered = true,
    estimatedCost = 0,
    confirmOverage = false,
  } = opts;

  const payloadHash = await hashPayload(endpoint, task ?? {});
  const admin = await getAdmin();

  // 1. Cache — free, always checked first.
  if (ttlMs > 0) {
    const { data: hit } = await admin
      .from("seo_cache")
      .select("response, expires_at")
      .eq("endpoint", endpoint)
      .eq("payload_hash", payloadHash)
      .maybeSingle();
    if (hit && new Date(hit.expires_at).getTime() > Date.now()) {
      await logCall({
        userId,
        endpoint,
        payloadHash,
        cost: 0,
        status: "ok",
        cached: true,
        durationMs: 0,
        summary,
      });
      return { status: "ok", data: hit.response as T, cost: 0, cacheHit: true, balance: null };
    }
  }

  // 2. Daily soft cap — only paid calls are gated.
  if (metered) {
    const spentToday = await getUserDaySpend(userId);
    if (spentToday + estimatedCost > DAILY_SOFT_LIMIT_USD && !confirmOverage) {
      return {
        status: "confirm",
        spentToday,
        estimatedCost,
        limit: DAILY_SOFT_LIMIT_USD,
      };
    }
  }

  // 3. Live call.
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let envelope: Envelope;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      ...(method === "POST" && task ? { body: JSON.stringify([task]) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      envelope = JSON.parse(text) as Envelope;
    } catch {
      throw new Error(`DataForSEO returned a non-JSON response (${res.status}).`);
    }
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "DataForSEO timed out after 30s."
        : err instanceof Error
          ? err.message
          : "DataForSEO request failed.";
    await logCall({
      userId,
      endpoint,
      payloadHash,
      cost: 0,
      status: "error",
      cached: false,
      durationMs: Date.now() - started,
      summary: { ...summary, error: message },
    });
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }

  // 4. Real cost from the API's own field — never estimated.
  const cost = round6(Number(envelope.cost ?? 0));
  const taskEntry = envelope.tasks?.[0];
  // 20000 = done. 20100 = "Task Created": the async OnPage flow's success code,
  // where the payload is the task id and the result arrives on a later poll.
  const okCodes = new Set([20000, 20100]);
  const ok = okCodes.has(envelope.status_code ?? 0) && okCodes.has(taskEntry?.status_code ?? 20000);

  await logCall({
    userId,
    endpoint,
    payloadHash,
    cost,
    status: ok ? "ok" : "error",
    cached: false,
    durationMs: Date.now() - started,
    summary: ok
      ? summary
      : {
          ...summary,
          error: taskEntry?.status_message ?? envelope.status_message ?? "unknown error",
        },
  });

  if (!ok) {
    throw new Error(
      taskEntry?.status_message ?? envelope.status_message ?? "DataForSEO request failed.",
    );
  }

  const result = (opts.returnTaskEnvelope
    ? ((taskEntry ?? null) as unknown)
    : (taskEntry?.result ?? null)) as T;


  if (ttlMs > 0) {
    const { error: cacheErr } = await admin.from("seo_cache").upsert(
      {
        endpoint,
        payload_hash: payloadHash,
        response: result as never,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      },
      { onConflict: "endpoint,payload_hash" },
    );
    if (cacheErr) console.error("[seo] cache upsert failed:", cacheErr.message);
  }

  return { status: "ok", data: result, cost, cacheHit: false, balance: null };
}

// ---------------------------------------------------------------------------
// free endpoints
// ---------------------------------------------------------------------------

/** Free: account balance from /v3/appendix/user_data (6 req/min). */
export async function getBalance(): Promise<number | null> {
  if (!hasCredentials()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${BASE_URL}/v3/appendix/user_data`, {
      headers: { Authorization: authHeader() },
      signal: controller.signal,
    });
    const json = (await res.json()) as Envelope;
    const result = json.tasks?.[0]?.result as Array<Record<string, unknown>> | undefined;
    const money = result?.[0]?.["money"] as Record<string, unknown> | undefined;
    const balance = money?.["balance"];
    return typeof balance === "number" ? balance : null;
  } catch (err) {
    console.error("[seo] balance read failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface SeoLocation {
  code: number;
  name: string;
  countryCode: string | null;
}

/** Free: country-level locations, cached permanently in seo_cache. */
export async function getLocations(userId: string): Promise<SeoLocation[]> {
  const res = await dataforseoCall<Array<Record<string, JsonValue>>>({
    userId,
    endpoint: "serp/google/locations",
    path: "/v3/serp/google/locations",
    method: "GET",
    ttlMs: TTL.permanent,
    metered: false,
    summary: { kind: "locations" },
  });
  if (res.status !== "ok") return [];
  const rows = Array.isArray(res.data) ? res.data : [];
  return rows
    .filter((r) => r["location_type"] === "Country")
    .map((r) => ({
      code: Number(r["location_code"]),
      name: String(r["location_name"]),
      countryCode: (r["country_iso_code"] as string | null) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// usage dashboard
// ---------------------------------------------------------------------------

export interface UsageRow {
  id: string;
  endpoint: string;
  cost: number;
  status: string;
  cached: boolean;
  durationMs: number | null;
  summary: Record<string, JsonValue>;
  createdAt: string;
}

export interface UsageDashboard {
  balance: number | null;
  spentToday: number;
  spentTotal: number;
  dailyLimit: number;
  cacheHitRate: number;
  totalCalls: number;
  byDay: Array<{ day: string; cost: number; calls: number; cached: number }>;
  byEndpoint: Array<{ endpoint: string; cost: number; calls: number; cached: number }>;
  recent: UsageRow[];
  learnedCosts: Record<string, number>;
}

export async function getUsageDashboard(userId: string): Promise<UsageDashboard> {
  const admin = await getAdmin();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("seo_api_calls")
    .select("id, endpoint, cost, status, cached, duration_ms, summary, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const byDay = new Map<string, { cost: number; calls: number; cached: number }>();
  const byEndpoint = new Map<string, { cost: number; calls: number; cached: number }>();
  let spentTotal = 0;
  let cachedCount = 0;
  for (const r of rows) {
    const cost = Number(r.cost ?? 0);
    spentTotal += cost;
    if (r.cached) cachedCount += 1;
    const day = r.created_at.slice(0, 10);
    const d = byDay.get(day) ?? { cost: 0, calls: 0, cached: 0 };
    d.cost += cost;
    d.calls += 1;
    if (r.cached) d.cached += 1;
    byDay.set(day, d);
    const e = byEndpoint.get(r.endpoint) ?? { cost: 0, calls: 0, cached: 0 };
    e.cost += cost;
    e.calls += 1;
    if (r.cached) e.cached += 1;
    byEndpoint.set(r.endpoint, e);
  }

  const [balance, spentToday, learnedCosts] = await Promise.all([
    getBalance(),
    getUserDaySpend(userId),
    getLearnedCosts(),
  ]);

  return {
    balance,
    spentToday,
    spentTotal: round6(spentTotal),
    dailyLimit: DAILY_SOFT_LIMIT_USD,
    cacheHitRate: rows.length ? cachedCount / rows.length : 0,
    totalCalls: rows.length,
    byDay: [...byDay.entries()]
      .map(([day, v]) => ({ day, cost: round6(v.cost), calls: v.calls, cached: v.cached }))
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, 14),
    byEndpoint: [...byEndpoint.entries()]
      .map(([endpoint, v]) => ({
        endpoint,
        cost: round6(v.cost),
        calls: v.calls,
        cached: v.cached,
      }))
      .sort((a, b) => b.cost - a.cost),
    recent: rows.slice(0, 100).map((r) => ({
      id: r.id,
      endpoint: r.endpoint,
      cost: Number(r.cost ?? 0),
      status: r.status,
      cached: r.cached,
      durationMs: r.duration_ms,
      summary: (r.summary ?? {}) as Record<string, JsonValue>,
      createdAt: r.created_at,
    })),
    learnedCosts,
  };
}
