/**
 * Server-only gateway for the Trendtrack Public API — the SpyMarket research
 * tool (admin-only, internal use under our own subscription). EVERY call goes
 * through trendtrackCall(): bearer auth, usage-header capture, 24h response
 * cache, full usage logging, 402/429 handling and the per-user daily soft
 * limit. The browser never talks to Trendtrack directly.
 *
 * Cost model: per-row pricing is LEARNED, never assumed. After every metered
 * call the observed credits-per-row is upserted into spymarket_endpoint_costs
 * (running average), and all estimates multiply the row limit by the learned
 * rate for that endpoint. Endpoints with no observation yet are reported as
 * "cost unknown" instead of guessing 1 credit/row.
 */
import type { Json } from "@/integrations/supabase/types";

const BASE_URL = "https://api.trendtrack.io/v1";
/** Their data is D-1 snapshots — anything fresher than 24h is served free. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Per-user soft limit: beyond this, every metered call needs a confirmation. */
export const DAILY_SOFT_LIMIT_CREDITS = 2000;

export interface ToolOk<T> {
  status: "ok";
  data: T;
  rowsReturned: number;
  creditsCost: number;
  creditsRemaining: number | null;
  cacheHit: boolean;
}
export interface ToolConfirm {
  status: "confirm";
  dayTotal: number;
  estimatedCost: number;
}
export interface ToolInsufficient {
  status: "insufficient";
  balance: number | null;
  message: string;
}
export type ToolResult<T> = ToolOk<T> | ToolConfirm | ToolInsufficient;

export interface CallOptions {
  userId: string;
  /** Log label, e.g. "shops/query". */
  endpoint: string;
  /** API path, e.g. "/shops/query". */
  path: string;
  method?: "GET" | "POST" | undefined;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: Record<string, unknown> | undefined;
  /** Compact description of the call, stored in the usage log. */
  summary?: Record<string, unknown> | undefined;
  /** Max rows this call can return — multiplied by the learned per-row rate. */
  estimatedCost: number;
  /** Default true. Lookup/facets/usage are zero-credit. */
  metered?: boolean | undefined;
  /** Default: metered calls are cached 24h. */
  cacheable?: boolean | undefined;
  /** User confirmed beyond the daily soft limit. */
  confirmOverage?: boolean | undefined;
}

interface UsageHeaders {
  cost: number | null;
  remaining: number | null;
  source: string | null;
}

function parseUsageHeaders(res: Response): UsageHeaders {
  const num = (v: string | null): number | null => {
    if (v == null) return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    cost: num(res.headers.get("x-usage-cost") ?? res.headers.get("x-credits-used")),
    remaining: num(res.headers.get("x-credits-remaining")),
    source: res.headers.get("x-credits-source"),
  };
}

/** Deterministic cache key: endpoint + recursively key-sorted params. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function rowsReturnedOf(payload: unknown): number {
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>)["data"];
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === "object") return 1;
  }
  return 0;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------------------------------------------------------------------------
// Learned per-endpoint pricing (spymarket_endpoint_costs)
// ---------------------------------------------------------------------------

export interface EndpointCost {
  endpoint: string;
  creditsPerRow: number;
  sampleCount: number;
  lastObservedAt: string | null;
}

/** Learned per-row rate for an endpoint; null when never observed. */
async function getEndpointRate(endpoint: string): Promise<number | null> {
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("spymarket_endpoint_costs")
    .select("credits_per_row, sample_count")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) {
    console.error("[spymarket] endpoint cost read failed:", error.message);
    return null;
  }
  if (!data || data.sample_count === 0) return null;
  return Number(data.credits_per_row);
}

/** Running-average upsert of the observed credits-per-row for an endpoint. */
async function learnEndpointCost(endpoint: string, observedPerRow: number): Promise<void> {
  const admin = await getAdmin();
  const { data: existing, error } = await admin
    .from("spymarket_endpoint_costs")
    .select("credits_per_row, sample_count")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (error) {
    console.error("[spymarket] endpoint cost read failed:", error.message);
    return;
  }
  const count = existing?.sample_count ?? 0;
  const prev = existing ? Number(existing.credits_per_row) : observedPerRow;
  const next = Math.round(((prev * count + observedPerRow) / (count + 1)) * 1000) / 1000;
  const { error: upError } = await admin.from("spymarket_endpoint_costs").upsert({
    endpoint,
    credits_per_row: next,
    last_observed_at: new Date().toISOString(),
    sample_count: count + 1,
  });
  if (upError) {
    console.error("[spymarket] endpoint cost upsert failed:", upError.message);
  } else if (existing && Number(existing.credits_per_row) !== next) {
    console.warn(
      `[spymarket] endpoint ${endpoint} price updated: ${existing.credits_per_row} → ${next} credits/row (${count + 1} samples)`,
    );
  }
}

