/**
 * SpyMarket research tool — ADMIN-ONLY internal UI over the Trendtrack API.
 * Every metered action shows its worst-case credit cost before executing and
 * its real cost after; beyond the per-user daily soft limit an extra
 * confirmation is required. All data flows through spymarket-tools.functions
 * (server-side gateway with 24h cache + usage log) — never from the browser.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Database,
  ExternalLink,
  Eye,
  FlaskConical,
  Loader2,
  Megaphone,
  Package,
  Play,
  Search,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import {
  getSpyMarketToolsStatus,
  spymarketCategories,
  spymarketGetShop,
  spymarketGetShopTab,
  spymarketGetUsageDashboard,
  spymarketLookup,
  spymarketQueryShops,
  spymarketSearchAds,
} from "@/lib/spymarket-tools.functions";
import type { ToolOk, ToolResult } from "@/lib/spymarket-tools.server";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Defensive accessors — Trendtrack payloads are Json, shapes evolve.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const dataRows = (payload: unknown): Rec[] => asArr(asRec(payload)["data"]).map(asRec);
const fmtCompact = (v: number | null): string =>
  v == null ? "—" : new Intl.NumberFormat("en", { notation: "compact" }).format(v);
const fmtInt = (v: number | null): string => (v == null ? "—" : v.toLocaleString("en"));
const fmtPct = (v: number | null): string =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
const fmtPrice = (price: number | null, currency: string | null): string =>
  price == null
    ? "—"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency ?? "USD",
        maximumFractionDigits: 2,
      }).format(price);

// ---------------------------------------------------------------------------
// Metered-call state machine + feedback UI
// ---------------------------------------------------------------------------

type CallState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: ToolOk<unknown> }
  | { kind: "confirm"; dayTotal: number; estimatedCost: number }
  | { kind: "insufficient"; balance: number | null; message: string }
  | { kind: "error"; message: string };

type ServerFnLike = (opts: { data: Record<string, unknown> }) => Promise<ToolResult<unknown>>;

function useMeteredCall(fn: ServerFnLike) {
  const [state, setState] = React.useState<CallState>({ kind: "idle" });
  const pendingRef = React.useRef<(() => void) | null>(null);

  const execute = React.useCallback(
    async (input: Record<string, unknown>, confirmOverage?: boolean) => {
      setState({ kind: "loading" });
      try {
        const result = await fn({
          data: confirmOverage ? { ...input, confirmOverage: true } : input,
        });
        if (result.status === "ok") {
          setState({ kind: "ok", result: result as ToolOk<unknown> });
        } else if (result.status === "confirm") {
          pendingRef.current = () => void execute(input, true);
          setState({
            kind: "confirm",
            dayTotal: result.dayTotal,
            estimatedCost: result.estimatedCost,
          });
        } else {
          setState({ kind: "insufficient", balance: result.balance, message: result.message });
        }
      } catch (err) {
        if (err instanceof Error && err.message === "TRENDTRACK_NOT_CONFIGURED") {
          setState({ kind: "error", message: "TRENDTRACK_API_KEY is not configured." });
        } else {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Request failed",
          });
        }
      }
    },
    [fn],
  );

  const confirm = React.useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    pending?.();
  }, []);
  const cancelConfirm = React.useCallback(() => {
    pendingRef.current = null;
    setState({ kind: "idle" });
  }, []);
  const reset = React.useCallback(() => setState({ kind: "idle" }), []);

  return { state, execute, confirm, cancelConfirm, reset };
}

/** Renders confirm dialog / error / insufficient-credits / post-call cost. */
function CallFeedback({
  state,
  onConfirm,
  onCancel,
}: {
  state: CallState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <AlertDialog open={state.kind === "confirm"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Daily soft limit reached</AlertDialogTitle>
            <AlertDialogDescription>
              You have already used{" "}
              <span className="font-semibold text-foreground">
                {state.kind === "confirm" ? fmtInt(state.dayTotal) : ""} credits
              </span>{" "}
              today (soft limit 2,000). This call may cost up to{" "}
              <span className="font-semibold text-foreground">
                {state.kind === "confirm" ? fmtInt(state.estimatedCost) : ""} more
              </span>
              . Continue anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Yes, spend the credits</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {state.kind === "insufficient" && (
        <Alert variant="destructive">
          <Wallet className="h-4 w-4" />
          <AlertTitle>Insufficient Trendtrack credits</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.balance != null && (
              <>
                {" "}
                Current balance: <span className="font-semibold">{fmtInt(state.balance)}</span>{" "}
                credits. The call was stopped — nothing was retried.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Call failed</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.kind === "ok" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="rounded-full">
            Cost: {fmtInt(state.result.creditsCost)} credits
          </Badge>
          <Badge variant="outline" className="rounded-full">
            {fmtInt(state.result.rowsReturned)} rows
          </Badge>
          {state.result.creditsRemaining != null && (
            <Badge variant="outline" className="rounded-full">
              {fmtInt(state.result.creditsRemaining)} credits left
            </Badge>
          )}
          {state.result.cacheHit && (
            <Badge className="rounded-full bg-primary/15 text-primary hover:bg-primary/15">
              cache hit — free
            </Badge>
          )}
        </div>
      )}
    </>
  );
}

function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export interface SpyMarketToolsProps {
  tab: string;
  shopId?: string | undefined;
  domain?: string | undefined;
  go: (patch: { tab?: string; shopId?: string; domain?: string }) => void;
}

const TOOL_TABS: ReadonlyArray<{ id: string; label: string; badge?: string }> = [
  { id: "lookup", label: "Lookup", badge: "free" },
  { id: "shops", label: "Shop explorer" },
  { id: "shop", label: "Shop detail" },
  { id: "ads", label: "Ad library" },
  { id: "usage", label: "Usage", badge: "free" },
];

export function SpyMarketTools({ tab, shopId, domain, go }: SpyMarketToolsProps) {
  const statusFn = useServerFn(getSpyMarketToolsStatus);
  const { data: status, isLoading } = useQuery({
    queryKey: ["spymarket-tools-status"],
    staleTime: 30_000,
    queryFn: () => statusFn(),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="space-y-6">
        <Header status={status ?? null} />
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary" />
              Setup required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              The Trendtrack integration is not configured yet. Add the secret{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">TRENDTRACK_API_KEY</code>{" "}
              under <span className="font-medium text-foreground">More → Secrets</span> and this
              section activates automatically — no deploy needed.
            </p>
            <p>
              Every call is cached for 24h and logged with its credit cost, so the usage log is
              complete from the very first request.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header status={status} />

      <div className="flex flex-wrap gap-2">
        {TOOL_TABS.map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            onClick={() => go({ tab: t.id })}
          >
            {t.label}
            {t.badge && (
              <Badge
                variant={tab === t.id ? "outline" : "secondary"}
                className="ml-1.5 rounded-full px-1.5 py-0 text-[10px]"
              >
                {t.badge}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {tab === "lookup" && <LookupTab go={go} />}
      {tab === "shops" && <ShopsTab go={go} initialDomain={domain} />}
      {tab === "shop" && <ShopDetailTab shopId={shopId} go={go} />}
      {tab === "ads" && <AdsTab />}
      {tab === "usage" && <UsageTab />}
    </div>
  );
}

function Header({ status }: { status: { creditsRemaining: number | null; dayTotal: number; dailySoftLimit: number } | null }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SpyMarket research</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal Trendtrack workspace — admin only. Metered calls cost 1 credit per returned row
          and are cached for 24h.
        </p>
      </div>
      {status && (
        <div className="flex flex-wrap items-center gap-2">
          {status.creditsRemaining != null && (
            <Badge variant="secondary" className="rounded-full">
              {fmtInt(status.creditsRemaining)} credits remaining
            </Badge>
          )}
          <Badge variant="outline" className="rounded-full">
            You today: {fmtInt(status.dayTotal)} / {fmtInt(status.dailySoftLimit)}
          </Badge>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. LOOKUP — free entry point
// ---------------------------------------------------------------------------

function LookupTab({ go }: { go: SpyMarketToolsProps["go"] }) {
  const lookup = useServerFn(spymarketLookup);
  const call = useMeteredCall(lookup as ServerFnLike);
  const [q, setQ] = React.useState("");

  const results = call.state.kind === "ok" ? dataRows(call.state.result.data) : [];

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim().length >= 2) void call.execute({ q: q.trim() });
              }}
              placeholder="Brand, domain or handle — e.g. gymshark.com"
              className="rounded-full pl-9"
            />
          </div>
          <Button
            className="rounded-full"
            disabled={q.trim().length < 2 || call.state.kind === "loading"}
            onClick={() => void call.execute({ q: q.trim() })}
          >
            {call.state.kind === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Look up — free
          </Button>
        </CardContent>
      </Card>

      <CallFeedback state={call.state} onConfirm={call.confirm} onCancel={call.cancelConfirm} />

      {call.state.kind === "loading" && <LoadingRows />}

      {call.state.kind === "ok" && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches for that query.</p>
      )}

      <div className="grid gap-3">
        {results.map((item, i) => {
          const shop = asRec(item["shop"]);
          const advertiser = asRec(item["advertiser"]);
          const type = asStr(item["type"]) ?? (shop["id"] ? "shop" : "advertiser");
          const name =
            asStr(shop["name"]) ?? asStr(advertiser["name"]) ?? asStr(item["name"]) ?? "Unknown";
          const url =
            asStr(shop["websiteUrl"]) ??
            asStr(advertiser["websiteUrl"]) ??
            asStr(item["websiteUrl"]);
          const shopId = asStr(shop["id"]);
          const activeAds = asNum(shop["activeAds"] ?? advertiser["activeAds"]);
          const visits = asNum(shop["monthlyVisits"]);
          const reach = asNum(advertiser["reach30d"]);
          const domainForExplorer = url?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? null;

          return (
            <Card key={i} className="rounded-2xl">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Badge variant="secondary" className="rounded-full capitalize">
                  {type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name}</p>
                  {url && <p className="truncate text-xs text-muted-foreground">{url}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {activeAds != null && <span>{fmtInt(activeAds)} active ads</span>}
                  {visits != null && <span>{fmtCompact(visits)} visits/mo</span>}
                  {reach != null && <span>{fmtCompact(reach)} reach 30d</span>}
                </div>
                <div className="flex gap-2">
                  {shopId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => go({ tab: "shop", shopId })}
                    >
                      <Store className="mr-1.5 h-3.5 w-3.5" />
                      Shop detail
                    </Button>
                  )}
                  {domainForExplorer && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => go({ tab: "shops", domain: domainForExplorer })}
                    >
                      Find in explorer
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. SHOP EXPLORER
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "da", name: "Danish" },
  { code: "sv", name: "Swedish" },
  { code: "pl", name: "Polish" },
];

function ShopsTab({
  go,
  initialDomain,
}: {
  go: SpyMarketToolsProps["go"];
  initialDomain?: string | undefined;
}) {
  const queryShops = useServerFn(spymarketQueryShops);
  const call = useMeteredCall(queryShops as ServerFnLike);
  const categoriesFn = useServerFn(spymarketCategories);

  const [search, setSearch] = React.useState(initialDomain ?? "");
  const [searchType, setSearchType] = React.useState("domain");
  const [minVisits, setMinVisits] = React.useState("");
  const [maxVisits, setMaxVisits] = React.useState("");
  const [minAds, setMinAds] = React.useState("");
  const [adsWindow, setAdsWindow] = React.useState("last30d");
  const [minProducts, setMinProducts] = React.useState("");
  const [maxProducts, setMaxProducts] = React.useState("");
  const [plusOnly, setPlusOnly] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [language, setLanguage] = React.useState("");
  const [trustpilot, setTrustpilot] = React.useState("");
  const [limit, setLimit] = React.useState(32);
  const [pages, setPages] = React.useState<Rec[][]>([]);

  const { data: categoriesResult } = useQuery({
    queryKey: ["spymarket-categories"],
    staleTime: 60 * 60 * 1000,
    queryFn: () => categoriesFn({ data: {} }),
  });
  const categories =
    categoriesResult?.status === "ok" ? dataRows(categoriesResult.data) : [];

  const buildInput = (offset: number): Record<string, unknown> => ({
    ...(search.trim() ? { search: search.trim(), searchType } : {}),
    ...(minVisits ? { minMonthlyVisits: Number(minVisits) } : {}),
    ...(maxVisits ? { maxMonthlyVisits: Number(maxVisits) } : {}),
    ...(minAds ? { minActiveAds: Number(minAds), adsTimePeriod: adsWindow } : {}),
    ...(minProducts ? { minProductsCount: Number(minProducts) } : {}),
    ...(maxProducts ? { maxProductsCount: Number(maxProducts) } : {}),
    ...(plusOnly ? { isShopifyPlus: true } : {}),
    ...(categoryId ? { categoryId: Number(categoryId) } : {}),
    ...(country ? { country } : {}),
    ...(language ? { language } : {}),
    ...(trustpilot ? { minTrustpilotRating: Number(trustpilot) } : {}),
    limit,
    offset,
  });

  const runSearch = async () => {
    setPages([]);
    await call.execute(buildInput(0));
  };
  const loadMore = async () => {
    await call.execute(buildInput(pages.length * limit));
  };

  // Append successful results into pages.
  const lastResultRef = React.useRef<ToolOk<unknown> | null>(null);
  React.useEffect(() => {
    if (call.state.kind === "ok" && call.state.result !== lastResultRef.current) {
      lastResultRef.current = call.state.result;
      const rows = dataRows(call.state.result.data);
      setPages((prev) => {
        // First page replaces; later pages append.
        const offset = (asRec(call.state.kind === "ok" ? call.state.result.data : {})[""], 0);
        void offset;
        return prev.length === 0 || rows.length === 0 ? [rows] : [...prev, rows];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state]);

  // Reset accumulation when a fresh search starts.
  const searching = call.state.kind === "loading";
  const allRows = pages.flat();
  const lastPageRows = pages.length > 0 ? (pages[pages.length - 1]?.length ?? 0) : 0;
  const hasMore = pages.length > 0 && lastPageRows >= limit;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Search (optional)</Label>
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="domain, product or shop name"
                className="rounded-full"
              />
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger className="w-36 rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="domain">domain</SelectItem>
                  <SelectItem value="productName">product name</SelectItem>
                  <SelectItem value="shopContains">shop contains</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Monthly visits</Label>
            <div className="flex items-center gap-2">
              <Input
                value={minVisits}
                onChange={(e) => setMinVisits(e.target.value.replace(/\D/g, ""))}
                placeholder="min"
                inputMode="numeric"
                className="rounded-full"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                value={maxVisits}
                onChange={(e) => setMaxVisits(e.target.value.replace(/\D/g, ""))}
                placeholder="max"
                inputMode="numeric"
                className="rounded-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Active ads (min)</Label>
            <div className="flex gap-2">
              <Input
                value={minAds}
                onChange={(e) => setMinAds(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
                inputMode="numeric"
                className="rounded-full"
              />
              <Select value={adsWindow} onValueChange={setAdsWindow}>
                <SelectTrigger className="w-28 rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last24h">24h</SelectItem>
                  <SelectItem value="last7d">7d</SelectItem>
                  <SelectItem value="last30d">30d</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Products</Label>
            <div className="flex items-center gap-2">
              <Input
                value={minProducts}
                onChange={(e) => setMinProducts(e.target.value.replace(/\D/g, ""))}
                placeholder="min"
                inputMode="numeric"
                className="rounded-full"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                value={maxProducts}
                onChange={(e) => setMaxProducts(e.target.value.replace(/\D/g, ""))}
                placeholder="max"
                inputMode="numeric"
                className="rounded-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="rounded-full">
                <SelectValue placeholder="Any category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c, i) => (
                  <SelectItem key={i} value={String(asNum(c["id"]) ?? i)}>
                    {asStr(c["label"]) ?? asStr(c["name"]) ?? `#${asNum(c["id"]) ?? i}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="rounded-full">
                <SelectValue placeholder="Any country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="rounded-full">
                <SelectValue placeholder="Any language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Trustpilot rating</Label>
            <Select value={trustpilot} onValueChange={setTrustpilot}>
              <SelectTrigger className="rounded-full">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3.0+</SelectItem>
                <SelectItem value="4">4.0+</SelectItem>
                <SelectItem value="4.5">4.5+</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end justify-between gap-3 pb-1">
            <div className="flex items-center gap-2">
              <Switch id="plus-only" checked={plusOnly} onCheckedChange={setPlusOnly} />
              <Label htmlFor="plus-only" className="cursor-pointer">
                Shopify Plus only
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Page size (max 100)</Label>
            <Input
              value={String(limit)}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ""));
                setLimit(Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 32);
              }}
              inputMode="numeric"
              className="w-28 rounded-full"
            />
          </div>

          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Button className="rounded-full" disabled={searching} onClick={() => void runSearch()}>
              {searching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search — up to {limit} credits
            </Button>
          </div>
        </CardContent>
      </Card>

      <CallFeedback state={call.state} onConfirm={call.confirm} onCancel={call.cancelConfirm} />

      {searching && pages.length === 0 && <LoadingRows rows={6} />}

      {allRows.length > 0 && (
        <Card className="rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="text-right">Visits/mo</TableHead>
                <TableHead className="text-right">Active ads</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">Trustpilot</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {allRows.map((row, i) => {
                const id = asStr(row["id"]);
                const name = asStr(row["name"]) ?? asStr(row["websiteUrl"]) ?? "Unknown shop";
                const url = asStr(row["websiteUrl"]);
                return (
                  <TableRow
                    key={id ?? i}
                    className={cn(id && "cursor-pointer")}
                    onClick={() => id && go({ tab: "shop", shopId: id })}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{name}</p>
                          {url && (
                            <p className="truncate text-xs text-muted-foreground">
                              {url.replace(/^https?:\/\//, "")}
                            </p>
                          )}
                        </div>
                        {row["isShopifyPlus"] === true && (
                          <Badge variant="secondary" className="rounded-full">
                            Plus
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{asStr(row["countryCode"]) ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtCompact(asNum(row["monthlyVisits"]))}</TableCell>
                    <TableCell className="text-right">{fmtInt(asNum(row["activeAds"]))}</TableCell>
                    <TableCell className="text-right">{fmtInt(asNum(row["productsCount"]))}</TableCell>
                    <TableCell className="text-right">
                      {asNum(row["trustpilotRating"])?.toFixed(1) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={searching}
            onClick={() => void loadMore()}
          >
            {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more — up to {limit} credits
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. SHOP DETAIL
// ---------------------------------------------------------------------------

function ShopDetailTab({
  shopId,
  go,
}: {
  shopId?: string | undefined;
  go: SpyMarketToolsProps["go"];
}) {
  const getShop = useServerFn(spymarketGetShop);
  const call = useMeteredCall(getShop as ServerFnLike);

  if (!shopId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Open a shop from <span className="font-medium text-foreground">Lookup</span> or the{" "}
          <span className="font-medium text-foreground">Shop explorer</span> to see its full
          profile here.
        </CardContent>
      </Card>
    );
  }

  const shop = call.state.kind === "ok" ? asRec(asRec(call.state.result.data)["data"]) : null;
  const profile = asRec(shop?.["profile"]);
  const trustpilot = asRec(shop?.["trustpilot"]);
  const traffic = asRec(shop?.["traffic"]);
  const catalog = asRec(shop?.["catalog"]);
  const advertising = asRec(shop?.["advertising"]);
  const adSummary = asRec(advertising["summary"]);
  const technology = asRec(shop?.["technology"]);
  const socials = asArr(shop?.["socials"]).map(asRec);
  const bestSellers = asArr(catalog["bestSellers"]).map(asRec);
  const markets = asArr(traffic["countries"]).map(asRec);

  return (
    <div className="space-y-4">
      {call.state.kind === "idle" && (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              Load the full profile for shop{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{shopId}</code>
            </p>
            <Button className="rounded-full" onClick={() => void call.execute({ shopId })}>
              <Play className="mr-2 h-4 w-4" />
              Load profile — 1 credit
            </Button>
          </CardContent>
        </Card>
      )}

      <CallFeedback state={call.state} onConfirm={call.confirm} onCancel={call.cancelConfirm} />

      {call.state.kind === "loading" && <LoadingRows rows={6} />}

      {shop && (
        <>
          <Card className="rounded-2xl">
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">
                    {asStr(profile["name"]) ?? "Unnamed shop"}
                  </h2>
                  {profile["shopifyPlus"] === true && (
                    <Badge variant="secondary" className="rounded-full">
                      Shopify Plus
                    </Badge>
                  )}
                  {asStr(profile["countryCode"]) && (
                    <Badge variant="outline" className="rounded-full">
                      {asStr(profile["countryCode"])}
                    </Badge>
                  )}
                </div>
                {asStr(profile["websiteUrl"]) && (
                  <a
                    href={asStr(profile["websiteUrl"]) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    {(asStr(profile["websiteUrl"]) ?? "").replace(/^https?:\/\//, "")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {asNum(trustpilot["rating"]) != null && (
                <div className="text-right">
                  <p className="text-lg font-semibold">{asNum(trustpilot["rating"])?.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">
                    Trustpilot · {fmtInt(asNum(trustpilot["reviewCount"]))} reviews
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Traffic</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-semibold">
                  {fmtCompact(asNum(traffic["monthlyVisits"]))}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">visits/mo</span>
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["30d", asNum(traffic["growth30d"])],
                      ["90d", asNum(traffic["growth90d"])],
                      ["180d", asNum(traffic["growth180d"])],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-xl bg-muted/60 p-2">
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          v != null && v > 0 && "text-primary",
                          v != null && v < 0 && "text-destructive",
                        )}
                      >
                        {fmtPct(v)}
                      </p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                {markets.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-muted-foreground">Top markets</p>
                    {markets.slice(0, 5).map((m, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span>{asStr(m["countryCode"]) ?? "—"}</span>
                        <span className="text-muted-foreground">
                          {asNum(m["share"]) != null
                            ? `${Math.round((asNum(m["share"]) ?? 0) * 100)}%`
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Advertising</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-lg font-semibold">{fmtInt(asNum(adSummary["activeAds"]))}</p>
                    <p className="text-xs text-muted-foreground">active ads</p>
                  </div>
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-lg font-semibold">{fmtCompact(asNum(adSummary["reach30d"]))}</p>
                    <p className="text-xs text-muted-foreground">reach 30d (EU/UK)</p>
                  </div>
                </div>
                {socials.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-muted-foreground">Socials</p>
                    {socials.slice(0, 6).map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="capitalize">
                          {asStr(s["platform"]) ?? "—"}
                          {asStr(s["handle"]) && (
                            <span className="ml-1 text-muted-foreground">@{asStr(s["handle"])}</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {fmtCompact(asNum(s["followers"]))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {bestSellers.length > 0 && (
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Best sellers · {fmtInt(asNum(catalog["productsCount"]))} products
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {bestSellers.slice(0, 10).map((p, i) => {
                    const img = asStr(p["imageUrl"]);
                    return (
                      <div key={i} className="overflow-hidden rounded-xl border bg-card">
                        {img ? (
                          <img src={img} alt={asStr(p["title"]) ?? "Product"} className="aspect-square w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex aspect-square items-center justify-center bg-muted">
                            <Package className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="p-2">
                          <p className="truncate text-xs font-medium">{asStr(p["title"]) ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtPrice(asNum(p["price"]), asStr(p["currency"]))}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {(asStr(technology["theme"]) ||
            asArr(technology["apps"]).length > 0 ||
            asArr(technology["pixels"]).length > 0) && (
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Tech stack</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {asStr(technology["theme"]) && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Theme:</span>{" "}
                    <span className="font-medium">{asStr(technology["theme"])}</span>
                  </p>
                )}
                {asArr(technology["apps"]).length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Apps</p>
                    <div className="flex flex-wrap gap-1.5">
                      {asArr(technology["apps"])
                        .map(asRec)
                        .slice(0, 20)
                        .map((a, i) => (
                          <Badge key={i} variant="secondary" className="rounded-full">
                            {asStr(a["label"]) ?? "App"}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
                {asArr(technology["pixels"]).length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Pixels</p>
                    <div className="flex flex-wrap gap-1.5">
                      {asArr(technology["pixels"])
                        .map(asRec)
                        .slice(0, 20)
                        .map((p, i) => (
                          <Badge key={i} variant="outline" className="rounded-full">
                            {asStr(p["name"]) ?? "Pixel"}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <ShopOnDemand shopId={shopId} go={go} />
        </>
      )}
    </div>
  );
}

/** On-demand sections below a shop profile — each loads only when opened. */
function ShopOnDemand({
  shopId,
  go,
}: {
  shopId: string;
  go: SpyMarketToolsProps["go"];
}) {
  const getTab = useServerFn(spymarketGetShopTab);
  const call = useMeteredCall(getTab as ServerFnLike);
  const [activeSection, setActiveSection] = React.useState<string | null>(null);
  const [sectionData, setSectionData] = React.useState<Record<string, ToolOk<unknown>>>({});

  const sections = [
    { id: "products", label: "Products", cost: 20, icon: Package },
    { id: "advertisers", label: "Advertisers", cost: 1, icon: Megaphone },
    { id: "tiktok", label: "TikTok library", cost: 20, icon: Eye },
    { id: "similar", label: "Similar shops", cost: 10, icon: Store },
  ] as const;

  const open = async (sectionId: string, cost: number) => {
    setActiveSection(sectionId);
    if (sectionData[sectionId]) return; // already loaded this session
    await call.execute({ shopId, tab: sectionId, limit: cost });
  };

  React.useEffect(() => {
    if (call.state.kind === "ok" && activeSection && !sectionData[activeSection]) {
      const result = call.state.result;
      setSectionData((prev) => ({ ...prev, [activeSection]: result }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state]);

  const active = sections.find((s) => s.id === activeSection);
  const loaded = activeSection ? sectionData[activeSection] : undefined;
  const rows = loaded ? dataRows(loaded.data) : [];

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">On-demand data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <Button
                key={s.id}
                variant={activeSection === s.id ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                disabled={call.state.kind === "loading"}
                onClick={() => void open(s.id, s.cost)}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" />
                {sectionData[s.id] ? s.label : `${s.label} — up to ${s.cost} credits`}
              </Button>
            );
          })}
        </div>

        {activeSection && !sectionData[activeSection] && (
          <CallFeedback state={call.state} onConfirm={call.confirm} onCancel={call.cancelConfirm} />
        )}
        {activeSection && call.state.kind === "loading" && !loaded && <LoadingRows rows={3} />}

        {loaded && active && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="rounded-full">
                Cost: {fmtInt(loaded.creditsCost)} credits
              </Badge>
              {loaded.cacheHit && (
                <Badge className="rounded-full bg-primary/15 text-primary hover:bg-primary/15">
                  cache hit — free
                </Badge>
              )}
            </div>

            {active.id === "similar" && (
              <div className="grid gap-2 sm:grid-cols-2">
                {rows.map((r, i) => {
                  const id = asStr(r["id"]);
                  return (
                    <button
                      key={id ?? i}
                      disabled={!id}
                      onClick={() => id && go({ tab: "shop", shopId: id })}
                      className="flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {asStr(r["name"]) ?? asStr(r["websiteUrl"]) ?? "Unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtCompact(asNum(r["monthlyVisits"]))} visits/mo
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            )}

            {active.id === "products" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {rows.map((p, i) => {
                  const img = asStr(p["imageUrl"]);
                  return (
                    <div key={i} className="overflow-hidden rounded-xl border bg-card">
                      {img ? (
                        <img src={img} alt={asStr(p["title"]) ?? "Product"} className="aspect-square w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-muted">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="p-2">
                        <p className="truncate text-xs font-medium">{asStr(p["title"]) ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtPrice(asNum(p["price"]), asStr(p["currency"]))}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {active.id === "advertisers" && (
              <div className="grid gap-2">
                {rows.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{asStr(a["name"]) ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtInt(asNum(a["activeAds"]))} active ads
                        {asNum(a["reach30d"]) != null && ` · ${fmtCompact(asNum(a["reach30d"]))} reach 30d`}
                      </p>
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <p className="text-sm text-muted-foreground">No advertisers linked.</p>
                )}
              </div>
            )}

            {active.id === "tiktok" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {rows.map((t, i) => {
                  const thumb = asStr(t["thumbnailUrl"]) ?? asStr(t["coverUrl"]);
                  return (
                    <div key={i} className="overflow-hidden rounded-xl border bg-card">
                      {thumb ? (
                        <img src={thumb} alt="TikTok creative" className="aspect-video w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex aspect-video items-center justify-center bg-muted">
                          <Eye className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="p-2">
                        <p className="text-xs text-muted-foreground">
                          {fmtCompact(asNum(t["views"]) ?? asNum(t["playCount"]))} views
                        </p>
                      </div>
                    </div>
                  );
                })}
                {rows.length === 0 && (
                  <p className="col-span-full text-sm text-muted-foreground">
                    No TikTok creatives found for this shop.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. AD LIBRARY
// ---------------------------------------------------------------------------

function AdsTab() {
  const searchAds = useServerFn(spymarketSearchAds);
  const call = useMeteredCall(searchAds as ServerFnLike);

  const [search, setSearch] = React.useState("");
  const [searchType, setSearchType] = React.useState("adCopy");
  const [status, setStatus] = React.useState("active");
  const [mediaType, setMediaType] = React.useState("");
  const [sortBy, setSortBy] = React.useState("longestRunning");
  const [limit, setLimit] = React.useState(24);
  const [pages, setPages] = React.useState<Rec[][]>([]);

  const buildInput = (page: number): Record<string, unknown> => ({
    ...(search.trim() ? { search: search.trim(), searchType } : {}),
    status,
    ...(mediaType ? { mediaType } : {}),
    sortBy,
    limit,
    page,
  });

  const lastResultRef = React.useRef<ToolOk<unknown> | null>(null);
  React.useEffect(() => {
    if (call.state.kind === "ok" && call.state.result !== lastResultRef.current) {
      lastResultRef.current = call.state.result;
      const rows = dataRows(call.state.result.data);
      setPages((prev) => (prev.length === 0 || rows.length === 0 ? [rows] : [...prev, rows]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state]);

  const searching = call.state.kind === "loading";
  const allRows = pages.flat();

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1.5 lg:col-span-2">
            <Label>Search ad copy or brand</Label>
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="empty = browse all"
                className="rounded-full"
              />
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger className="w-32 rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adCopy">ad copy</SelectItem>
                  <SelectItem value="brand">brand</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Media type</Label>
            <Select value={mediaType} onValueChange={setMediaType}>
              <SelectTrigger className="rounded-full">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="carousel">Carousel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Sort by</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="longestRunning">Longest running</SelectItem>
                <SelectItem value="reach">Reach</SelectItem>
                <SelectItem value="reachDelta7d">Reach Δ 7d</SelectItem>
                <SelectItem value="reachDelta30d">Reach Δ 30d</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="relevance">Relevance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Page size</Label>
            <div className="flex items-center gap-2">
              <Input
                value={String(limit)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ""));
                  setLimit(Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 24);
                }}
                inputMode="numeric"
                className="w-24 rounded-full"
              />
              <Button
                className="rounded-full"
                disabled={searching}
                onClick={() => {
                  setPages([]);
                  void call.execute(buildInput(1));
                }}
              >
                {searching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search — up to {limit} credits
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Reach/spend data covers EU &amp; UK ads only. Facebook platform only in public v1.
      </p>

      <CallFeedback state={call.state} onConfirm={call.confirm} onCancel={call.cancelConfirm} />

      {searching && pages.length === 0 && <LoadingRows rows={6} />}

      {allRows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {allRows.map((ad, i) => {
            const media = asRec(ad["media"]);
            const thumb = asStr(media["thumbnailUrl"]) ?? asStr(media["url"]) ?? asStr(ad["thumbnailUrl"]);
            const title = asStr(ad["title"]) ?? asStr(ad["advertiserName"]) ?? asStr(ad["pageName"]);
            const body = asStr(ad["body"]) ?? asStr(ad["adCopy"]);
            const start = asStr(ad["startDate"]) ?? asStr(ad["createdAt"]);
            const days = start
              ? Math.max(0, Math.round((Date.now() - new Date(start).getTime()) / 86_400_000))
              : null;
            const reach = asNum(ad["reach"]);
            const delta7 = asNum(ad["reachDelta7d"]);
            return (
              <Card key={asStr(ad["id"]) ?? i} className="overflow-hidden rounded-2xl">
                {thumb ? (
                  <img src={thumb} alt={title ?? "Ad creative"} className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-muted">
                    <Megaphone className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <CardContent className="space-y-1.5 p-3">
                  {title && <p className="truncate text-sm font-medium">{title}</p>}
                  {body && <p className="line-clamp-2 text-xs text-muted-foreground">{body}</p>}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {days != null && (
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {days}d running
                      </Badge>
                    )}
                    {reach != null && (
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {fmtCompact(reach)} reach
                      </Badge>
                    )}
                    {delta7 != null && (
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        Δ7d {fmtCompact(delta7)}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pages.length > 0 && (pages[pages.length - 1]?.length ?? 0) >= limit && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={searching}
            onClick={() => void call.execute(buildInput(pages.length + 1))}
          >
            {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more — up to {limit} credits
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. USAGE — free dashboard over our own log
// ---------------------------------------------------------------------------

function UsageTab() {
  const usageFn = useServerFn(spymarketGetUsageDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["spymarket-usage-dashboard"],
    staleTime: 60_000,
    queryFn: () => usageFn(),
  });

  if (isLoading) return <LoadingRows rows={6} />;
  if (!data) return null;

  const balance = data.liveBalance ?? data.creditsRemaining;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={FlaskConical} label="Credits today" value={fmtInt(data.today)} />
        <StatCard icon={FlaskConical} label="This week" value={fmtInt(data.week)} />
        <StatCard icon={FlaskConical} label="This month" value={fmtInt(data.month)} />
        <StatCard
          icon={Database}
          label="Cache hit rate"
          value={`${Math.round(data.cacheHitRate * 100)}%`}
        />
        <StatCard
          icon={Wallet}
          label={data.liveBalance != null ? "Live balance" : "Last known balance"}
          value={balance != null ? fmtInt(balance) : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              By team member (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.byMember.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calls yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byMember.map((m) => (
                    <TableRow key={m.name}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-right">{m.calls}</TableCell>
                      <TableCell className="text-right">{fmtInt(m.credits)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">By endpoint (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byEndpoint.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calls yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byEndpoint.map((e) => (
                    <TableRow key={e.endpoint}>
                      <TableCell className="font-mono text-xs">{e.endpoint}</TableCell>
                      <TableCell className="text-right">{e.calls}</TableCell>
                      <TableCell className="text-right">{fmtInt(e.credits)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing logged yet. This table is the negotiation record for the Enterprise
              conversation — every metered call lands here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-sm">{r.called_by_name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.endpoint}</TableCell>
                    <TableCell className="text-right">{r.rows_returned}</TableCell>
                    <TableCell className="text-right">{r.credits_cost}</TableCell>
                    <TableCell className="text-right">
                      {r.credits_remaining != null ? fmtInt(r.credits_remaining) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.cache_hit && (
                        <Badge className="rounded-full bg-primary/15 text-primary hover:bg-primary/15">
                          cache
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-lg font-semibold leading-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}


