/**
 * Server-only gateway for FlySales Ads.
 *
 * The ONLY module that talks to Pipeboard's MCP servers
 * (meta-ads.mcp.pipeboard.co / google-ads.mcp.pipeboard.co). Source of truth
 * for the protocol and tool names: docs/pipeboard-ads-api-reference.md.
 *
 * Non-negotiables enforced here:
 *  - PIPEBOARD_API_KEY never leaves the server; the browser never sees a URL.
 *  - READ-ONLY allowlist: any tool outside READ_TOOLS is refused at the gate,
 *    whatever the caller asks for.
 *  - The hard wall: a non-admin caller may only touch an ad account mapped to
 *    one of THEIR workspaces (public.workspace_ad_accounts, checked server-side
 *    with the service role after the caller's own workspace list is resolved).
 *  - Every call — cache hits included — is written to public.ads_api_calls.
 *  - Cache: insights 1h, structure/accounts 24h.
 */
import { createHash } from "crypto";
import type { Json } from "@/integrations/supabase/types";

export type AdPlatform = "meta" | "google";

const MCP_ENDPOINTS: Record<AdPlatform, string> = {
  meta: "https://meta-ads.mcp.pipeboard.co/",
  google: "https://google-ads.mcp.pipeboard.co/",
};

const TIMEOUT_MS = 30_000;
export const INSIGHTS_TTL_MS = 60 * 60 * 1000; // 1h
export const STRUCTURE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Read-only allowlist. Nothing that creates, updates, pauses, duplicates,
 * uploads or deletes can pass, even if a caller hand-crafts the tool name.
 */
export const READ_TOOLS = new Set<string>([
  // Meta (verified against tools/list on meta-ads.mcp.pipeboard.co)
  "get_ad_accounts",
  "list_meta_connections",
  "get_account_info",
  "get_account_pages",
  "get_campaigns",
  "get_campaign_details",
  "get_adsets",
  "get_adset_details",
  "get_ads",
  "get_ad_details",
  "get_insights",
  "get_ad_creatives",
  "get_creative_details",
  "get_ad_image",
  "get_pixels",
  // Google
  "list_google_ads_customers",
  "get_google_ads_account_info",
  "get_google_ads_campaigns",
  "get_google_ads_ad_groups",
  "get_google_ads_ads",
  "get_google_ads_campaign_metrics",
  "get_google_ads_ad_group_metrics",
  "get_google_ads_ad_metrics",
]);
function isReadTool(tool: string): boolean {
  if (!READ_TOOLS.has(tool)) return false;
  // Belt and braces: the allowlist is the rule, this is the sanity check.
  return /^(get|list)_/.test(tool);
}

export class AdsError extends Error {
  readonly statusCode: number | null;
  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = "AdsError";
    this.statusCode = statusCode;
  }
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

