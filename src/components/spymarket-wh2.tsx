/**
 * SpyMarket — WinningHunter phase 2: Store explorer, Brands, Trends and
 * TikTok Shop. ADMIN-ONLY, running alongside the untouched TrendTrack tabs.
 *
 * Discipline is identical to phase 1:
 *  - nothing fires on render; every metered call needs a click,
 *  - the price (flat 1 credit per call) is on the button before it fires,
 *  - one call per action, never a loop — paging is a manual click,
 *  - repeats inside the cache window are free and say so.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  Loader2,
  Search,
  ShoppingBag,
  Store,
  Tag,
} from "lucide-react";
import {
  whBrandTab,
  whFollowBrandByDomain,
  whListBrands,
  whSearchStores,
  whTikTokExplore,
  whTikTokProductDetail,
  whTrendDetail,
  whTrendsSearch,
} from "@/lib/winninghunter.functions";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Defensive accessors — every WinningHunter payload is a legacy dashboard shape.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.-]/g, "");
    if (cleaned !== "" && Number.isFinite(Number(cleaned))) return Number(cleaned);
  }
  return null;
};
const pickStr = (rec: Rec, keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(rec[k]);
    if (v) return v;
  }
  return null;
};
const pickNum = (rec: Rec, keys: string[]): number | null => {
  for (const k of keys) {
    const v = num(rec[k]);
    if (v != null) return v;
  }
  return null;
};
const fmtInt = (v: number | null): string => (v == null ? "—" : Math.round(v).toLocaleString("en"));
const fmtCompact = (v: number | null): string =>
  v == null ? "—" : new Intl.NumberFormat("en", { notation: "compact" }).format(v);
const fmtMoney = (v: number | null): string => (v == null ? "—" : `$${fmtCompact(v)}`);
const fmtPct = (v: number | null): string =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v)}%`;

function rowsOf(payload: unknown, keys: string[] = ["data", "result", "brands", "items"]): Rec[] {
  if (Array.isArray(payload)) return payload.map(asRec);
  const rec = asRec(payload);
  for (const key of keys) {
    const v = rec[key];
    if (Array.isArray(v)) return v.map(asRec);
  }
  return [];
}

/** Generic call state so all four tabs behave identically on failure. */
type CallState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: T; creditsCost: number; cacheHit: boolean; remaining: number | null }
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string };

interface WhEnvelope {
  status: "ok" | "exhausted" | "rate_limited";
  data?: unknown;
  message?: string;
  creditsCost?: number;
  cacheHit?: boolean;
  creditsRemaining?: number | null;
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : "Request failed";
  if (message === "WINNINGHUNTER_NOT_CONFIGURED") return "WINNINGHUNTER_API_KEY is not configured.";
  if (message === "WINNINGHUNTER_TIMEOUT")
    return "WinningHunter did not answer within 30s. No credits were charged — try again.";
  return message;
}

/** Runs one metered call and folds the provider envelope into CallState. */
function useWhAction<T>() {
  const [state, setState] = React.useState<CallState<T>>({ kind: "idle" });
  const queryClient = useQueryClient();
  const run = React.useCallback(
    async (call: () => Promise<WhEnvelope>, map: (data: unknown) => T) => {
      setState({ kind: "loading" });
      try {
        const result = await call();
        void queryClient.invalidateQueries({ queryKey: ["wh-status"] });
        if (result.status !== "ok") {
          setState({
            kind: "notice",
            message: result.message ?? "WinningHunter refused the call.",
          });
          return;
        }
        setState({
          kind: "ok",
          value: map(result.data),
          creditsCost: result.creditsCost ?? 0,
          cacheHit: !!result.cacheHit,
          remaining: result.creditsRemaining ?? null,
        });
      } catch (err) {
        setState({ kind: "error", message: friendly(err) });
      }
    },
    [queryClient],
  );
  return { state, setState, run };
}

function CostChips({ state }: { state: CallState<unknown> }) {
  if (state.kind !== "ok") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="secondary" className="rounded-full">
        Cost: {state.creditsCost} credit{state.creditsCost === 1 ? "" : "s"}
      </Badge>
      {state.cacheHit && (
        <Badge className="rounded-full bg-primary/15 text-primary hover:bg-primary/15">
          cache hit — free
        </Badge>
      )}
      {state.remaining != null && (
        <Badge variant="outline" className="rounded-full">
          {fmtInt(state.remaining)} credits left
        </Badge>
      )}
    </div>
  );
}