/** All learned endpoint prices — feeds UI estimates and the usage dashboard. */
export async function getEndpointCosts(): Promise<EndpointCost[]> {
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("spymarket_endpoint_costs")
    .select("endpoint, credits_per_row, sample_count, last_observed_at")
    .order("endpoint");
  if (error) {
    console.error("[spymarket] endpoint costs read failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    endpoint: r.endpoint,
    creditsPerRow: Number(r.credits_per_row),
    sampleCount: r.sample_count,
    lastObservedAt: r.last_observed_at,
  }));
}

/** Credits spent today (UTC) by this user, excluding zero-cost cache hits. */
export async function getUserDayTotal(userId: string): Promise<number> {
  const admin = await getAdmin();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("spymarket_usage_log")
    .select("credits_cost")
    .eq("called_by", userId)
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => sum + (row.credits_cost ?? 0), 0);
}

async function logCall(entry: {
  userId: string;
  endpoint: string;
  summary: Record<string, unknown>;
  rowsReturned: number;
  creditsCost: number;
  creditsRemaining: number | null;
  cacheHit: boolean;
  /** Failure reason for calls that never produced a billable response. */
  error?: string | undefined;
}): Promise<void> {
  const admin = await getAdmin();
  const row = {
    called_by: entry.userId,
    endpoint: entry.endpoint,
    query_summary: entry.summary as unknown as Json,
    rows_returned: entry.rowsReturned,
    credits_cost: entry.creditsCost,
    credits_remaining: entry.creditsRemaining,
    cache_hit: entry.cacheHit,
    error: entry.error ?? null,
  };
  const { error } = await admin.from("spymarket_usage_log").insert(row);
  if (error) {
    // Callers without a profiles row (e.g. minted test users) must still be
    // logged — this log is the negotiation record. Retry with called_by null.
    if (error.code === "23503") {
      console.warn(
        "[spymarket] called_by has no profiles row — logging with called_by=null:",
        entry.userId,
      );
      const { error: retryError } = await admin
        .from("spymarket_usage_log")
        .insert({ ...row, called_by: null });
      if (retryError) console.error("[spymarket] usage log insert failed:", retryError.message);
    } else {
      console.error("[spymarket] usage log insert failed:", error.message);
    }
  }
}

/**
 * The single Trendtrack call path. Returns a discriminated union:
 *  - "ok"           → data + real cost (cache hits cost 0)
 *  - "confirm"      → user is beyond the daily soft limit; UI must confirm
 *  - "insufficient" → 402 from Trendtrack; shows balance, never retried
 */