function hashArgs(platform: string, tool: string, args: unknown): string {
  return createHash("sha256")
    .update(`${platform}|${tool}|${stableStringify(args)}`)
    .digest("hex");
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ------------------------------------------------------------------ */
/* The hard wall                                                       */
/* ------------------------------------------------------------------ */

export interface MappedAccount {
  id: string;
  workspace_id: string;
  ad_account_id: string;
  platform: string;
  label: string | null;
  active: boolean;
  workspace_name?: string | null;
}

/** Active accounts mapped to the workspaces this user owns. */
export async function listMyMappedAccounts(userId: string): Promise<MappedAccount[]> {
  const admin = await getAdmin();
  const { data: entities } = await admin.from("entities").select("id").eq("account_id", userId);
  const entityIds = (entities ?? []).map((e) => e.id);
  if (entityIds.length === 0) return [];
  const { data: stores } = await admin
    .from("stores")
    .select("id, store_name")
    .in("entity_id", entityIds);
  const storeIds = (stores ?? []).map((s) => s.id);
  if (storeIds.length === 0) return [];
  const { data, error } = await admin
    .from("workspace_ad_accounts")
    .select("id, workspace_id, ad_account_id, platform, label, active")
    .in("workspace_id", storeIds)
    .eq("active", true)
    .order("created_at");
  if (error) throw new AdsError(error.message);
  const names = new Map((stores ?? []).map((s) => [s.id, s.store_name]));
  return (data ?? []).map((row) => ({
    ...row,
    workspace_name: names.get(row.workspace_id) ?? null,
  }));
}

/** Every mapping in the system, with workspace names. Admin surfaces only. */
export async function listAllMappedAccounts(): Promise<MappedAccount[]> {
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("workspace_ad_accounts")
    .select(
      "id, workspace_id, ad_account_id, platform, label, active, created_at, stores(store_name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new AdsError(error.message);
  return (data ?? []).map((row) => {
    const { stores, ...rest } = row as typeof row & {
      stores: { store_name: string | null } | null;
    };
    return { ...rest, workspace_name: stores?.store_name ?? null } as MappedAccount;
  });
}

/**
 * Resolve the workspace an ad account may be queried under, for this caller.
 * Admins pass; everyone else must own a workspace the account is mapped to.
 * Throws rather than returning a falsy value — this is a security boundary.
 */
export async function assertAccountAllowed(args: {
  userId: string;
  isAdmin: boolean;
  accountId: string;
  platform: AdPlatform;
}): Promise<{ workspaceId: string | null }> {
  const admin = await getAdmin();
  if (args.isAdmin) {
    const { data } = await admin
      .from("workspace_ad_accounts")
      .select("workspace_id")
      .eq("ad_account_id", args.accountId)
      .eq("platform", args.platform)
      .maybeSingle();
    return { workspaceId: data?.workspace_id ?? null };
  }
  const mine = await listMyMappedAccounts(args.userId);
  const match = mine.find(
    (m) => m.ad_account_id === args.accountId && m.platform === args.platform,
  );
  if (!match) {
    throw new AdsError("Forbidden: this ad account is not linked to your workspace", 403);
  }
  return { workspaceId: match.workspace_id };
}

/* ------------------------------------------------------------------ */
/* Cache + log                                                         */
/* ------------------------------------------------------------------ */

async function cacheGet(key: string): Promise<{ payload: unknown; fetchedAt: string } | null> {
  const admin = await getAdmin();
  const { data } = await admin
    .from("ads_cache")
    .select("payload, fetched_at, expires_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return { payload: data.payload, fetchedAt: data.fetched_at };
}

async function cacheSet(args: {
  key: string;
  tool: string;
  accountId: string | null;
  payload: unknown;
  ttlMs: number;
}): Promise<void> {
  const admin = await getAdmin();
  const { error } = await admin.from("ads_cache").upsert(
    {
      cache_key: args.key,
      tool: args.tool,
      ad_account_id: args.accountId,
      payload: args.payload as Json,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + args.ttlMs).toISOString(),
    },
    { onConflict: "cache_key" },
  );
  if (error) console.error("[ads] cache write failed:", error.message);
}

async function logCall(entry: {
  userId: string;
  workspaceId: string | null;
  platform: AdPlatform;
  tool: string;
  accountId: string | null;
  paramsHash: string;
  ok: boolean;
  cached: boolean;
  rows: number;
  statusCode?: number | null;
  durationMs?: number | null;
  error?: string | null;
  summary?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = await getAdmin();
    const { error } = await admin.from("ads_api_calls").insert({
      workspace_id: entry.workspaceId,
      platform: entry.platform,
      tool: entry.tool,
      ad_account_id: entry.accountId,
      params_hash: entry.paramsHash,
      status_code: entry.statusCode ?? null,
      ok: entry.ok,
      cached: entry.cached,
      rows_returned: entry.rows,
      duration_ms: entry.durationMs ?? null,
      summary: (entry.summary ?? {}) as Json,
      error: entry.error ?? null,
      called_by: entry.userId,
    });
    if (error) console.error("[ads] call log insert failed:", error.message);
  } catch (e) {
    console.error("[ads] call log threw:", e);
  }
}

/* ------------------------------------------------------------------ */
/* MCP transport                                                       */
/* ------------------------------------------------------------------ */

/** Pull the JSON body out of a Streamable-HTTP response (plain JSON or SSE). */
function parseMcpBody(contentType: string, body: string): unknown {
  if (contentType.includes("text/event-stream")) {
    const payloads = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = payloads[payloads.length - 1];
    if (!last) throw new AdsError("Empty stream from the ads provider");
    return JSON.parse(last);
  }
  return JSON.parse(body);
}

/** MCP tool results are content blocks; the useful payload is JSON in a text block. */
function unwrapToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const rec = result as Record<string, unknown>;
  const structured = rec["structuredContent"];
  if (structured !== undefined) {
    // FastMCP wraps everything as { result: "<json string>" }.
    if (structured && typeof structured === "object" && "result" in (structured as object)) {
      const inner = (structured as { result: unknown }).result;
      if (typeof inner === "string") {
        try {
          return JSON.parse(inner);
        } catch {
          return { text: inner };
        }
      }
      return inner;
    }
    return structured;
  }
  const content = rec["content"];
  if (!Array.isArray(content)) return result;
  const texts = content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b && typeof b === "object" && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text);
  if (texts.length === 0) return result;
  const joined = texts.join("\n");
  try {
    return JSON.parse(joined);
  } catch {
    return { text: joined };
  }
}

/** Row count across the shapes the tools return. */
export function adsRowsOf(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const key of [
      "data",
      "segmented_metrics",
      "results",
      "items",
      "campaigns",
      "adsets",
      "ads",
      "accounts",
      "insights",
    ]) {
      const v = rec[key];
      if (Array.isArray(v)) return v.length;
    }
  }
  return 0;
}