function StateAlerts({ state }: { state: CallState<unknown> }) {
  if (state.kind === "notice")
    return (
      <Alert>
        <AlertTitle>WinningHunter says</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  if (state.kind === "error")
    return (
      <Alert variant="destructive">
        <AlertTitle>Call failed</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  return null;
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Inline sparkline — used wherever the payload hands us a series. */
function Sparkline({
  values,
  className,
  height = 26,
  width = 92,
}: {
  values: number[];
  className?: string;
  height?: number;
  width?: number;
}) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const rising = (values.at(-1) ?? 0) >= (values[0] ?? 0);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.6}
        className={rising ? "stroke-primary" : "stroke-muted-foreground"}
      />
    </svg>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 rounded-full px-2 text-[11px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
      {done ? "Copied" : label}
    </Button>
  );
}

// ===========================================================================
// 1. Store explorer (Shopify Explorer + Tracker)
// ===========================================================================

interface WhStore {
  key: string;
  name: string;
  domain: string | null;
  icon: string | null;
  screenshot: string | null;
  country: string | null;
  category: string | null;
  monthlyVisits: number | null;
  visitsSeries: number[];
  visitsHistorical: Array<{ month: string; value: number }>;
  growthM1: number | null;
  growthM3: number | null;
  rev30Min: number | null;
  rev30Max: number | null;
  revDailyMin: number | null;
  revDailyMax: number | null;
  aov: number | null;
  products: number | null;
  activeAds: number | null;
  firstProduct: string | null;
  topCountries: Array<{ code: string; pct: number }>;
  bestsellers: Array<{ title: string; price: number | null; image: string | null }>;
  emails: string[];
  trustpilot: { rating: number | null; reviews: number | null };
  raw: Rec;
}

function normaliseStore(row: Rec, index: number): WhStore {
  const historical = asRec(row["monthly_visits_historical"]);
  const months = Object.keys(historical).sort();
  const visitsHistorical = months
    .map((m) => ({ month: m, value: num(historical[m]) ?? 0 }))
    .filter((p) => p.value > 0);
  const revenue = asRec(row["estimated_revenue"]);
  const monthly = asRec(revenue["monthly"]);
  const daily = asRec(revenue["daily"]);
  const trust = asRec(row["trustpilot_tp_data"]);
  return {
    key: pickStr(row, ["storeid", "domain"]) ?? String(pickNum(row, ["shopid"]) ?? index),
    name: pickStr(row, ["name", "domain"]) ?? "Unnamed store",
    domain: pickStr(row, ["domain"]),
    icon: pickStr(row, ["icon"]),
    screenshot: pickStr(row, ["screenshot_path"]),
    country: pickStr(row, ["owner_country"]),
    category: pickStr(row, ["category_v2_l2", "category_v2_l1", "category"]) ?? null,
    monthlyVisits: pickNum(row, ["monthly_visits"]),
    visitsSeries: visitsHistorical.map((p) => p.value),
    visitsHistorical,
    growthM1: pickNum(row, ["visits_growth_pct_m1"]),
    growthM3: pickNum(row, ["visits_growth_pct_m3"]),
    rev30Min: pickNum(row, ["30d_rev_estimated_min"]) ?? num(monthly["min"]),
    rev30Max: pickNum(row, ["30d_rev_estimated_max"]) ?? num(monthly["max"]),
    revDailyMin: num(daily["min"]) ?? pickNum(row, ["1d_rev_estimated_min"]),
    revDailyMax: num(daily["max"]) ?? pickNum(row, ["1d_rev_estimated_max"]),
    aov: pickNum(row, ["aov"]),
    products: pickNum(row, ["published_products_count"]),
    activeAds: pickNum(row, ["active_ad_count", "explore_wlads_ad_count"]),
    firstProduct: pickStr(row, ["first_product_date"]),
    topCountries: asArr(row["top_countries"])
      .map(asRec)
      .map((c) => ({ code: str(c["countryCode"]) ?? "?", pct: num(c["sharePercentage"]) ?? 0 }))
      .filter((c) => c.pct > 0)
      .slice(0, 6),
    bestsellers: asArr(row["bestsellers"])
      .map(asRec)
      .map((p) => ({
        title: pickStr(p, ["title", "product_name", "name", "handle"]) ?? "Product",
        price: pickNum(p, ["price"]),
        image: pickStr(p, ["image"]),
      }))
      .slice(0, 12),
    emails: asArr(row["website_emails"])
      .map((e) => (typeof e === "string" ? e : str(asRec(e)["email"])))
      .filter((e): e is string => !!e)
      .slice(0, 6),
    trustpilot: {
      rating: num(trust["score"]) ?? num(trust["rating"]) ?? num(trust["stars"]),
      reviews: num(trust["reviews"]) ?? num(trust["numberOfReviews"]),
    },
    raw: row,
  };
}

const STORE_SORTS = [
  { value: "revenue_30d", label: "Revenue (30d)" },
  { value: "monthly_visits", label: "Monthly visits" },
  { value: "revenue_1y", label: "Revenue (1y)" },
  { value: "aov", label: "Average order value" },
  { value: "visits_growth_pct_m1", label: "Traffic growth (1m)" },
  { value: "visits_growth_pct_m3", label: "Traffic growth (3m)" },
];

const STORE_CATEGORIES = [
  "Clothing",
  "Arts & Crafts",
  "Accessories",
  "Beauty",
  "Health",
  "Toys & Games",
  "Electronics",
  "Pet Supplies",
  "Other",
];

export function WhStoreExplorerTab({
  url,
  go,
}: {
  url: Record<string, string | undefined>;
  go: (patch: Record<string, string | undefined>, opts?: { push?: boolean }) => void;
}) {
  const searchStores = useServerFn(whSearchStores);
  const [q, setQ] = React.useState(url["wsq"] ?? "");
  const [country, setCountry] = React.useState(url["wsc"] ?? "");
  const [category, setCategory] = React.useState("all");
  const [sorting, setSorting] = React.useState("revenue_30d");
  const [minRevenue, setMinRevenue] = React.useState("");
  const [minVisits, setMinVisits] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [detail, setDetail] = React.useState<WhStore | null>(null);
  const { state, run } = useWhAction<WhStore[]>();

  const numeric = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
  };

  const search = (nextPage: number) => {
    setPage(nextPage);
    go({ wsq: q || undefined, wsc: country || undefined });
    void run(
      () =>
        searchStores({
          data: {
            search: q.trim() || undefined,
            country: country.trim() || undefined,
            category: category !== "all" ? category : undefined,
            sortingKey: sorting,
            sortingDirection: "desc" as const,
            page: nextPage,
            pageSize: 50,
            minRevenue: numeric(minRevenue),
            monthlyVisitsMin: numeric(minVisits),
          },
        }),
      (data) => rowsOf(data).map(normaliseStore),
    );
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Store className="h-4 w-4 text-primary" />
            Store explorer — WinningHunter
            <Badge variant="secondary" className="rounded-full text-[10px]">
              50 stores per credit
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Store name, domain or keyword</Label>
              <Input
                value={q}
                placeholder="e.g. pet, glow, mystore.com"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") search(1);
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Merchant country</Label>
              <Input
                value={country}
                placeholder="PT, US, ES…"
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <Label className="text-xs">Niche</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any niche</SelectItem>
                  {STORE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sort by</Label>
              <Select value={sorting} onValueChange={setSorting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORE_SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Min revenue (30d, $)</Label>
              <Input
                inputMode="numeric"
                value={minRevenue}
                placeholder="e.g. 50000"
                onChange={(e) => setMinRevenue(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div>
              <Label className="text-xs">Min monthly visits</Label>
              <Input
                inputMode="numeric"
                value={minVisits}
                placeholder="e.g. 20000"
                onChange={(e) => setMinVisits(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => search(1)} disabled={state.kind === "loading"}>
              {state.kind === "loading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search stores — 1 credit
            </Button>
            <span className="text-xs text-muted-foreground">
              Flat 1 credit per page, so we always ask for the biggest page (50). Repeats within 24h
              are free.
            </span>
          </div>
        </CardContent>
      </Card>

      <StateAlerts state={state} />
      {state.kind === "loading" && <TableSkeleton />}

      {state.kind === "ok" && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CostChips state={state} />
              <Badge variant="outline" className="rounded-full text-xs">
                {fmtInt(state.value.length)} stores · page {page}
              </Badge>
            </div>
            {state.value.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No stores matched. Widen the filters and search again.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store</TableHead>
                      <TableHead>Niche</TableHead>
                      <TableHead className="text-right">Monthly visits</TableHead>
                      <TableHead>Trend (6m)</TableHead>
                      <TableHead className="text-right">Growth 1m</TableHead>
                      <TableHead className="text-right">Est. revenue 30d</TableHead>
                      <TableHead className="text-right">AOV</TableHead>
                      <TableHead className="text-right">Products</TableHead>
                      <TableHead className="text-right">Active ads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.value.map((s) => (
                      <TableRow
                        key={s.key}
                        className="cursor-pointer"
                        onClick={() => setDetail(s)}
                        title="Open store detail (free — uses the row we already paid for)"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {s.icon ? (
                              <img
                                src={s.icon.startsWith("//") ? `https:${s.icon}` : s.icon}
                                alt=""
                                loading="lazy"
                                className="h-6 w-6 rounded border object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : null}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{s.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {s.domain ?? "—"} {s.country ? `· ${s.country}` : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{s.category ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">
                          {fmtCompact(s.monthlyVisits)}
                        </TableCell>
                        <TableCell>
                          <Sparkline values={s.visitsSeries} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right text-xs",
                            (s.growthM1 ?? 0) > 0 && "text-primary",
                          )}
                        >
                          {fmtPct(s.growthM1)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {s.rev30Min == null && s.rev30Max == null
                            ? "—"
                            : `${fmtMoney(s.rev30Min)}–${fmtMoney(s.rev30Max)}`}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {s.aov ? fmtMoney(s.aov) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmtInt(s.products)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtInt(s.activeAds)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {state.value.length > 0 && (
              <div className="flex items-center justify-center gap-2">
                {page > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => search(page - 1)}
                  >
                    Previous page — 1 credit
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => search(page + 1)}
                >
                  Next page — 1 credit
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <StoreDetailDialog store={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function StoreDetailDialog({ store, onClose }: { store: WhStore | null; onClose: () => void }) {
  return (
    <Dialog open={!!store} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {store?.name}
            {store?.domain && (
              <a
                href={`https://${store.domain}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:underline"
              >
                {store.domain}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </DialogTitle>
        </DialogHeader>
        {store && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Everything below came with the search row you already paid for — opening this panel
              costs nothing.
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Monthly visits", value: fmtCompact(store.monthlyVisits) },
                {
                  label: "Revenue 30d",
                  value: `${fmtMoney(store.rev30Min)}–${fmtMoney(store.rev30Max)}`,
                },
                {
                  label: "Revenue / day",
                  value: `${fmtMoney(store.revDailyMin)}–${fmtMoney(store.revDailyMax)}`,
                },
                { label: "AOV", value: store.aov ? fmtMoney(store.aov) : "—" },
                { label: "Products", value: fmtInt(store.products) },
                { label: "Active ads", value: fmtInt(store.activeAds) },
                { label: "Growth 1m", value: fmtPct(store.growthM1) },
                { label: "Growth 3m", value: fmtPct(store.growthM3) },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-xl border bg-muted/30 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {kpi.label}
                  </p>
                  <p className="text-sm font-semibold">{kpi.value}</p>
                </div>
              ))}
            </div>

            {store.visitsHistorical.length > 1 && (
              <div className="rounded-xl border p-3">
                <p className="mb-2 text-xs font-semibold">Traffic over time</p>
                <Sparkline
                  values={store.visitsHistorical.map((p) => p.value)}
                  width={420}
                  height={70}
                  className="w-full"
                />
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  {store.visitsHistorical.map((p) => (
                    <span key={p.month}>
                      {p.month}: {fmtCompact(p.value)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {store.topCountries.length > 0 && (
              <div className="rounded-xl border p-3">
                <p className="mb-2 text-xs font-semibold">Where the traffic comes from</p>
                <div className="space-y-1.5">
                  {store.topCountries.map((c) => (
                    <div key={c.code} className="flex items-center gap-2 text-xs">
                      <span className="w-8 font-medium">{c.code}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(c.pct, 100)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-muted-foreground">
                        {c.pct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {store.bestsellers.length > 0 && (
              <div className="rounded-xl border p-3">
                <p className="mb-2 text-xs font-semibold">Bestsellers</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {store.bestsellers.map((p, i) => (
                    <div key={`${p.title}-${i}`} className="rounded-lg border p-2">
                      {p.image && (
                        <img
                          src={p.image}
                          alt=""
                          loading="lazy"
                          className="mb-1 aspect-square w-full rounded object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <p className="line-clamp-2 text-[11px] font-medium">{p.title}</p>
                      {p.price != null && (
                        <p className="text-[11px] text-muted-foreground">{fmtMoney(p.price)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs">
              {store.firstProduct && (
                <Badge variant="outline" className="rounded-full">
                  first product {store.firstProduct.slice(0, 10)}
                </Badge>
              )}
              {store.trustpilot.rating != null && (
                <Badge variant="outline" className="rounded-full">
                  Trustpilot {store.trustpilot.rating} ({fmtInt(store.trustpilot.reviews)})
                </Badge>
              )}
              {store.emails.map((e) => (
                <Badge key={e} variant="secondary" className="rounded-full">
                  {e}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// 2. Brands
// ===========================================================================

interface WhBrand {
  id: string;
  name: string;
  logo: string | null;
  domain: string | null;
  status: string | null;
  totalAds: number | null;
  activeAds: number | null;
  newAds: number | null;
  newAdsChange: number | null;
  traffic: number | null;
  formats: Array<{ label: string; value: number }>;
  addedAt: string | null;
}

const BRAND_LOGO_HOST = "https://media.winninghunter.com/";
const brandLogo = (v: string | null): string | null =>
  !v ? null : /^https?:\/\//i.test(v) ? v : `${BRAND_LOGO_HOST}${v.replace(/^\/+/, "")}`;

function normaliseBrand(row: Rec, index: number): WhBrand {
  const formats = asRec(row["formats"]);
  return {
    id: pickStr(row, ["id", "page_id"]) ?? String(index),
    name: pickStr(row, ["name"]) ?? "Unnamed brand",
    logo: brandLogo(pickStr(row, ["logo_url", "logo"])),
    domain: pickStr(row, ["primary_domain", "domain"]),
    status: pickStr(row, ["status"]),
    totalAds: pickNum(row, ["total_ads"]),
    activeAds: pickNum(row, ["active_ads_on_page", "active_ads"]),
    newAds: pickNum(row, ["new_ads_count"]),
    newAdsChange: pickNum(row, ["new_ads_change"]),
    traffic: pickNum(row, ["traffic"]),
    formats: Object.entries(formats)
      .map(([label, value]) => ({ label, value: num(value) ?? 0 }))
      .filter((f) => f.value > 0),
    addedAt: pickStr(row, ["added_at"]),
  };
}

/** Creative-strategy tabs, in the order the creative team actually uses them. */
const BRAND_DETAIL_TABS = [
  { id: "ad-hooks", label: "Hooks" },
  { id: "ad-headlines", label: "Headlines" },
  { id: "ad-copies", label: "Ad copies" },
  { id: "personas", label: "Personas" },
  { id: "angles", label: "Angles" },
  { id: "desires", label: "Desires" },
  { id: "emotions", label: "Emotions" },
  { id: "themes", label: "Themes" },
  { id: "usps", label: "USPs" },
  { id: "awareness-stages", label: "Awareness" },
  { id: "funnel-stages", label: "Funnel" },
  { id: "landing-pages", label: "Landing pages" },
  { id: "associated-domains", label: "Domains" },
  { id: "overview-cards", label: "Overview" },
] as const;
type BrandDetailTab = (typeof BRAND_DETAIL_TABS)[number]["id"];

/** One insight row, whatever key their per-tab payload happens to use. */
interface BrandInsight {
  text: string;
  meta: string[];
  url: string | null;
}

function normaliseInsights(payload: unknown): BrandInsight[] {
  const rows = rowsOf(payload, ["data", "items", "result", "rows"]);
  const out: BrandInsight[] = [];
  for (const row of rows) {
    const text = pickStr(row, [
      "transcript",
      "hook",
      "headline",
      "copy",
      "text",
      "title",
      "persona",
      "angle",
      "desire",
      "emotion",
      "theme",
      "usp",
      "stage",
      "name",
      "label",
      "value",
      "url",
      "domain",
    ]);
    if (!text) continue;
    const meta: string[] = [];
    const count = pickNum(row, ["count", "ads_count", "total", "ad_count"]);
    if (count != null) meta.push(`${fmtInt(count)} ads`);
    const days = pickNum(row, ["max_days_running", "days_running"]);
    if (days != null) meta.push(`${fmtInt(days)}d max run`);
    const share = pickNum(row, ["percentage", "share", "pct"]);
    if (share != null) meta.push(`${Math.round(share)}%`);
    const description = pickStr(row, ["description", "summary"]);
    if (description && description !== text) meta.push(description);
    out.push({ text, meta, url: pickStr(row, ["url", "landing_page", "page_url"]) });
  }
  if (out.length === 0) {
    // overview-cards and friends return an object of scalars, not a list.
    const rec = asRec(asRec(payload)["data"] ?? payload);
    for (const [key, value] of Object.entries(rec)) {
      if (typeof value === "number" || typeof value === "string") {
        out.push({ text: `${key.replace(/_/g, " ")}: ${String(value)}`, meta: [], url: null });
      }
    }
  }
  return out;
}

export function WhBrandsTab({
  url,
  go,
}: {
  url: Record<string, string | undefined>;
  go: (patch: Record<string, string | undefined>, opts?: { push?: boolean }) => void;
}) {
  const listFn = useServerFn(whListBrands);
  const followFn = useServerFn(whFollowBrandByDomain);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState("active_ads");
  const [page, setPage] = React.useState(1);
  const [followDomain, setFollowDomain] = React.useState("");
  const [followState, setFollowState] = React.useState<string | null>(null);
  const [following, setFollowing] = React.useState(false);
  const [selected, setSelected] = React.useState<WhBrand | null>(null);
  const { state, run } = useWhAction<WhBrand[]>();

  const load = (nextPage: number) => {
    setPage(nextPage);
    void run(
      () =>
        listFn({
          data: {
            search: search.trim() || undefined,
            sort,
            dir: "desc" as const,
            page: nextPage,
            limit: 50,
          },
        }),
      (data) => rowsOf(data, ["brands", "data"]).map(normaliseBrand),
    );
  };

  React.useEffect(() => {
    if (!selected && url["wbid"]) go({ wbid: undefined });
  }, [selected, url, go]);

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Tag className="h-4 w-4 text-primary" />
            Brands — WinningHunter
            <Badge variant="secondary" className="rounded-full text-[10px]">
              hooks · personas · landers
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Filter tracked brands</Label>
              <Input
                value={search}
                placeholder="brand name"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load(1);
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Sort by</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active_ads">Most active ads</SelectItem>
                  <SelectItem value="new_ads">Most new ads</SelectItem>
                  <SelectItem value="growth">Fastest growing</SelectItem>
                  <SelectItem value="traffic">Most traffic</SelectItem>
                  <SelectItem value="revenue">Most revenue</SelectItem>
                  <SelectItem value="date_added">Recently added</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => load(1)}
                disabled={state.kind === "loading"}
              >
                {state.kind === "loading" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Load brands — 1 credit
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/30 p-3">
            <div className="min-w-48 flex-1">
              <Label className="text-xs">Track a new brand by domain</Label>
              <Input
                value={followDomain}
                placeholder="allbirds.com"
                onChange={(e) => setFollowDomain(e.target.value.trim().toLowerCase())}
              />
            </div>
            <Button
              variant="outline"
              disabled={following || followDomain.length < 3}
              onClick={async () => {
                setFollowing(true);
                setFollowState(null);
                try {
                  const result = await followFn({ data: { domain: followDomain } });
                  setFollowState(
                    result.status === "ok"
                      ? `Tracking requested for ${followDomain}. Reload the list in a minute.`
                      : (result.message ?? "WinningHunter refused the request."),
                  );
                } catch (err) {
                  setFollowState(friendly(err));
                } finally {
                  setFollowing(false);
                }
              }}
            >
              {following && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Track brand — 1 credit
            </Button>
            {followState && <p className="text-xs text-muted-foreground">{followState}</p>}
          </div>
        </CardContent>
      </Card>

      <StateAlerts state={state} />
      {state.kind === "loading" && <TableSkeleton />}

      {state.kind === "ok" && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CostChips state={state} />
              <Badge variant="outline" className="rounded-full text-xs">
                {fmtInt(state.value.length)} brands · page {page}
              </Badge>
            </div>
            {state.value.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tracked brands yet — track one by domain above, then reload.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Brand</TableHead>
                      <TableHead className="text-right">Active ads</TableHead>
                      <TableHead className="text-right">Total ads</TableHead>
                      <TableHead className="text-right">New ads</TableHead>
                      <TableHead className="text-right">Traffic</TableHead>
                      <TableHead>Formats</TableHead>
                      <TableHead>Added</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.value.map((b) => (
                      <TableRow
                        key={b.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(b)}
                        title="Open brand intelligence"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {b.logo && (
                              <img
                                src={b.logo}
                                alt=""
                                loading="lazy"
                                className="h-6 w-6 rounded-full border object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{b.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {b.domain ?? "—"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmtInt(b.activeAds)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtInt(b.totalAds)}</TableCell>
                        <TableCell className="text-right text-xs">
                          {fmtInt(b.newAds)}
                          {b.newAdsChange != null && (
                            <span
                              className={cn(
                                "ml-1",
                                b.newAdsChange > 0 ? "text-primary" : "text-muted-foreground",
                              )}
                            >
                              {fmtPct(b.newAdsChange)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {b.traffic ? fmtCompact(b.traffic) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {b.formats.map((f) => (
                              <Badge
                                key={f.label}
                                variant="outline"
                                className="rounded-full text-[10px]"
                              >
                                {f.label} {f.value}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {b.addedAt ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {state.value.length > 0 && (
              <div className="flex items-center justify-center gap-2">
                {page > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => load(page - 1)}
                  >
                    Previous page — 1 credit
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => load(page + 1)}
                >
                  Next page — 1 credit
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <BrandDetailDialog brand={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BrandDetailDialog({ brand, onClose }: { brand: WhBrand | null; onClose: () => void }) {
  const tabFn = useServerFn(whBrandTab);
  const [tab, setTab] = React.useState<BrandDetailTab>("ad-hooks");
  const { state, setState, run } = useWhAction<BrandInsight[]>();

  React.useEffect(() => {
    // Opening the panel is free: the first fetch still needs a click.
    setState({ kind: "idle" });
    setTab("ad-hooks");
  }, [brand, setState]);

  const load = (next: BrandDetailTab) => {
    if (!brand) return;
    setTab(next);
    void run(() => tabFn({ data: { id: brand.id, tab: next } }), normaliseInsights);
  };

  return (
    <Dialog open={!!brand} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {brand?.name} {brand?.domain ? `· ${brand.domain}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Each panel below is one call — 1 credit, cached 24h. Nothing loads until you pick one.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BRAND_DETAIL_TABS.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={tab === t.id && state.kind !== "idle" ? "default" : "outline"}
                className="rounded-full text-[11px]"
                onClick={() => load(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>

          <StateAlerts state={state} />
          {state.kind === "idle" && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Pick a panel above — each costs 1 credit.
            </p>
          )}
          {state.kind === "loading" && <TableSkeleton rows={5} />}
          {state.kind === "ok" && (
            <div className="space-y-2">
              <CostChips state={state} />
              {state.value.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  WinningHunter has nothing indexed for this panel yet.
                </p>
              ) : (
                state.value.map((item, i) => (
                  <div
                    key={`${item.text}-${i}`}
                    className="flex items-start gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">{item.text}</p>
                      {item.meta.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.meta.join(" · ")}
                        </p>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"
                        >
                          open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <CopyButton text={item.text} />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// 3. Trends (Exploding Topics)
// ===========================================================================

interface WhTrend {
  keyword: string;
  path: string;
  description: string | null;
  volume: number | null;
  growth3: number | null;
  growth6: number | null;
  growth12: number | null;
  series: number[];
  raw: Rec;
}

function normaliseTrend(row: Rec): WhTrend {
  const history = asRec(row["search_history"]);
  const growth = asRec(history["growth"]);
  const points = asArr(history["last_12_months"]).length
    ? asArr(history["last_12_months"])
    : asArr(history["last_3_months"]);
  return {
    keyword: pickStr(row, ["keyword", "path"]) ?? "—",
    path: pickStr(row, ["path", "keyword"]) ?? "",
    description: pickStr(row, ["description"]),
    volume: pickNum(row, ["absolute_volume", "volume"]),
    growth3: num(growth["3"]),
    growth6: num(growth["6"]),
    growth12: num(growth["12"]),
    series: points.map((p) => num(asRec(p)["value"]) ?? 0),
    raw: row,
  };
}

export function WhTrendsTab() {
  const searchFn = useServerFn(whTrendsSearch);
  const detailFn = useServerFn(whTrendDetail);
  const [query, setQuery] = React.useState("");
  const [sorting, setSorting] = React.useState("growth");
  const [timeframe, setTimeframe] = React.useState("default");
  const [offset, setOffset] = React.useState(0);
  const [filter, setFilter] = React.useState("");
  const [detail, setDetail] = React.useState<WhTrend | null>(null);
  const { state, run } = useWhAction<WhTrend[]>();
  const detailCall = useWhAction<Rec>();

  const load = (nextOffset: number) => {
    setOffset(nextOffset);
    void run(
      () =>
        searchFn({
          data: {
            query: query.trim() || undefined,
            sorting,
            timeframe: timeframe !== "default" ? timeframe : undefined,
            offset: nextOffset || undefined,
          },
        }),
      (data) => rowsOf(data, ["result", "data"]).map(normaliseTrend),
    );
  };

  const visible =
    state.kind === "ok"
      ? state.value.filter((t) =>
          filter.trim() === ""
            ? true
            : `${t.keyword} ${t.description ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
        )
      : [];

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Flame className="h-4 w-4 text-primary" />
            Trends — exploding topics
            <Badge variant="secondary" className="rounded-full text-[10px]">
              new capability
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-xs">Exact topic (optional)</Label>
              <Input
                value={query}
                placeholder="leave empty to browse the feed"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Sort by</Label>
              <Select value={sorting} onValueChange={setSorting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="growth">Fastest growth</SelectItem>
                  <SelectItem value="exponent">Most exponential</SelectItem>
                  <SelectItem value="gradient">Steadiest climb</SelectItem>
                  <SelectItem value="absolute_volume">Biggest volume</SelectItem>
                  <SelectItem value="date_added">Recently added</SelectItem>
                  <SelectItem value="default">Default</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Timeframe (months)</Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="24">24</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Filter loaded rows (free)</Label>
              <Input
                value={filter}
                placeholder="pet, kitchen…"
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => load(0)} disabled={state.kind === "loading"}>
              {state.kind === "loading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Load trends — 1 credit
            </Button>
            <span className="text-xs text-muted-foreground">
              Their topic search only matches exact topics; leave it empty to browse and use the
              free filter on the loaded page.
            </span>
          </div>
        </CardContent>
      </Card>

      <StateAlerts state={state} />
      {state.kind === "loading" && <TableSkeleton />}

      {state.kind === "ok" && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CostChips state={state} />
              <Badge variant="outline" className="rounded-full text-xs">
                {fmtInt(visible.length)} of {fmtInt(state.value.length)} topics
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">3m</TableHead>
                    <TableHead className="text-right">6m</TableHead>
                    <TableHead className="text-right">12m</TableHead>
                    <TableHead>Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((t) => (
                    <TableRow
                      key={t.path || t.keyword}
                      className="cursor-pointer"
                      onClick={() => {
                        setDetail(t);
                        void detailCall.run(
                          () => detailFn({ data: { topic: t.path || t.keyword } }),
                          (data) => asRec(data),
                        );
                      }}
                      title="Open topic detail — 1 credit"
                    >
                      <TableCell className="max-w-md">
                        <p className="text-xs font-semibold capitalize">{t.keyword}</p>
                        {t.description && (
                          <p className="line-clamp-2 text-[11px] text-muted-foreground">
                            {t.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmtCompact(t.volume)}</TableCell>
                      <TableCell
                        className={cn("text-right text-xs", (t.growth3 ?? 0) > 0 && "text-primary")}
                      >
                        {fmtPct(t.growth3)}
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmtPct(t.growth6)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtPct(t.growth12)}</TableCell>
                      <TableCell>
                        <Sparkline values={t.series} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-center gap-2">
              {offset > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => load(Math.max(offset - 20, 0))}
                >
                  Previous — 1 credit
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => load(offset + 20)}
              >
                More topics — 1 credit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm capitalize">{detail?.keyword}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              {detail.description && (
                <p className="text-xs text-muted-foreground">{detail.description}</p>
              )}
              <Sparkline values={detail.series} width={420} height={80} className="w-full" />
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="rounded-full">
                  volume {fmtCompact(detail.volume)}
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  3m {fmtPct(detail.growth3)}
                </Badge>
                <Badge variant="outline" className="rounded-full">
                  12m {fmtPct(detail.growth12)}
                </Badge>
                <CopyButton text={detail.keyword} label="Copy topic" />
              </div>
              <StateAlerts state={detailCall.state} />
              {detailCall.state.kind === "loading" && <TableSkeleton rows={3} />}
              {detailCall.state.kind === "ok" && (
                <div className="space-y-2">
                  <CostChips state={detailCall.state} />
                  <pre className="max-h-72 overflow-auto rounded-xl border bg-muted/40 p-3 text-[11px]">
                    {JSON.stringify(detailCall.state.value, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===========================================================================
// 4. TikTok Shop
// ===========================================================================

type TtResource = "products" | "shops" | "creators" | "videos";

const TT_RESOURCES: ReadonlyArray<{ id: TtResource; label: string }> = [
  { id: "products", label: "Products" },
  { id: "shops", label: "Shops" },
  { id: "creators", label: "Creators" },
  { id: "videos", label: "Videos" },
];

const TT_SORTS: Record<TtResource, ReadonlyArray<{ value: string; label: string }>> = {
  products: [
    { value: "revenue", label: "Revenue" },
    { value: "sold_count", label: "Units sold" },
    { value: "revenue_growth_rate", label: "Revenue growth" },
    { value: "sales_growth_rate", label: "Sales growth" },
    { value: "product_score", label: "Product score" },
    { value: "first_seen", label: "Newest" },
  ],
  shops: [
    { value: "revenue", label: "Revenue" },
    { value: "sold_count", label: "Units sold" },
    { value: "revenue_growth_rate", label: "Revenue growth" },
  ],
  creators: [
    { value: "revenue", label: "Revenue" },
    { value: "follower_count", label: "Followers" },
    { value: "video_count", label: "Videos" },
  ],
  videos: [
    { value: "revenue", label: "Revenue" },
    { value: "gpm", label: "GPM" },
    { value: "view_count", label: "Views" },
  ],
};

interface TtRow {
  key: string;
  title: string;
  image: string | null;
  price: string | null;
  revenue: number | null;
  sold: number | null;
  growth30: number | null;
  rating: number | null;
  reviews: number | null;
  creators: number | null;
  commission: number | null;
  url: string | null;
  id: string | null;
}

function normaliseTt(row: Rec, index: number): TtRow {
  return {
    key: pickStr(row, ["id", "product_id", "shop_id", "creator_id", "video_id"]) ?? String(index),
    id: pickStr(row, ["id", "product_id"]),
    title:
      pickStr(row, [
        "product_title",
        "shop_name",
        "creator_name",
        "video_title",
        "title",
        "name",
      ]) ?? "—",
    image: pickStr(row, ["product_image", "shop_logo", "creator_avatar", "cover", "avatar"]),
    price: pickStr(row, ["unit_price", "avg_unit_price"]),
    revenue: pickNum(row, ["revenue", "revenue_30_days", "revenue_lifetime", "gmv"]),
    sold: pickNum(row, ["sold_count", "item_sold", "sold_count_lifetime"]),
    growth30: pickNum(row, ["revenue_growth_rate_30d", "revenue_growth_rate", "sales_growth_rate"]),
    rating: pickNum(row, ["product_rating", "rating"]),
    reviews: pickNum(row, ["product_review_cnt", "review_cnt"]),
    creators: pickNum(row, ["creator_num", "creator_count", "follower_count"]),
    commission: pickNum(row, ["commission_rate"]),
    url: pickStr(row, [
      "winninghunter_product_url",
      "tiktok_shop_product_url",
      "winninghunter_shop_url",
      "tiktok_shop_url",
    ]),
  };
}

export function WhTikTokShopTab() {
  const exploreFn = useServerFn(whTikTokExplore);
  const detailFn = useServerFn(whTikTokProductDetail);
  const [resource, setResource] = React.useState<TtResource>("products");
  const [name, setName] = React.useState("");
  const [country, setCountry] = React.useState("US");
  const [period, setPeriod] = React.useState("30d");
  const [sort, setSort] = React.useState("revenue");
  const [page, setPage] = React.useState(1);
  const [detailFor, setDetailFor] = React.useState<TtRow | null>(null);
  const { state, run } = useWhAction<TtRow[]>();
  const detailCall = useWhAction<Rec>();

  const load = (nextPage: number) => {
    setPage(nextPage);
    void run(
      () =>
        exploreFn({
          data: {
            resource,
            name: name.trim() || undefined,
            country: country.trim() || "US",
            period,
            sort,
            order: "desc" as const,
            page: nextPage,
            limit: 50,
          },
        }),
      (data) => rowsOf(data).map(normaliseTt),
    );
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ShoppingBag className="h-4 w-4 text-primary" />
            TikTok Shop
            <Badge variant="secondary" className="rounded-full text-[10px]">
              sourcing demand signal
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TT_RESOURCES.map((r) => (
              <Button
                key={r.id}
                size="sm"
                variant={resource === r.id ? "default" : "outline"}
                className="rounded-full"
                onClick={() => {
                  setResource(r.id);
                  setSort(TT_SORTS[r.id][0]?.value ?? "revenue");
                }}
              >
                {r.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Name contains</Label>
              <Input
                value={name}
                placeholder="magnesium, dog bed…"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load(1);
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Market</Label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                placeholder="US"
              />
            </div>
            <div>
              <Label className="text-xs">Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sort by</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TT_SORTS[resource].map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={() => load(1)} disabled={state.kind === "loading"}>
            {state.kind === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Explore {resource} — 1 credit
          </Button>
        </CardContent>
      </Card>

      <StateAlerts state={state} />
      {state.kind === "loading" && <TableSkeleton />}

      {state.kind === "ok" && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CostChips state={state} />
              <Badge variant="outline" className="rounded-full text-xs">
                {fmtInt(state.value.length)} rows · page {page}
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Growth 30d</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.value.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {r.image && (
                            <img
                              src={r.image}
                              alt=""
                              loading="lazy"
                              className="h-8 w-8 rounded border object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                          <p className="line-clamp-2 max-w-sm text-xs font-medium">{r.title}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.price ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{fmtMoney(r.revenue)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtCompact(r.sold)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-xs",
                          (r.growth30 ?? 0) > 0 && "text-primary",
                        )}
                      >
                        {fmtPct(r.growth30)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.rating != null
                          ? `${r.rating.toFixed(1)} (${fmtCompact(r.reviews)})`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.commission != null ? `${Math.round(r.commission)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {resource === "products" && r.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 rounded-full px-2 text-[11px]"
                              onClick={() => {
                                setDetailFor(r);
                                void detailCall.run(
                                  () => detailFn({ data: { id: r.id!, period } }),
                                  (data) => asRec(data),
                                );
                              }}
                            >
                              Details — 1 credit
                            </Button>
                          )}
                          {r.url && (
                            <Button
                              asChild
                              size="sm"
                              variant="ghost"
                              className="h-7 rounded-full px-2"
                            >
                              <a href={r.url} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-center gap-2">
              {page > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => load(page - 1)}
                >
                  Previous page — 1 credit
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => load(page + 1)}
              >
                Next page — 1 credit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!detailFor} onOpenChange={(open) => !open && setDetailFor(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">{detailFor?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <StateAlerts state={detailCall.state} />
            {detailCall.state.kind === "loading" && <TableSkeleton rows={4} />}
            {detailCall.state.kind === "ok" && (
              <>
                <CostChips state={detailCall.state} />
                <pre className="max-h-96 overflow-auto rounded-xl border bg-muted/40 p-3 text-[11px]">
                  {JSON.stringify(detailCall.state.value, null, 2)}
                </pre>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