export async function trendtrackCall<T = Json>(opts: CallOptions): Promise<ToolResult<T>> {
  const apiKey = process.env["TRENDTRACK_API_KEY"];
  if (!apiKey) throw new Error("TRENDTRACK_NOT_CONFIGURED");

  const metered = opts.metered !== false;
  // Everything is cached 24h by default — free endpoints too, so a retry
  // after a timeout serves instantly when we already have the answer.
  const cacheable = opts.cacheable ?? true;
  const summary = opts.summary ?? {};

  // Estimate = max rows × the LEARNED per-row rate for this endpoint (1× only
  // when never observed). The daily total itself sums real observed costs.
  const rate = metered ? await getEndpointRate(opts.endpoint) : null;
  const estimated = Math.ceil(opts.estimatedCost * (rate ?? 1));

  // Per-user daily soft limit — metered calls only.
  if (metered && !opts.confirmOverage) {
    const dayTotal = await getUserDayTotal(opts.userId);
    if (dayTotal >= DAILY_SOFT_LIMIT_CREDITS) {
      return { status: "confirm", dayTotal, estimatedCost: estimated };
    }
  }

  const cacheKey = `${opts.endpoint}:${stableStringify({
    path: opts.path,
    query: opts.query ?? {},
    body: opts.body ?? {},
  })}`;

  // 24h cache — their data is D-1, so fresh cache entries are served free.
  if (cacheable) {
    const admin = await getAdmin();
    const { data: hit } = await admin
      .from("spymarket_cache")
      .select("payload, fetched_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < CACHE_TTL_MS) {
      const rows = rowsReturnedOf(hit.payload);
      await logCall({
        userId: opts.userId,
        endpoint: opts.endpoint,
        summary,
        rowsReturned: rows,
        creditsCost: 0,
        creditsRemaining: null,
        cacheHit: true,
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

  // Build the request.
  const url = new URL(`${BASE_URL}${opts.path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  };

  // Their API can be slow: 30s per attempt, and each attempt gets a FRESH
  // signal (reusing one signal would let the 429 retry inherit a nearly-
  // expired timer from the first attempt).
  const doFetch = () =>
    fetch(url.toString(), { ...init, signal: AbortSignal.timeout(30_000) });

  let res: Response;
  try {
    res = await doFetch();

    // 429: respect Retry-After, single retry.
    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      const waitMs = Math.min((Number.isFinite(retryAfter) ? retryAfter : 2) * 1000, 10_000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      res = await doFetch();
    }
  } catch (err) {
    // No response = no credits charged by them: log the failure at cost 0
    // with cache_hit=false and the reason, for our own visibility.
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
      cacheHit: false,
      error: isTimeout
        ? "timeout after 30s"
        : `network: ${err instanceof Error ? err.message : String(err)}`,
    });
    if (isTimeout) throw new Error("TRENDTRACK_TIMEOUT");
    throw err instanceof Error ? err : new Error(String(err));
  }

  const usage = parseUsageHeaders(res);

  // 402 insufficient credits: show the balance and stop — never retry.
  if (res.status === 402) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const errObj = body?.["error"] as Record<string, unknown> | undefined;
    await logCall({
      userId: opts.userId,
      endpoint: opts.endpoint,
      summary,
      rowsReturned: 0,
      creditsCost: 0,
      creditsRemaining: usage.remaining,
      cacheHit: false,
    });
    return {
      status: "insufficient",
      balance: usage.remaining,
      message:
        (typeof errObj?.["message"] === "string" ? errObj["message"] : null) ??
        "Insufficient Trendtrack credits.",
    };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const errObj = body?.["error"] as Record<string, unknown> | undefined;
    const code = typeof errObj?.["code"] === "string" ? errObj["code"] : `HTTP_${res.status}`;
    const message =
      typeof errObj?.["message"] === "string" ? errObj["message"] : `Trendtrack error ${res.status}`;
    await logCall({
      userId: opts.userId,
      endpoint: opts.endpoint,
      summary,
      rowsReturned: 0,
      creditsCost: 0,
      creditsRemaining: usage.remaining,
      cacheHit: false,
      error: `${code}: ${message}`,
    });
    throw new Error(`TRENDTRACK_${code}: ${message}`);
  }

  const payload = (await res.json()) as T;
  const rows = rowsReturnedOf(payload);
  // Prefer the provider's usage header; fall back to the learned rate.
  const cost = usage.cost ?? (metered ? Math.ceil(rows * (rate ?? 1)) : 0);

  if (cacheable) {
    const admin = await getAdmin();
    const { error } = await admin.from("spymarket_cache").upsert({
      cache_key: cacheKey,
      endpoint: opts.endpoint,
      payload: payload as unknown as Json,
      fetched_at: new Date().toISOString(),
    });
    if (error) console.error("[spymarket] cache upsert failed:", error.message);
  }

  await logCall({
    userId: opts.userId,
    endpoint: opts.endpoint,
    summary,
    rowsReturned: rows,
    creditsCost: cost,
    creditsRemaining: usage.remaining,
    cacheHit: false,
  });

  // Learn the real per-row price from the provider's own usage header.
  if (metered && usage.cost != null && rows > 0) {
    await learnEndpointCost(opts.endpoint, usage.cost / rows);
  }

  return {
    status: "ok",
    data: payload,
    rowsReturned: rows,
    creditsCost: cost,
    creditsRemaining: usage.remaining,
    cacheHit: false,
  };
}

/** Section status: key configured, my day total, last balance, learned prices. */
export async function getToolsStatus(userId: string): Promise<{
  configured: boolean;
  dayTotal: number;
  dailySoftLimit: number;
  creditsRemaining: number | null;
  endpointCosts: EndpointCost[];
}> {
  const admin = await getAdmin();
  const { data: last } = await admin
    .from("spymarket_usage_log")
    .select("credits_remaining")
    .not("credits_remaining", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    configured: !!process.env["TRENDTRACK_API_KEY"],
    dayTotal: await getUserDayTotal(userId),
    dailySoftLimit: DAILY_SOFT_LIMIT_CREDITS,
    creditsRemaining: last?.credits_remaining ?? null,
    endpointCosts: await getEndpointCosts(),
  };
}

/** Usage dashboard — reads OUR log only (free), plus a live balance snapshot. */
export async function getUsageDashboard(userId: string): Promise<{
  today: number;
  week: number;
  month: number;
  cacheHitRate: number;
  totalCalls: number;
  byMember: Array<{ name: string; credits: number; calls: number }>;
  byEndpoint: Array<{ endpoint: string; credits: number; calls: number }>;
  observedPricing: EndpointCost[];
  creditsRemaining: number | null;
  liveBalance: number | null;
  recent: Array<{
    id: string;
    endpoint: string;
    rows_returned: number;
    credits_cost: number;
    credits_remaining: number | null;
    cache_hit: boolean;
    error: string | null;
    created_at: string;
    called_by_name: string;
  }>;
}> {
  const admin = await getAdmin();
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const { data: rows, error } = await admin
    .from("spymarket_usage_log")
    .select("id, called_by, endpoint, rows_returned, credits_cost, credits_remaining, cache_hit, error, created_at")
    .gte("created_at", monthStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const all = rows ?? [];

  const sumSince = (since: Date) =>
    all.filter((r) => new Date(r.created_at) >= since).reduce((s, r) => s + r.credits_cost, 0);

  const memberIds = [...new Set(all.map((r) => r.called_by).filter((v): v is string => !!v))];
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("id, contact_name").in("id", memberIds)
    : { data: [] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.contact_name ?? "Unknown"]));

  const byMemberMap = new Map<string, { name: string; credits: number; calls: number }>();
  const byEndpointMap = new Map<string, { endpoint: string; credits: number; calls: number }>();
  for (const r of all) {
    const mKey = r.called_by ?? "unknown";
    const m = byMemberMap.get(mKey) ?? {
      name: r.called_by ? (nameOf.get(r.called_by) ?? "Unknown") : "Unknown",
      credits: 0,
      calls: 0,
    };
    m.credits += r.credits_cost;
    m.calls += 1;
    byMemberMap.set(mKey, m);

    const e = byEndpointMap.get(r.endpoint) ?? { endpoint: r.endpoint, credits: 0, calls: 0 };
    e.credits += r.credits_cost;
    e.calls += 1;
    byEndpointMap.set(r.endpoint, e);
  }

  const lastWithBalance = all.find((r) => r.credits_remaining != null);

  // Live balance snapshot — GET /v1/usage is unmetered.
  let liveBalance: number | null = null;
  if (process.env["TRENDTRACK_API_KEY"]) {
    try {
      const res = await fetch(`${BASE_URL}/usage`, {
        headers: {
          Authorization: `Bearer ${process.env["TRENDTRACK_API_KEY"]}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        const credits = body["credits"] as Record<string, unknown> | undefined;
        const total = credits?.["totalRemaining"];
        liveBalance = typeof total === "number" ? total : null;
        if (liveBalance == null) {
          const headerVal = Number.parseInt(res.headers.get("x-credits-remaining") ?? "", 10);
          liveBalance = Number.isFinite(headerVal) ? headerVal : null;
        }
      }
    } catch {
      liveBalance = null;
    }
  }

  return {
    today: sumSince(dayStart),
    week: sumSince(weekStart),
    month: sumSince(monthStart),
    cacheHitRate: all.length ? all.filter((r) => r.cache_hit).length / all.length : 0,
    totalCalls: all.length,
    byMember: [...byMemberMap.values()].sort((a, b) => b.credits - a.credits),
    byEndpoint: [...byEndpointMap.values()].sort((a, b) => b.credits - a.credits),
    observedPricing: await getEndpointCosts(),
    creditsRemaining: lastWithBalance?.credits_remaining ?? null,
    liveBalance,
    recent: all.slice(0, 25).map((r) => ({
      id: r.id,
      endpoint: r.endpoint,
      rows_returned: r.rows_returned,
      credits_cost: r.credits_cost,
      credits_remaining: r.credits_remaining,
      cache_hit: r.cache_hit,
      error: r.error,
      created_at: r.created_at,
      called_by_name: r.called_by ? (nameOf.get(r.called_by) ?? "Unknown") : "Unknown",
    })),
  };
}