/** First array we can find in a tool payload, whatever it is nested under. */
export function adsRowsArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    // Daily insights come back as { segmented_metrics: [{ period, metrics }] };
    // flatten them into ordinary rows carrying their date.
    const segments = rec["segmented_metrics"];
    if (Array.isArray(segments)) {
      return segments.map((seg) => {
        const s = (seg ?? {}) as Record<string, unknown>;
        const metrics = (s["metrics"] ?? {}) as Record<string, unknown>;
        return { ...metrics, date_start: s["period"] ?? s["period_start"] ?? null };
      });
    }
    for (const key of [
      "data",
      "results",
      "items",
      "campaigns",
      "adsets",
      "ads",
      "accounts",
      "insights",
    ]) {
      const v = rec[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    for (const v of Object.values(rec)) {
      if (Array.isArray(v) && v.every((x) => x && typeof x === "object")) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return [];
}

async function mcpToolsCall(
  platform: AdPlatform,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ payload: unknown; statusCode: number }> {
  // One credential for both MCP servers, sent the way the provider documents:
  // Authorization: Bearer <api key>.
  const apiKey = (process.env["PIPEBOARD_API_KEY"] ?? process.env["PIPEBOARD_TOKEN"])?.trim();
  if (!apiKey) throw new AdsError("Ads provider is not configured (missing API key)", null);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(MCP_ENDPOINTS[platform], {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = JSON.parse(text) as { error_description?: string; error?: string };
        message = body.error_description ?? body.error ?? message;
      } catch {
        /* keep the status line */
      }
      throw new AdsError(message, response.status);
    }

    const envelope = parseMcpBody(response.headers.get("content-type") ?? "", text) as {
      error?: { message?: string };
      result?: unknown;
    };
    if (envelope.error) {
      throw new AdsError(
        envelope.error.message ?? "Ads provider rejected the request",
        response.status,
      );
    }
    const result = envelope.result as { isError?: boolean } | undefined;
    const payload = unwrapToolResult(result);
    if (result?.isError) {
      const detail =
        payload && typeof payload === "object" && "text" in (payload as Record<string, unknown>)
          ? String((payload as { text: unknown }).text)
          : "the ads provider returned an error";
      throw new AdsError(detail, response.status);
    }
    return { payload, statusCode: response.status };
  } catch (e) {
    if (e instanceof AdsError) throw e;
    // Our own 30s timeout surfaces either as AbortError or as the raw
    // "signal is aborted without reason" message depending on the runtime.
    if (
      e instanceof Error &&
      (e.name === "AbortError" || /aborted without reason/i.test(e.message))
    ) {
      throw new AdsError("The ads provider timed out", 504);
    }
    throw new AdsError(e instanceof Error ? e.message : String(e), null);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* The gateway                                                         */
/* ------------------------------------------------------------------ */

export interface AdsCallResult<T = unknown> {
  data: T;
  cached: boolean;
  fetchedAt: string;
  rows: number;
}

export interface AdsCallOptions {
  userId: string;
  workspaceId: string | null;
  platform?: AdPlatform;
  tool: string;
  args: Record<string, unknown>;
  accountId?: string | null;
  ttlMs?: number;
  /** Skip the cache read (never the cache write). */
  refresh?: boolean;
}

/**
 * Single entry point. Allowlist → cache → provider → log. Callers must have
 * already passed assertAccountAllowed for whatever account is in `args`.
 */
export async function callAdsTool<T = unknown>(opts: AdsCallOptions): Promise<AdsCallResult<T>> {
  const platform = opts.platform ?? "meta";
  const tool = opts.tool;
  const paramsHash = hashArgs(platform, tool, opts.args);
  const accountId = opts.accountId ?? null;

  if (!isReadTool(tool)) {
    await logCall({
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      platform,
      tool,
      accountId,
      paramsHash,
      ok: false,
      cached: false,
      rows: 0,
      error: "blocked: write tool",
    });
    throw new AdsError(`Tool "${tool}" is not permitted — FlySales Ads is read-only`, 403);
  }

  const ttl = opts.ttlMs ?? INSIGHTS_TTL_MS;
  const cacheKey = `${platform}:${tool}:${paramsHash}`;

  if (!opts.refresh) {
    const hit = await cacheGet(cacheKey);
    if (hit) {
      const rows = adsRowsOf(hit.payload);
      await logCall({
        userId: opts.userId,
        workspaceId: opts.workspaceId,
        platform,
        tool,
        accountId,
        paramsHash,
        ok: true,
        cached: true,
        rows,
        statusCode: 200,
      });
      return { data: hit.payload as T, cached: true, fetchedAt: hit.fetchedAt, rows };
    }
  }

  const started = Date.now();
  try {
    const { payload, statusCode } = await mcpToolsCall(platform, tool, opts.args);
    const rows = adsRowsOf(payload);
    await cacheSet({ key: cacheKey, tool, accountId, payload, ttlMs: ttl });
    await logCall({
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      platform,
      tool,
      accountId,
      paramsHash,
      ok: true,
      cached: false,
      rows,
      statusCode,
      durationMs: Date.now() - started,
    });
    return { data: payload as T, cached: false, fetchedAt: new Date().toISOString(), rows };
  } catch (e) {
    const err =
      e instanceof AdsError ? e : new AdsError(e instanceof Error ? e.message : String(e));
    await logCall({
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      platform,
      tool,
      accountId,
      paramsHash,
      ok: false,
      cached: false,
      rows: 0,
      statusCode: err.statusCode,
      durationMs: Date.now() - started,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Same as callAdsTool but, when the provider fails, falls back to the last
 * cached copy however stale it is — the dashboard shows data with a
 * "last updated" banner instead of an empty screen.
 */
export async function callAdsToolWithStale<T = unknown>(
  opts: AdsCallOptions,
): Promise<AdsCallResult<T> & { stale: boolean; error?: string }> {
  try {
    const fresh = await callAdsTool<T>(opts);
    return { ...fresh, stale: false };
  } catch (e) {
    const platform = opts.platform ?? "meta";
    const cacheKey = `${platform}:${opts.tool}:${hashArgs(platform, opts.tool, opts.args)}`;
    const admin = await getAdmin();
    const { data } = await admin
      .from("ads_cache")
      .select("payload, fetched_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (!data) throw e;
    return {
      data: data.payload as T,
      cached: true,
      stale: true,
      fetchedAt: data.fetched_at,
      rows: adsRowsOf(data.payload),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Metric normalisation                                                */
/* ------------------------------------------------------------------ */

export interface AdMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchases: number;
  revenue: number;
  roas: number;
  cpa: number;
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Sum an `actions`/`action_values` array over purchase-ish action types. */
function sumPurchaseish(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let best = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const type = String(rec["action_type"] ?? "");
    if (!/purchase/i.test(type)) continue;
    // Prefer the canonical types; otherwise take the largest purchase-ish row
    // rather than double-counting omni_/offsite_ duplicates.
    const value = num(rec["value"]);
    if (type === "purchase" || type === "omni_purchase") return value;
    best = Math.max(best, value);
  }
  return best;
}

/** Normalise one Meta insights row into the KPIs the dashboard shows. */
export function normaliseMetaRow(row: Record<string, unknown>): AdMetrics {
  const spend = num(row["spend"]);
  const impressions = num(row["impressions"]);
  const clicks = num(row["clicks"]);
  const reach = num(row["reach"]);

  let purchases = sumPurchaseish(row["actions"]);
  if (purchases === 0) purchases = num(row["purchases"]) || num(row["conversions"]);
  let revenue = sumPurchaseish(row["action_values"]);
  if (revenue === 0) revenue = num(row["conversion_values"]) || num(row["purchase_value"]);

  let roas = 0;
  const roasField = row["purchase_roas"];
  if (Array.isArray(roasField) && roasField.length > 0) {
    roas = num((roasField[0] as Record<string, unknown>)["value"]);
  }
  if (roas === 0 && spend > 0) roas = revenue / spend;

  return {
    spend,
    impressions,
    clicks,
    reach,
    ctr: num(row["ctr"]) || (impressions > 0 ? (clicks / impressions) * 100 : 0),
    cpc: num(row["cpc"]) || (clicks > 0 ? spend / clicks : 0),
    cpm: num(row["cpm"]) || (impressions > 0 ? (spend / impressions) * 1000 : 0),
    purchases,
    revenue,
    roas,
    cpa: purchases > 0 ? spend / purchases : 0,
  };
}

/**
 * Normalise one Google Ads metrics row (campaign, ad group, ad or a daily
 * segment). Google reports cost/conversions, not purchases; CTR is a fraction.
 * Reach has no Google equivalent — it stays 0 and the UI labels it as a gap.
 */
export function normaliseGoogleRow(row: Record<string, unknown>): AdMetrics {
  const spend = num(row["cost"]);
  const impressions = num(row["impressions"]);
  const clicks = num(row["clicks"]);
  const purchases = num(row["conversions"]);
  const revenue = num(row["conversions_value"]);
  const ctrFraction = num(row["ctr"]) || num(row["average_ctr"]);
  return {
    spend,
    impressions,
    clicks,
    reach: 0,
    ctr: ctrFraction ? ctrFraction * 100 : impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: num(row["average_cpc"]) || (clicks > 0 ? spend / clicks : 0),
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    purchases,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
  };
}

/** Google only accepts named ranges — map our picker onto the closest one. */
export function googleDateRange(days: number): { range: string; note?: string } {
  if (days <= 7) return { range: "LAST_7_DAYS" };
  if (days <= 30) {
    return days === 30
      ? { range: "LAST_30_DAYS" }
      : {
          range: "LAST_30_DAYS",
          note: "Google Ads only offers 7, 30 and 90-day ranges — showing 30 days.",
        };
  }
  return { range: "LAST_90_DAYS" };
}

export function emptyMetrics(): AdMetrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    purchases: 0,
    revenue: 0,
    roas: 0,
    cpa: 0,
  };
}

/** Aggregate many rows (e.g. a daily series) into one set of KPIs. */
export function aggregateMetrics(rows: AdMetrics[]): AdMetrics {
  const total = rows.reduce(
    (acc, r) => ({
      ...acc,
      spend: acc.spend + r.spend,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      reach: acc.reach + r.reach,
      purchases: acc.purchases + r.purchases,
      revenue: acc.revenue + r.revenue,
    }),
    emptyMetrics(),
  );
  total.ctr = total.impressions > 0 ? (total.clicks / total.impressions) * 100 : 0;
  total.cpc = total.clicks > 0 ? total.spend / total.clicks : 0;
  total.cpm = total.impressions > 0 ? (total.spend / total.impressions) * 1000 : 0;
  total.roas = total.spend > 0 ? total.revenue / total.spend : 0;
  total.cpa = total.purchases > 0 ? total.spend / total.purchases : 0;
  return total;
}

/** The date string on an insights row, whatever key the provider used. */
export function rowDate(row: Record<string, unknown>): string | null {
  for (const key of ["date_start", "date", "day", "date_stop"]) {
    const v = row[key];
    if (typeof v === "string" && v.length >= 8) return v.slice(0, 10);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Date ranges                                                         */
/* ------------------------------------------------------------------ */

export const RANGE_DAYS = [7, 14, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Explicit {since, until} windows — the current period and the one before it,
 * so every KPI carries a like-for-like delta. Yesterday is the last complete
 * day; today is excluded to keep the comparison honest.
 */
export function periodWindows(days: number): {
  current: { since: string; until: string };
  previous: { since: string; until: string };
} {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return {
    current: { since: isoDay(start), until: isoDay(end) },
    previous: { since: isoDay(prevStart), until: isoDay(prevEnd) },
  };
}

/* ------------------------------------------------------------------ */
/* High-level reads used by the dashboard                              */
/* ------------------------------------------------------------------ */

interface InsightsArgs {
  objectId: string;
  window: { since: string; until: string };
  level?: "account" | "campaign" | "adset" | "ad";
  daily?: boolean;
}

/** Exactly the arguments get_insights declares — extra keys are rejected. */
function insightArgs(a: InsightsArgs): Record<string, unknown> {
  return {
    object_id: a.objectId,
    time_range: { since: a.window.since, until: a.window.until },
    level: a.level ?? "account",
    ...(a.daily ? { time_breakdown: "day" } : {}),
    limit: a.daily ? 200 : 500,
  };
}

export interface OverviewSeriesPoint {
  date: string;
  spend: number;
  revenue: number;
  purchases: number;
  clicks: number;
  impressions: number;
  roas: number;
}

export interface OverviewResult {
  accountId: string;
  platform: AdPlatform;
  currency: string;
  days: number;
  /** False when the platform cannot give a like-for-like previous period. */
  hasPrevious: boolean;
  /** Metrics this platform does not report, spelled out for the UI. */
  gaps: string[];
  current: AdMetrics;
  previous: AdMetrics;
  series: OverviewSeriesPoint[];
  cached: boolean;
  stale: boolean;
  fetchedAt: string;
  warning?: string;
}

/**
 * The whole overview in TWO provider calls: one daily series for the current
 * period (aggregated locally for the KPI cards) and one total for the previous
 * period. Never a per-day loop.
 */
export async function fetchOverview(args: {
  userId: string;
  workspaceId: string | null;
  accountId: string;
  days: number;
  platform?: AdPlatform;
  refresh?: boolean;
}): Promise<OverviewResult> {
  if ((args.platform ?? "meta") === "google") return fetchGoogleOverview(args);
  const windows = periodWindows(args.days);

  // Account currency, so the dashboard never labels euros as dollars.
  // Structure data: one call a day at most.
  let currency = "USD";
  try {
    const info = await callAdsTool({
      userId: args.userId,
      workspaceId: args.workspaceId,
      tool: "get_account_info",
      accountId: args.accountId,
      args: { account_id: args.accountId },
      ttlMs: STRUCTURE_TTL_MS,
    });
    const rec = (info.data ?? {}) as Record<string, unknown>;
    const found =
      (typeof rec["currency"] === "string" && rec["currency"]) ||
      (adsRowsArray(info.data)[0]?.["currency"] as string | undefined);
    if (typeof found === "string" && found) currency = found;
  } catch {
    /* currency is cosmetic — never block the dashboard on it */
  }

  const currentCall = await callAdsToolWithStale({
    userId: args.userId,
    workspaceId: args.workspaceId,
    tool: "get_insights",
    accountId: args.accountId,
    args: insightArgs({
      objectId: args.accountId,
      window: windows.current,
      level: "account",
      daily: true,
    }),
    ttlMs: INSIGHTS_TTL_MS,
    ...(args.refresh ? { refresh: true } : {}),
  });

  let previous = emptyMetrics();
  let warning: string | undefined;
  try {
    const previousCall = await callAdsTool({
      userId: args.userId,
      workspaceId: args.workspaceId,
      tool: "get_insights",
      accountId: args.accountId,
      args: insightArgs({
        objectId: args.accountId,
        window: windows.previous,
        level: "account",
        daily: true,
      }),
      ttlMs: INSIGHTS_TTL_MS,
    });
    previous = aggregateMetrics(adsRowsArray(previousCall.data).map(normaliseMetaRow));
  } catch (e) {
    warning = `Previous period unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }

  const rows = adsRowsArray(currentCall.data);
  const series: OverviewSeriesPoint[] = [];
  for (const row of rows) {
    const date = rowDate(row);
    if (!date) continue;
    const m = normaliseMetaRow(row);
    series.push({
      date,
      spend: m.spend,
      revenue: m.revenue,
      purchases: m.purchases,
      clicks: m.clicks,
      impressions: m.impressions,
      roas: m.roas,
    });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));

  return {
    accountId: args.accountId,
    platform: "meta",
    currency,
    days: args.days,
    hasPrevious: true,
    gaps: [],
    current: aggregateMetrics(rows.map(normaliseMetaRow)),
    previous,
    series,
    cached: currentCall.cached,
    stale: currentCall.stale,
    fetchedAt: currentCall.fetchedAt,
    ...(warning ? { warning } : {}),
  };
}

/**
 * Google overview. One metrics call with a daily breakdown gives both the KPI
 * totals (their aggregate block) and the time series. Google's tool only takes
 * named ranges, so there is no honest previous-period comparison — we say so
 * rather than invent one.
 */
async function fetchGoogleOverview(args: {
  userId: string;
  workspaceId: string | null;
  accountId: string;
  days: number;
  refresh?: boolean;
}): Promise<OverviewResult> {
  const { range, note } = googleDateRange(args.days);

  let currency = "USD";
  try {
    const info = await callAdsTool({
      userId: args.userId,
      workspaceId: args.workspaceId,
      platform: "google",
      tool: "get_google_ads_account_info",
      accountId: args.accountId,
      args: { customer_id: args.accountId },
      ttlMs: STRUCTURE_TTL_MS,
    });
    const rec = (info.data ?? {}) as Record<string, unknown>;
    const found = rec["currency_code"] ?? rec["currency"];
    if (typeof found === "string" && found) currency = found;
  } catch {
    /* cosmetic */
  }

  const call = await callAdsToolWithStale<Record<string, unknown>>({
    userId: args.userId,
    workspaceId: args.workspaceId,
    platform: "google",
    tool: "get_google_ads_campaign_metrics",
    accountId: args.accountId,
    args: {
      customer_id: args.accountId,
      date_range: range,
      time_breakdown: "day",
      status_filter: "ALL",
      page_size: 200,
    },
    ttlMs: INSIGHTS_TTL_MS,
    ...(args.refresh ? { refresh: true } : {}),
  });

  const payload = (call.data ?? {}) as Record<string, unknown>;
  const aggregate = (payload["aggregate_metrics"] ?? {}) as Record<string, unknown>;
  const segments = Array.isArray(payload["segmented_metrics"])
    ? (payload["segmented_metrics"] as Record<string, unknown>[])
    : [];

  const series: OverviewSeriesPoint[] = segments
    .map((seg) => {
      const m = normaliseGoogleRow(seg);
      const date = typeof seg["date"] === "string" ? seg["date"].slice(0, 10) : null;
      return date
        ? {
            date,
            spend: m.spend,
            revenue: m.revenue,
            purchases: m.purchases,
            clicks: m.clicks,
            impressions: m.impressions,
            roas: m.roas,
          }
        : null;
    })
    .filter((x): x is OverviewSeriesPoint => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const current =
    Object.keys(aggregate).length > 0
      ? normaliseGoogleRow(aggregate)
      : aggregateMetrics(segments.map(normaliseGoogleRow));

  const gaps = [
    "Reach and frequency are not reported by Google Ads.",
    "Google Ads has no previous-period comparison here, so KPI deltas are hidden.",
    "Conversions are Google conversions (can be fractional), not Meta purchases.",
  ];
  if (note) gaps.unshift(note);

  return {
    accountId: args.accountId,
    platform: "google",
    currency,
    days: args.days,
    hasPrevious: false,
    gaps,
    current,
    previous: emptyMetrics(),
    series,
    cached: call.cached,
    stale: call.stale,
    fetchedAt: call.fetchedAt,
  };
}

/** Google customer accounts our connection can reach. Admin surface only. */
export async function listGoogleCustomers(args: { userId: string; refresh?: boolean }): Promise<{
  accounts: { id: string; name: string; currency: string | null; canQueryMetrics: boolean }[];
  cached: boolean;
  stale: boolean;
  fetchedAt: string;
  warnings: string[];
}> {
  const call = await callAdsToolWithStale<Record<string, unknown>>({
    userId: args.userId,
    workspaceId: null,
    platform: "google",
    tool: "list_google_ads_customers",
    args: {},
    ttlMs: STRUCTURE_TTL_MS,
    ...(args.refresh ? { refresh: true } : {}),
  });
  const payload = (call.data ?? {}) as Record<string, unknown>;
  const connections = Array.isArray(payload["connections"])
    ? (payload["connections"] as Record<string, unknown>[])
    : [];
  const accounts: {
    id: string;
    name: string;
    currency: string | null;
    canQueryMetrics: boolean;
  }[] = [];
  for (const conn of connections) {
    const customers = Array.isArray(conn["customers"])
      ? (conn["customers"] as Record<string, unknown>[])
      : [];
    for (const c of customers) {
      const id = String(c["id"] ?? "");
      if (!id) continue;
      accounts.push({
        id,
        name: String(c["descriptive_name"] ?? c["name"] ?? id),
        currency: typeof c["currency_code"] === "string" ? c["currency_code"] : null,
        canQueryMetrics: c["can_query_metrics"] !== false,
      });
    }
  }
  const summary = (payload["summary"] ?? {}) as Record<string, unknown>;
  const warnings = Array.isArray(summary["warnings"]) ? summary["warnings"].map(String) : [];
  return { accounts, cached: call.cached, stale: call.stale, fetchedAt: call.fetchedAt, warnings };
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  metrics: AdMetrics;
  /** False when the provider returned no performance row for this entity. */
  hasData: boolean;
}

function pickId(row: Record<string, unknown>): string {
  for (const key of ["id", "campaign_id", "adset_id", "ad_id"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function pickName(row: Record<string, unknown>, fallback: string): string {
  for (const key of ["name", "campaign_name", "adset_name", "ad_name"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
  }
  return fallback;
}

function pickStatus(row: Record<string, unknown>): string {
  for (const key of ["effective_status", "status", "configured_status"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
  }
  return "UNKNOWN";
}

/**
 * Structure + performance for one level, merged by id. Two calls: the entity
 * list (24h cache) and one insights call at that level (1h cache).
 */
export async function fetchLevel(args: {
  userId: string;
  workspaceId: string | null;
  accountId: string;
  days: number;
  level: "campaign" | "adset" | "ad";
  platform?: AdPlatform;
  parentId?: string | null;
  refresh?: boolean;
}): Promise<{ rows: CampaignRow[]; cached: boolean; stale: boolean; fetchedAt: string }> {
  if ((args.platform ?? "meta") === "google") return fetchGoogleLevel(args);
  const windows = periodWindows(args.days);
  const tool =
    args.level === "campaign" ? "get_campaigns" : args.level === "adset" ? "get_adsets" : "get_ads";

  const structureArgs: Record<string, unknown> = { account_id: args.accountId, limit: 200 };
  if (args.level === "adset" && args.parentId) structureArgs["campaign_id"] = args.parentId;
  if (args.level === "ad" && args.parentId) structureArgs["adset_id"] = args.parentId;

  const structure = await callAdsToolWithStale({
    userId: args.userId,
    workspaceId: args.workspaceId,
    tool,
    accountId: args.accountId,
    args: structureArgs,
    ttlMs: STRUCTURE_TTL_MS,
    ...(args.refresh ? { refresh: true } : {}),
  });

  const insights = await callAdsToolWithStale({
    userId: args.userId,
    workspaceId: args.workspaceId,
    tool: "get_insights",
    accountId: args.accountId,
    args: insightArgs({
      objectId: args.parentId ?? args.accountId,
      window: windows.current,
      level: args.level,
    }),
    ttlMs: INSIGHTS_TTL_MS,
    ...(args.refresh ? { refresh: true } : {}),
  });

  const byId = new Map<string, AdMetrics>();
  for (const row of adsRowsArray(insights.data)) {
    const key =
      (typeof row["campaign_id"] === "string" && args.level === "campaign" && row["campaign_id"]) ||
      (typeof row["adset_id"] === "string" && args.level === "adset" && row["adset_id"]) ||
      (typeof row["ad_id"] === "string" && args.level === "ad" && row["ad_id"]) ||
      pickId(row);
    if (typeof key === "string" && key) byId.set(key, normaliseMetaRow(row));
  }

  const rows: CampaignRow[] = adsRowsArray(structure.data).map((row) => {
    const id = pickId(row);
    return {
      id,
      name: pickName(row, id || "Untitled"),
      status: pickStatus(row),
      objective: typeof row["objective"] === "string" ? row["objective"] : null,
      metrics: byId.get(id) ?? emptyMetrics(),
      hasData: byId.has(id),
    };
  });
  rows.sort((a, b) => Number(b.hasData) - Number(a.hasData) || b.metrics.spend - a.metrics.spend);

  return {
    rows,
    cached: structure.cached && insights.cached,
    stale: structure.stale || insights.stale,
    fetchedAt: insights.fetchedAt,
  };
}

/**
 * Google campaigns / ad groups / ads with their performance. One metrics call
 * per level — the structure and the numbers arrive together.
 */
async function fetchGoogleLevel(args: {
  userId: string;
  workspaceId: string | null;
  accountId: string;
  days: number;
  level: "campaign" | "adset" | "ad";
  parentId?: string | null;
  refresh?: boolean;
}): Promise<{ rows: CampaignRow[]; cached: boolean; stale: boolean; fetchedAt: string }> {
  const { range } = googleDateRange(args.days);
  const tool =
    args.level === "campaign"
      ? "get_google_ads_campaign_metrics"
      : args.level === "adset"
        ? "get_google_ads_ad_group_metrics"
        : "get_google_ads_ad_metrics";

  const toolArgs: Record<string, unknown> = {
    customer_id: args.accountId,
    date_range: range,
    status_filter: "ALL",
    page_size: 200,
  };
  if (args.level === "adset" && args.parentId) toolArgs["campaign_id"] = args.parentId;
  if (args.level === "ad" && args.parentId) toolArgs["ad_group_id"] = args.parentId;

  const call = await callAdsToolWithStale<Record<string, unknown>>({
    userId: args.userId,
    workspaceId: args.workspaceId,
    platform: "google",
    tool,
    accountId: args.accountId,
    args: toolArgs,
    ttlMs: INSIGHTS_TTL_MS,
    ...(args.refresh ? { refresh: true } : {}),
  });

  const payload = (call.data ?? {}) as Record<string, unknown>;
  const listKey =
    args.level === "campaign" ? "campaigns" : args.level === "adset" ? "ad_groups" : "ads";
  const list = Array.isArray(payload[listKey])
    ? (payload[listKey] as Record<string, unknown>[])
    : adsRowsArray(payload);

  const idKey =
    args.level === "campaign" ? "campaign_id" : args.level === "adset" ? "ad_group_id" : "ad_id";
  const nameKey =
    args.level === "campaign"
      ? "campaign_name"
      : args.level === "adset"
        ? "ad_group_name"
        : "ad_name";
  const statusKey =
    args.level === "campaign"
      ? "campaign_status"
      : args.level === "adset"
        ? "ad_group_status"
        : "ad_status";

  const rows: CampaignRow[] = list.map((row) => {
    const id = String(row[idKey] ?? pickId(row) ?? "");
    return {
      id,
      name: String(row[nameKey] ?? pickName(row, id || "Untitled")),
      status: String(row[statusKey] ?? pickStatus(row)),
      objective: typeof row["campaign_type"] === "string" ? row["campaign_type"] : null,
      metrics: normaliseGoogleRow(row),
      hasData: row["cost"] !== undefined || row["impressions"] !== undefined,
    };
  });
  rows.sort((a, b) => Number(b.hasData) - Number(a.hasData) || b.metrics.spend - a.metrics.spend);

  return { rows, cached: call.cached, stale: call.stale, fetchedAt: call.fetchedAt };
}

/** Creative for a single ad — copy, headline and any image we can surface. */
export async function fetchCreative(args: {
  userId: string;
  workspaceId: string | null;
  accountId: string;
  adId: string;
}): Promise<{
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  linkUrl: string | null;
  raw: unknown;
  cached: boolean;
}> {
  const call = await callAdsTool({
    userId: args.userId,
    workspaceId: args.workspaceId,
    tool: "get_ad_creatives",
    accountId: args.accountId,
    args: { ad_id: args.adId },
    ttlMs: STRUCTURE_TTL_MS,
  });
  const rows = adsRowsArray(call.data);
  const first = rows[0] ?? (call.data as Record<string, unknown> | null) ?? {};
  const str = (key: string): string | null => {
    const v = (first as Record<string, unknown>)[key];
    return typeof v === "string" && v ? v : null;
  };
  return {
    title: str("title") ?? str("name") ?? null,
    body: str("body") ?? str("message") ?? null,
    imageUrl: str("image_url") ?? str("picture") ?? null,
    thumbnailUrl: str("thumbnail_url") ?? null,
    linkUrl: str("link_url") ?? str("object_story_url") ?? null,
    raw: call.data,
    cached: call.cached,
  };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const BM_ID_KEY = "META_BUSINESS_ID";

/** Our Meta Business Manager ID, shown to clients in the onboarding card. */
export async function getBusinessManagerId(): Promise<string | null> {
  const admin = await getAdmin();
  const { data } = await admin
    .from("internal_settings")
    .select("value")
    .eq("key", BM_ID_KEY)
    .maybeSingle();
  const value = data?.value?.trim();
  return value ? value : null;
}

export async function setBusinessManagerId(value: string): Promise<void> {
  const admin = await getAdmin();
  const { error } = await admin
    .from("internal_settings")
    .upsert(
      { key: BM_ID_KEY, value: value.trim(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new AdsError(error.message);
}
