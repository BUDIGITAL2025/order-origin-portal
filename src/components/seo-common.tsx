/**
 * Shared primitives for the FlySales SEO admin module (Phase 1 + Phase 2).
 * Cost discipline lives here: every paid action renders its price before it
 * fires, and every result declares whether it was charged or served free from
 * the server-side cache.
 */
import { Database, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/admin-ui";

export type Rec = Record<string, unknown>;
export const asRec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const usd = (n: number | null | undefined, digits = 4): string =>
  n == null ? "—" : `$${n.toFixed(digits)}`;
export const int = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("en-US");

export const ENDPOINTS = {
  domain: "dataforseo_labs/google/domain_rank_overview/live",
  volume: "keywords_data/google_ads/search_volume/live",
  ideas: "keywords_data/google_ads/keywords_for_keywords/live",
  serp: "serp/google/organic/live/advanced",
  competitors: "dataforseo_labs/google/competitors_domain/live",
  gap: "dataforseo_labs/google/domain_intersection/live",
  ranked: "dataforseo_labs/google/ranked_keywords/live",
  blSummary: "backlinks/summary/live",
  blDomains: "backlinks/referring_domains/live",
  blLinks: "backlinks/backlinks/live",
  blAnchors: "backlinks/anchors/live",
} as const;

/** Quick picks — location codes are DataForSEO's stable country codes. */
export const QUICK_MARKETS = [
  { code: 2620, label: "Portugal", lang: "pt" },
  { code: 2724, label: "Spain", lang: "es" },
  { code: 2250, label: "France", lang: "fr" },
  { code: 2276, label: "Germany", lang: "de" },
  { code: 2826, label: "United Kingdom", lang: "en" },
  { code: 2840, label: "United States", lang: "en" },
] as const;

export const LANGUAGES = [
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "en", label: "English" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
] as const;

export type OverageAsk = { spentToday: number; estimatedCost: number; limit: number } | null;
export type AskOverage = (ask: NonNullable<OverageAsk>, retry: () => void) => void;
/** Explicit confirmation for a single action above the big-spend threshold. */
export type ConfirmSpend = (estimatedCost: number, run: () => void) => void;
export const BIG_SPEND_USD = 0.25;

/** Narrow the gateway envelope without leaking its generics into the UI. */
export function readResult(res: unknown): {
  kind: "ok" | "confirm";
  data: unknown;
  cost: number;
  cacheHit: boolean;
  spentToday: number;
  estimatedCost: number;
  limit: number;
} {
  const r = asRec(res);
  if (r["status"] === "confirm") {
    return {
      kind: "confirm",
      data: null,
      cost: 0,
      cacheHit: false,
      spentToday: asNum(r["spentToday"]) ?? 0,
      estimatedCost: asNum(r["estimatedCost"]) ?? 0,
      limit: asNum(r["limit"]) ?? 0,
    };
  }
  return {
    kind: "ok",
    data: r["data"],
    cost: asNum(r["cost"]) ?? 0,
    cacheHit: r["cacheHit"] === true,
    spentToday: 0,
    estimatedCost: 0,
    limit: 0,
  };
}

export function CostButton({
  price,
  running,
  onClick,
  label,
  disabled,
  variant,
}: {
  price: number | undefined;
  running: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  variant?: "default" | "secondary" | "outline";
}) {
  return (
    <Button
      onClick={onClick}
      disabled={running || disabled}
      variant={variant ?? "default"}
      className="gap-2"
    >
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {label}
      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] tabular-nums">
        {price == null ? "cost unknown" : usd(price)}
      </span>
    </Button>
  );
}

export function ResultMeta({ cost, cacheHit }: { cost: number; cacheHit: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {cacheHit ? (
        <Chip tone="success">
          <Database className="h-3 w-3" /> cached · free
        </Chip>
      ) : (
        <Chip tone="info">charged {usd(cost)}</Chip>
      )}
    </div>
  );
}

/** Estimated pre-flight price: per-request base plus per-row surcharge. */
export function estimate(
  prices: Record<string, number>,
  perItem: Record<string, number>,
  endpoint: string,
  rows = 0,
): number {
  const base = prices[endpoint] ?? 0;
  return Math.round((base + (perItem[endpoint] ?? 0) * rows) * 1e6) / 1e6;
}

/** Download any row set as CSV without touching the server. */
export function downloadCsv(name: string, header: string[], rows: Array<Array<unknown>>): void {
  const esc = (v: unknown) =>
    v == null ? "" : `"${String(v).replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([`${header.join(",")}\n${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
