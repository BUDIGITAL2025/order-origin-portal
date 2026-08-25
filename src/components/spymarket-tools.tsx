/**
 * SpyMarket research tool — ADMIN-ONLY internal UI over the Trendtrack API.
 * Every metered action shows its worst-case credit cost before executing and
 * its real cost after; beyond the per-user daily soft limit an extra
 * confirmation is required. All data flows through spymarket-tools.functions
 * (server-side gateway with 24h cache + usage log) — never from the browser.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  Eye,
  FlaskConical,
  Globe,
  LineChart,
  Loader2,
  Mail,
  Megaphone,
  Package,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Star,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import {
  getSpyMarketToolsStatus,
  spymarketCategories,
  spymarketGetAd,
  spymarketGetAdMediaUrl,
  spymarketGetAdReachHistory,
  spymarketGetEmail,
  spymarketGetShop,
  spymarketGetShopTab,
  spymarketGetUsageDashboard,
  spymarketLookup,
  spymarketQueryEmails,
  spymarketQueryShops,
  spymarketSearchAds,
} from "@/lib/spymarket-tools.functions";
import type { ToolOk, ToolResult } from "@/lib/spymarket-tools.server";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  CountryDualContent,
  DualRangeContent,
  FilterChip,
  ListContent,
} from "@/components/spymarket/filters";
import {
  AreaChart,
  Flag,
  FlagStack,
  LazySparkline,
  Sparkline,
  filterRange,
  toTrendPoints,
  type TrendPoint,
} from "@/components/spymarket/viz";
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
// Learned per-endpoint pricing (spymarket_endpoint_costs via the server)
// ---------------------------------------------------------------------------

type EndpointCosts = Array<{ endpoint: string; creditsPerRow: number; sampleCount: number }>;

/**
 * Button label for a metered action. Never assumes 1 credit/row: uses the
 * learned per-row rate, and refuses to guess when an endpoint was never
 * measured (sampleCount 0 = provisional seed).
 */
function costLabel(costs: EndpointCosts | undefined, endpoint: string, rows: number): string {
  const c = costs?.find((x) => x.endpoint === endpoint);
  if (!c || c.sampleCount === 0) return "cost unknown — measured on 1st call";
  return `up to ~${fmtInt(Math.ceil(rows * c.creditsPerRow))} credits (est.)`;
}

/** Collapsible "View raw data" panel with the full API payload. */
function RawJson({ data }: { data: unknown }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          View raw data
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 text-[11px] leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Collapsible detail section card. */
function Section({
  title,
  icon,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Card className="rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </span>
        <span className="flex items-center gap-2">
          {right}
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>
      {open && <CardContent className="space-y-3 pt-0">{children}</CardContent>}
    </Card>
  );
}

/** Country share chips: [{countryCode, share}] → "PT · 42%". */
function CountryChips({ list, max = 8 }: { list: unknown; max?: number }) {
  const rows = asArr(list).map(asRec);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.slice(0, max).map((c, i) => {
        const share = asNum(c["share"]);
        return (
          <Badge key={i} variant="secondary" className="rounded-full text-[11px]">
            {asStr(c["countryCode"]) ?? asStr(c["country"]) ?? "?"}
            {share != null && ` · ${Math.round(share * 100)}%`}
          </Badge>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metered-call state machine + feedback UI
// ---------------------------------------------------------------------------

type CallState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: ToolOk<unknown> }
  | { kind: "confirm"; dayTotal: number; estimatedCost: number }
  | { kind: "insufficient"; balance: number | null; message: string }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

type ServerFnLike = (opts: { data: Record<string, unknown> }) => Promise<ToolResult<unknown>>;

function useMeteredCall(fn: ServerFnLike) {
  const [state, setState] = React.useState<CallState>({ kind: "idle" });
  const pendingRef = React.useRef<(() => void) | null>(null);
  const lastInputRef = React.useRef<Record<string, unknown> | null>(null);
  const queryClient = useQueryClient();

  const execute = React.useCallback(
    async (input: Record<string, unknown>, confirmOverage?: boolean) => {
      lastInputRef.current = input;
      setState({ kind: "loading" });
      try {
        const result = await fn({
          data: confirmOverage ? { ...input, confirmOverage: true } : input,
        });
        // Every settled call changes the day total / balance / learned prices —
        // refresh the header badge and usage dashboard immediately.
        if (result.status !== "confirm") {
          void queryClient.invalidateQueries({ queryKey: ["spymarket-tools-status"] });
          void queryClient.invalidateQueries({ queryKey: ["spymarket-usage-dashboard"] });
        }
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
        } else if (err instanceof Error && err.message === "TRENDTRACK_TIMEOUT") {
          // Slow upstream — the friendly message + retry button live in
          // CallFeedback; the last input is kept in lastInputRef.
          setState({ kind: "timeout" });
        } else {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Request failed",
          });
        }
      }
    },
    [fn, queryClient],
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
  /** Re-fire the exact same query (e.g. after a timeout). */
  const retry = React.useCallback(() => {
    const input = lastInputRef.current;
    if (input) void execute(input);
  }, [execute]);

  return { state, execute, confirm, cancelConfirm, reset, retry };
}

/** Renders confirm dialog / error / insufficient-credits / post-call cost. */
function CallFeedback({
  state,
  onConfirm,
  onCancel,
  onRetry,
  timeoutTitle,
  timeoutMessage,
  timeoutExtra,
}: {
  state: CallState;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry?: (() => void) | undefined;
  timeoutTitle?: string | undefined;
  timeoutMessage?: React.ReactNode;
  timeoutExtra?: React.ReactNode;
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
      {state.kind === "timeout" && (
        <Alert>
          <RefreshCw className="h-4 w-4" />
          <AlertTitle>{timeoutTitle ?? "Trendtrack is responding slowly"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {timeoutMessage ??
                "Trendtrack is responding slowly — try again in a moment. No credits were charged."}
            </span>
            {onRetry && (
              <Button size="sm" variant="outline" className="rounded-full" onClick={onRetry}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            {timeoutExtra}
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
        <div className="space-y-1">
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
          {!state.result.cacheHit &&
            state.result.creditsCost > 0 &&
            state.result.rowsReturned > 0 && (
              <p className="text-xs font-medium text-foreground">
                This call cost {fmtInt(state.result.creditsCost)} credits —{" "}
                {(state.result.creditsCost / state.result.rowsReturned)
                  .toFixed(2)
                  .replace(/\.?0+$/, "")}{" "}
                per row.
              </p>
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
  /** Full validated search params — filters/sort hydrate from the URL. */
  search: Record<string, string | undefined>;
  /** Merge a patch into the URL query string (shareable filtered views). */
  go: (patch: Record<string, string | undefined>) => void;
}

const TOOL_TABS: ReadonlyArray<{ id: string; label: string; badge?: string }> = [
  { id: "lookup", label: "Lookup", badge: "free" },
  { id: "shops", label: "Shop explorer" },
  { id: "shop", label: "Shop detail" },
  { id: "ads", label: "Ad library" },
  { id: "emails", label: "Emails" },
  { id: "usage", label: "Usage", badge: "free" },
];

export function SpyMarketTools({ tab, shopId, domain, search, go }: SpyMarketToolsProps) {
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

      {tab === "lookup" && <LookupTab go={go} costs={status.endpointCosts} />}
      {tab === "shops" && (
        <ShopsTab go={go} initialDomain={domain} costs={status.endpointCosts} url={search} />
      )}
      {tab === "shop" && <ShopDetailTab shopId={shopId} go={go} costs={status.endpointCosts} />}
      {tab === "ads" && <AdsTab costs={status.endpointCosts} url={search} go={go} />}
      {tab === "emails" && <EmailsTab costs={status.endpointCosts} />}
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
          Internal Trendtrack workspace — admin only. Calls are cached 24h and per-endpoint prices
          are learned from real usage, never assumed.
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

function LookupTab({
  go,
  costs,
}: {
  go: SpyMarketToolsProps["go"];
  costs: EndpointCosts | undefined;
}) {
  const lookup = useServerFn(spymarketLookup);
  const call = useMeteredCall(lookup as ServerFnLike);
  const [q, setQ] = React.useState("");
  // Term of the last submitted lookup — drives the honest timeout message and
  // the opt-in Shop Explorer fallback (never fired automatically: it is paid).
  const [lastTerm, setLastTerm] = React.useState("");
  const run = React.useCallback(
    (term: string) => {
      setLastTerm(term);
      void call.execute({ q: term });
    },
    [call],
  );

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
                if (e.key === "Enter" && q.trim().length >= 2) run(q.trim());
              }}
              placeholder="Brand, domain or handle — e.g. gymshark.com"
              className="rounded-full pl-9"
            />
          </div>
          <Button
            className="rounded-full"
            disabled={q.trim().length < 2 || call.state.kind === "loading"}
            onClick={() => run(q.trim())}
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

      <p className="text-xs text-muted-foreground">
        Lookup resolves <span className="font-medium text-foreground">exact brand domains</span>{" "}
        instantly — e.g. <span className="font-medium text-foreground">gymshark.com</span> or{" "}
        <span className="font-medium text-foreground">nike.com</span>. For partial or fuzzy brand
        names, use <span className="font-medium text-foreground">Shop Explorer</span> with the shop
        name filter (that search is metered).
      </p>

      <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
        timeoutTitle="Lookup didn't resolve"
        timeoutMessage={`Trendtrack's lookup couldn't resolve "${lastTerm}" — this happens with brand names that need fuzzy matching. Their exact-domain lookup is fast; fuzzy is unreliable on their side. No credits were charged.`}
        timeoutExtra={
          lastTerm ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => go({ tab: "shops", sq: lastTerm, st: "shopContains" })}
            >
              <Store className="mr-1.5 h-3.5 w-3.5" />
              {`Search "${lastTerm}" in Shop Explorer instead — ${costLabel(costs, "shops/query", 32)}`}
            </Button>
          ) : null
        }
      />

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

const SHOP_SORTS = [
  { value: "relevance", label: "Best match" },
  { value: "monthlyVisits", label: "Most traffic" },
  { value: "activeAds", label: "Most ads" },
  { value: "growth30d", label: "Fastest growing" },
  { value: "productsCount", label: "Biggest catalogue" },
  { value: "createdAt", label: "Newest" },
];

const VISITS_RANGE_MAX = 50_000_000;
const ADS_RANGE_MAX = 500;
const PRODUCTS_RANGE_MAX = 10_000;

// ---------------------------------------------------------------------------
// Growth rule builder
//
// Maps onto POST /v1/shops/query `trafficGrowth[]` / `adsGrowth[]`:
//   { period, comparison: greater|lower, value: percentage }
// Rising X% → comparison "greater", value +X. Falling X% → "lower", value −X.
// Traffic windows: last30d | last90d | last180d.
// Ads windows:     last7d  | last30d | last90d.
// ---------------------------------------------------------------------------

type GrowthMetric = "traffic" | "ads";
type GrowthDirection = "rising" | "falling";

interface GrowthRule {
  metric: GrowthMetric;
  direction: GrowthDirection;
  /** Absolute percentage threshold, e.g. 30 → "at least 30%". */
  percent: number;
  /** Upstream period token, already valid for the chosen metric. */
  period: string;
}

const TRAFFIC_WINDOWS = [
  { value: "last30d", label: "1m" },
  { value: "last90d", label: "3m" },
  { value: "last180d", label: "6m" },
];
const ADS_WINDOWS = [
  { value: "last7d", label: "7d" },
  { value: "last30d", label: "1m" },
  { value: "last90d", label: "3m" },
];

const windowsFor = (m: GrowthMetric) => (m === "traffic" ? TRAFFIC_WINDOWS : ADS_WINDOWS);
const windowLabel = (r: GrowthRule) =>
  windowsFor(r.metric).find((w) => w.value === r.period)?.label ?? r.period;

const defaultRule = (metric: GrowthMetric): GrowthRule => ({
  metric,
  direction: "rising",
  percent: 30,
  period: metric === "traffic" ? "last30d" : "last30d",
});

/** "t:rising:30:last30d,a:rising:20:last7d" */
function encodeRules(rules: GrowthRule[]): string | undefined {
  if (rules.length === 0) return undefined;
  return rules
    .map((r) => `${r.metric === "traffic" ? "t" : "a"}:${r.direction}:${r.percent}:${r.period}`)
    .join(",");
}

function decodeRules(raw: string | undefined): GrowthRule[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((chunk): GrowthRule | null => {
      const [m, d, p, w] = chunk.split(":");
      if (!m || !d || !p || !w) return null;
      const metric: GrowthMetric = m === "a" ? "ads" : "traffic";
      const percent = Number(p);
      if (!Number.isFinite(percent)) return null;
      if (!windowsFor(metric).some((x) => x.value === w)) return null;
      return {
        metric,
        direction: d === "falling" ? "falling" : "rising",
        percent: Math.abs(percent),
        period: w,
      };
    })
    .filter((r): r is GrowthRule => r !== null)
    .slice(0, 4);
}

const ruleLabel = (r: GrowthRule) =>
  `${r.metric === "traffic" ? "Traffic" : "Ads"} ${r.direction === "rising" ? "↑" : "↓"}${r.percent}% ${windowLabel(r)}`;

/** Split rules into the two upstream condition arrays. */
function rulesToConditions(rules: GrowthRule[]) {
  const toCond = (r: GrowthRule) => ({
    period: r.period,
    comparison: r.direction === "rising" ? "greater" : "lower",
    value: r.direction === "rising" ? r.percent : -r.percent,
  });
  return {
    trafficGrowth: rules.filter((r) => r.metric === "traffic").map(toCond),
    adsGrowth: rules.filter((r) => r.metric === "ads").map(toCond),
  };
}

interface ShopsFilters {
  search: string;
  searchType: string;
  minVisits: string;
  maxVisits: string;
  minAds: string;
  maxAds: string;
  adsWindow: string;
  minProducts: string;
  maxProducts: string;
  plusOnly: boolean;
  dtcOnly: boolean;
  categoryId: string;
  countriesInc: string[];
  countriesExc: string[];
  language: string;
  trustpilot: string;
  sortBy: string;
  rules: GrowthRule[];
  trending: boolean;
  createdAfter: string;
  preset: string;
}

function shopsFiltersFromUrl(
  url: Record<string, string | undefined>,
  initialDomain?: string | undefined,
): ShopsFilters {
  return {
    search: url["sq"] ?? initialDomain ?? "",
    searchType: url["st"] ?? "shopContains",
    minVisits: url["vmin"] ?? "",
    maxVisits: url["vmax"] ?? "",
    minAds: url["amin"] ?? "",
    maxAds: url["amax"] ?? "",
    adsWindow: url["awin"] ?? "last30d",
    minProducts: url["pmin"] ?? "",
    maxProducts: url["pmax"] ?? "",
    plusOnly: url["plus"] === "1",
    // DTC-only defaults ON; only an explicit dtc=0 in the URL disables it.
    dtcOnly: url["dtc"] !== "0",
    categoryId: url["cat"] ?? "",
    countriesInc: url["cinc"]?.split(",").filter(Boolean) ?? [],
    countriesExc: url["cexc"]?.split(",").filter(Boolean) ?? [],
    language: url["lang"] ?? "",
    trustpilot: url["tp"] ?? "",
    sortBy: url["ssort"] ?? "monthlyVisits",
    rules: decodeRules(url["gr"]),
    trending: url["trend"] === "1",
    createdAfter: url["cafter"] ?? "",
    preset: url["pset"] ?? "",
  };
}

/** Serialize filters into short query keys; undefined keys drop out of the URL. */
function shopsUrlPatch(f: ShopsFilters): Record<string, string | undefined> {
  return {
    tab: "shops",
    domain: undefined,
    sq: f.search.trim() || undefined,
    st: f.searchType !== "shopContains" ? f.searchType : undefined,
    vmin: f.minVisits || undefined,
    vmax: f.maxVisits || undefined,
    amin: f.minAds || undefined,
    amax: f.maxAds || undefined,
    awin: (f.minAds || f.maxAds) && f.adsWindow !== "last30d" ? f.adsWindow : undefined,
    pmin: f.minProducts || undefined,
    pmax: f.maxProducts || undefined,
    plus: f.plusOnly ? "1" : undefined,
    dtc: f.dtcOnly ? undefined : "0",
    cat: f.categoryId || undefined,
    cinc: f.countriesInc.length > 0 ? f.countriesInc.join(",") : undefined,
    cexc: f.countriesExc.length > 0 ? f.countriesExc.join(",") : undefined,
    lang: f.language || undefined,
    tp: f.trustpilot || undefined,
    ssort: f.sortBy !== "monthlyVisits" ? f.sortBy : undefined,
    gr: encodeRules(f.rules),
    trend: f.trending ? "1" : undefined,
    cafter: f.createdAfter || undefined,
    pset: f.preset || undefined,
  };
}

// ---------------------------------------------------------------------------
// Preset views
//
// The public v1 API has no `preset` parameter (see docs/trendtrack-api-
// reference.md → "Shop presets"), so each preset is a server-side filter+sort
// recipe built from documented params only. Ad/Traffic peak have no upstream
// peak field — they are approximated with growth + volume floors.
// ---------------------------------------------------------------------------

const daysAgoISO = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

interface ShopPreset {
  id: string;
  label: string;
  hint: string;
  patch: () => Partial<ShopsFilters>;
}

const SHOP_PRESETS: ShopPreset[] = [
  {
    id: "weekly-gems",
    label: "Weekly Gems",
    hint: "displayInTrending=true + createdAfter (last 180d) + ≥10k visits, sorted by growth30d.",
    patch: () => ({
      trending: true,
      createdAfter: daysAgoISO(180),
      minVisits: "10000",
      maxVisits: "",
      rules: [],
      sortBy: "growth30d",
    }),
  },
  {
    id: "top-scaling",
    label: "Top Scaling",
    hint: "trafficGrowth ≥ +50% over last30d, sorted by growth30d.",
    patch: () => ({
      trending: false,
      createdAfter: "",
      rules: [{ metric: "traffic", direction: "rising", percent: 50, period: "last30d" }],
      sortBy: "growth30d",
    }),
  },
  {
    id: "market-leaders",
    label: "Market Leaders & DTC",
    hint: "dtcRegion=all + ≥500k monthly visits, sorted by monthlyVisits.",
    patch: () => ({
      trending: false,
      createdAfter: "",
      rules: [],
      dtcOnly: true,
      minVisits: "500000",
      sortBy: "monthlyVisits",
    }),
  },
  {
    id: "ad-peak",
    label: "Ad Peak",
    hint: "No peak field upstream — approximated with adsGrowth ≥ +30% over last7d and ≥50 active ads, sorted by activeAds.",
    patch: () => ({
      trending: false,
      createdAfter: "",
      rules: [{ metric: "ads", direction: "rising", percent: 30, period: "last7d" }],
      minAds: "50",
      maxAds: "",
      adsWindow: "last7d",
      sortBy: "activeAds",
    }),
  },
  {
    id: "traffic-peak",
    label: "Traffic Peak",
    hint: "No peak field upstream — approximated with trafficGrowth ≥ +100% over last90d and ≥100k visits, sorted by growth30d.",
    patch: () => ({
      trending: false,
      createdAfter: "",
      rules: [{ metric: "traffic", direction: "rising", percent: 100, period: "last90d" }],
      minVisits: "100000",
      maxVisits: "",
      sortBy: "growth30d",
    }),
  },
];

/** "2024-03-12" → "1y 9m old". */
function shopAge(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const then = new Date(createdAt).getTime();
  if (!Number.isFinite(then)) return null;
  const months = Math.max(0, Math.round((Date.now() - then) / (30.44 * 86_400_000)));
  if (months < 1) return "<1mo old";
  if (months < 12) return `${months}mo old`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m === 0 ? `${y}y old` : `${y}y ${m}m old`;
}

/**
 * Free typeahead for the Shop Explorer.
 *
 * Cost contract: it calls ONLY `spymarketLookup` → `/v1/lookup`, declared
 * `metered: false, estimatedCost: 0` server-side, so it can never charge
 * credits and can never hit the soft-limit confirm path. The paid
 * `/shops/query` is reached only through the explicit action at the bottom
 * of the dropdown. Lookup hangs on fuzzy terms — we fail silent there.
 */
type Suggestion = {
  key: string;
  group: "Domain" | "Shop keywords";
  type: string;
  name: string;
  url: string | null;
  shopId: string | null;
  visits: number | null;
  activeAds: number | null;
};

function SearchTypeahead({
  term,
  open,
  onClose,
  onPick,
  onSearchAll,
  costs,
  limit,
}: {
  term: string;
  open: boolean;
  onClose: () => void;
  onPick: (s: Suggestion) => void;
  onSearchAll: () => void;
  costs: EndpointCosts | undefined;
  limit: number;
}) {
  const lookup = useServerFn(spymarketLookup);
  const [debounced, setDebounced] = React.useState("");
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const trimmed = term.trim();

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), 400);
    return () => clearTimeout(t);
  }, [trimmed]);

  const reqRef = React.useRef(0);
  React.useEffect(() => {
    if (debounced.length < 3) {
      setItems([]);
      setLoading(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    void (async () => {
      try {
        const res = (await lookup({ data: { q: debounced } })) as ToolOk<unknown>;
        if (id !== reqRef.current) return;
        const rows = res.status === "ok" ? dataRows(res.data) : [];
        setItems(
          rows.map((item, i) => {
            const shop = asRec(item["shop"]);
            const advertiser = asRec(item["advertiser"]);
            const url =
              asStr(shop["websiteUrl"]) ??
              asStr(advertiser["websiteUrl"]) ??
              asStr(item["websiteUrl"]) ??
              null;
            const host = url?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? null;
            const name =
              asStr(shop["name"]) ?? asStr(advertiser["name"]) ?? asStr(item["name"]) ?? host ?? "—";
            return {
              key: `${i}-${host ?? name}`,
              group: host?.toLowerCase().includes(debounced.toLowerCase())
                ? ("Domain" as const)
                : ("Shop keywords" as const),
              type: asStr(item["type"]) ?? (shop["id"] ? "shop" : "advertiser"),
              name,
              url: host,
              shopId: asStr(shop["id"]) ?? null,
              visits: asNum(shop["monthlyVisits"]),
              activeAds: asNum(shop["activeAds"] ?? advertiser["activeAds"]),
            };
          }),
        );
      } catch {
        // Lookup timed out or errored — fail silent, never block typing and
        // never fall back to the paid endpoint.
        if (id === reqRef.current) setItems([]);
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    })();
  }, [debounced, lookup]);

  if (!open || trimmed.length < 3) return null;

  const groups: Suggestion["group"][] = ["Domain", "Shop keywords"];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg">
        <div className="max-h-80 overflow-y-auto py-1">
          {loading && items.length === 0 && (
            <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Resolving suggestions — free
            </p>
          )}
          {!loading && items.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No free suggestions for “{trimmed}”.
            </p>
          )}
          {groups.map((g) => {
            const rows = items.filter((s) => s.group === g);
            if (rows.length === 0) return null;
            return (
              <div key={g}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g}
                </p>
                {rows.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onPick(s)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent"
                  >
                    <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      {s.url && (
                        <span className="block truncate text-xs text-muted-foreground">{s.url}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {s.visits != null ? `${fmtCompact(s.visits)} visits/mo` : s.type}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="border-t p-2">
          <Button
            size="sm"
            variant="secondary"
            className="w-full rounded-full"
            onClick={onSearchAll}
          >
            <Search className="mr-1.5 h-3.5 w-3.5" />
            {`Search all “${trimmed}” in Shop Explorer — ${costLabel(costs, "shops/query", limit)}`}
          </Button>
        </div>
      </div>
    </>
  );
}

function ShopsTab({
  go,
  initialDomain,
  costs,
  url,
}: {
  go: SpyMarketToolsProps["go"];
  initialDomain?: string | undefined;
  costs?: EndpointCosts | undefined;
  url: Record<string, string | undefined>;
}) {
  const queryShops = useServerFn(spymarketQueryShops);
  const call = useMeteredCall(queryShops as ServerFnLike);
  const categoriesFn = useServerFn(spymarketCategories);

  // Applied filter state — hydrated from the URL so shared links restore the view.
  const [f, setF] = React.useState<ShopsFilters>(() => shopsFiltersFromUrl(url, initialDomain));
  const [limit, setLimit] = React.useState(32);
  const [typeaheadOpen, setTypeaheadOpen] = React.useState(false);
  // A text search ranked by traffic surfaces the giants instead of the match,
  // so we auto-switch to "Best match" until the user picks a sort themselves.
  const [sortTouched, setSortTouched] = React.useState(url["ssort"] != null);
  const effectiveSort = f.search.trim() !== "" && !sortTouched ? "relevance" : f.sortBy;
  const [pages, setPages] = React.useState<Rec[][]>([]);

  const { data: categories } = useQuery({
    queryKey: ["spymarket-categories"],
    queryFn: async () => {
      const res = (await categoriesFn()) as ToolOk<unknown>;
      return asArr(res.data).map(asRec);
    },
    staleTime: 24 * 60 * 60 * 1000,
  });

  /**
   * Commit a patch to state AND the URL (shareable filtered views).
   * Any manual filter edit drops the active preset badge, unless the patch
   * sets one itself.
   */
  const apply = (patch: Partial<ShopsFilters>) => {
    setF((prev) => {
      const next = { ...prev, preset: "", ...patch };
      go(shopsUrlPatch(next));
      return next;
    });
  };

  /** One-click preset: apply the recipe, then run the (paid) search. */
  const applyPreset = (preset: ShopPreset) => {
    const next: ShopsFilters = { ...f, ...preset.patch(), preset: preset.id };
    setF(next);
    setSortTouched(true);
    go(shopsUrlPatch(next));
    setPages([]);
    void call.execute(buildInput(0, next));
  };

  /** DTC toggle: commit to state + URL, re-run live when results are shown. */
  const toggleDtcOnly = () => {
    const next = { ...f, dtcOnly: !f.dtcOnly };
    setF(next);
    go(shopsUrlPatch(next));
    if (pages.length > 0) {
      setPages([]);
      void call.execute(buildInput(0, next));
    }
  };

  const buildInput = (offset: number, filters: ShopsFilters = f): Record<string, unknown> => {
    const input: Record<string, unknown> = {
      limit,
      offset,
      sortBy: filters.search.trim() !== "" && !sortTouched ? "relevance" : filters.sortBy,
      order: "desc",
    };
    // Applied upstream via the API's DTC preset — filtered-out rows never
    // count toward credits. Explicit domain searches bypass it server-side.
    input["dtcOnly"] = filters.dtcOnly;
    if (filters.search.trim()) {
      input["search"] = filters.search.trim();
      input["searchType"] = filters.searchType;
    }
    if (filters.minVisits) input["minMonthlyVisits"] = Number(filters.minVisits);
    if (filters.maxVisits) input["maxMonthlyVisits"] = Number(filters.maxVisits);
    if (filters.minAds) input["minActiveAds"] = Number(filters.minAds);
    if (filters.maxAds) input["maxActiveAds"] = Number(filters.maxAds);
    if (filters.minAds || filters.maxAds) input["adsTimePeriod"] = filters.adsWindow;
    if (filters.minProducts) input["minProductsCount"] = Number(filters.minProducts);
    if (filters.maxProducts) input["maxProductsCount"] = Number(filters.maxProducts);
    if (filters.plusOnly) input["isShopifyPlus"] = true;
    if (filters.categoryId) input["categoryId"] = Number(filters.categoryId);
    if (filters.countriesInc.length > 0) input["countries"] = filters.countriesInc;
    if (filters.language) input["language"] = filters.language;
    if (filters.trustpilot) input["minTrustpilotRating"] = Number(filters.trustpilot);
    const growth = rulesToConditions(filters.rules);
    if (growth.trafficGrowth.length > 0) input["trafficGrowth"] = growth.trafficGrowth;
    if (growth.adsGrowth.length > 0) input["adsGrowth"] = growth.adsGrowth;
    if (filters.trending) input["displayInTrending"] = true;
    if (filters.createdAfter) input["createdAfter"] = filters.createdAfter;
    return input;
  };

  const runSearch = async () => {
    setPages([]);
    go(shopsUrlPatch(f));
    await call.execute(buildInput(0));
  };

  const loadMore = async () => {
    await call.execute(buildInput(pages.length * limit));
  };

  // Accumulate pages; a fresh search replaces, load-more appends.
  const lastResultRef = React.useRef<ToolOk<unknown> | null>(null);
  React.useEffect(() => {
    if (call.state.kind === "ok" && call.state.result !== lastResultRef.current) {
      lastResultRef.current = call.state.result;
      const rows = dataRows(call.state.result.data);
      setPages((prev) => (prev.length === 0 || rows.length === 0 ? [rows] : [...prev, rows]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state]);

  // Deep link: /admin/spymarket-tools?tab=shops&sq=… (or any filter param) auto-runs.
  const autoRanRef = React.useRef(false);
  React.useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    const hadParams = Boolean(
      initialDomain ||
        url["sq"] || url["vmin"] || url["vmax"] || url["amin"] || url["amax"] ||
        url["pmin"] || url["pmax"] || url["plus"] || url["cat"] || url["cinc"] ||
        url["lang"] || url["tp"] || url["ssort"] || url["gr"] || url["trend"] ||
        url["cafter"] || url["pset"],
    );
    if (hadParams) void call.execute(buildInput(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searching = call.state.kind === "loading";
  // Country exclusion is applied client-side (the upstream API ignores it).
  const excSet = new Set(f.countriesExc);
  const filteredRows = pages.flat().filter((r) => {
    if (excSet.size === 0) return true;
    const cc = asStr(asRec(r["profile"])["countryCode"]);
    return cc == null || !excSet.has(cc);
  });
  // Upstream matches multi-word terms loosely (token OR), so rows that really
  // contain a term token float to the top. Presentation only — no extra calls.
  const terms = f.search.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const matchScore = (r: Rec) => {
    if (terms.length === 0) return 0;
    const hay = `${asStr(r["name"]) ?? ""} ${asStr(r["domain"]) ?? ""}`.toLowerCase();
    return -terms.filter((t) => hay.includes(t)).length;
  };
  const allRows =
    terms.length > 0
      ? [...filteredRows].sort((a, b) => matchScore(a) - matchScore(b))
      : filteredRows;
  const multiWord = f.search.trim().split(/\s+/).length > 1;
  const lastPage = pages[pages.length - 1];
  const hasMore = lastPage != null && lastPage.length >= limit;

  // Mirrors the server rule: the upstream DTC preset is skipped only for an
  // exact-domain lookup, so the banner never claims a filter that wasn't sent.
  const dtcApplied = !(
    f.searchType === "domain" &&
    f.search.trim() !== "" &&
    /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(f.search.trim())
  );


  const visitsRange: [number, number] = [
    Number(f.minVisits) || 0,
    Number(f.maxVisits) || VISITS_RANGE_MAX,
  ];
  const adsRange: [number, number] = [Number(f.minAds) || 0, Number(f.maxAds) || ADS_RANGE_MAX];
  const productsRange: [number, number] = [
    Number(f.minProducts) || 0,
    Number(f.maxProducts) || PRODUCTS_RANGE_MAX,
  ];
  const categoryLabel = f.categoryId
    ? (asStr(categories?.find((c) => String(asNum(c["id"])) === f.categoryId)?.["label"]) ??
      "1 selected")
    : null;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardContent className="space-y-3 p-4">
          {/* Preset views — one click applies a documented filter+sort recipe
              and runs the search. */}
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Presets
            </span>
            {SHOP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={`${p.hint} Runs a paid search — ${costLabel(costs, "shops/query", limit)}.`}
                disabled={searching}
                onClick={() => applyPreset(p)}
                aria-pressed={f.preset === p.id}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-60",
                  f.preset === p.id
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
            {f.preset !== "" && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  apply({
                    preset: "",
                    rules: [],
                    trending: false,
                    createdAfter: "",
                  })
                }
              >
                Clear preset
              </button>
            )}
          </div>

          {/* Search row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={f.search}
                onChange={(e) => {
                  setF((p) => ({ ...p, search: e.target.value }));
                  setTypeaheadOpen(true);
                }}
                onFocus={() => setTypeaheadOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setTypeaheadOpen(false);
                  if (e.key === "Enter") {
                    setTypeaheadOpen(false);
                    void runSearch();
                  }
                }}
                placeholder="brand or shop name, domain, product (optional)"
                className="rounded-full pl-9"
              />
              <SearchTypeahead
                term={f.search}
                open={typeaheadOpen}
                onClose={() => setTypeaheadOpen(false)}
                costs={costs}
                limit={limit}
                onPick={(s) => {
                  setTypeaheadOpen(false);
                  if (s.shopId) go({ tab: "shop", shopId: s.shopId });
                  else if (s.url) go({ tab: "shops", domain: s.url });
                }}
                onSearchAll={() => {
                  setTypeaheadOpen(false);
                  void runSearch();
                }}
              />
            </div>
            <Select
              value={f.searchType}
              onValueChange={(v) => setF((p) => ({ ...p, searchType: v }))}
            >
              <SelectTrigger className="w-44 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shopContains">Shop name / text</SelectItem>
                <SelectItem value="domain">Domain (exact)</SelectItem>
                <SelectItem value="productName">Product name</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={effectiveSort}
              onValueChange={(v) => {
                setSortTouched(true);
                apply({ sortBy: v });
              }}
            >
              <SelectTrigger className="w-44 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOP_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="rounded-full" disabled={searching} onClick={() => void runSearch()}>
              {searching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search — {costLabel(costs, "shops/query", limit)}
            </Button>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />

            {/* Growth rule builder — the "find winners early" filter. */}
            <FilterChip
              label="Growth"
              active={f.rules.length > 0}
              display={
                f.rules.length > 0
                  ? f.rules.map((r) => ruleLabel(r)).join(" + ")
                  : undefined
              }
              onApply={() => apply({})}
              onClear={() => apply({ rules: [] })}
              contentClassName="w-[24rem]"
            >
              <GrowthRulesContent
                rules={f.rules}
                onChange={(rules) => setF((p) => ({ ...p, rules, preset: "" }))}
              />
            </FilterChip>

            <FilterChip
              label="Traffic"
              active={Boolean(f.minVisits || f.maxVisits)}
              display={`${fmtCompact(visitsRange[0])}–${f.maxVisits ? fmtCompact(visitsRange[1]) : "∞"}`}
              onApply={() => apply({})}
              onClear={() => apply({ minVisits: "", maxVisits: "" })}
            >
              <DualRangeContent
                min={0}
                max={VISITS_RANGE_MAX}
                logScale
                value={visitsRange}
                onChange={([lo, hi]) =>
                  setF((p) => ({
                    ...p,
                    minVisits: lo > 0 ? String(lo) : "",
                    maxVisits: hi < VISITS_RANGE_MAX ? String(hi) : "",
                  }))
                }
                formatLabel={(n) => fmtCompact(n)}
              />
            </FilterChip>

            <FilterChip
              label="Active ads"
              active={Boolean(f.minAds || f.maxAds)}
              display={`${adsRange[0]}–${f.maxAds ? String(adsRange[1]) : "∞"}`}
              onApply={() => apply({})}
              onClear={() => apply({ minAds: "", maxAds: "" })}
            >
              <DualRangeContent
                min={0}
                max={ADS_RANGE_MAX}
                value={adsRange}
                onChange={([lo, hi]) =>
                  setF((p) => ({
                    ...p,
                    minAds: lo > 0 ? String(lo) : "",
                    maxAds: hi < ADS_RANGE_MAX ? String(hi) : "",
                  }))
                }
              />
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <span className="text-xs text-muted-foreground">Window</span>
                <Select
                  value={f.adsWindow}
                  onValueChange={(v) => setF((p) => ({ ...p, adsWindow: v }))}
                >
                  <SelectTrigger className="h-8 w-28 rounded-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last24h">24h</SelectItem>
                    <SelectItem value="last7d">7d</SelectItem>
                    <SelectItem value="last30d">30d</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FilterChip>

            <FilterChip
              label="Products"
              active={Boolean(f.minProducts || f.maxProducts)}
              display={`${productsRange[0]}–${f.maxProducts ? String(productsRange[1]) : "∞"}`}
              onApply={() => apply({})}
              onClear={() => apply({ minProducts: "", maxProducts: "" })}
            >
              <DualRangeContent
                min={0}
                max={PRODUCTS_RANGE_MAX}
                logScale
                value={productsRange}
                onChange={([lo, hi]) =>
                  setF((p) => ({
                    ...p,
                    minProducts: lo > 0 ? String(lo) : "",
                    maxProducts: hi < PRODUCTS_RANGE_MAX ? String(hi) : "",
                  }))
                }
                formatLabel={(n) => fmtCompact(n)}
              />
            </FilterChip>

            <FilterChip
              label="Country"
              active={f.countriesInc.length > 0 || f.countriesExc.length > 0}
              display={
                [
                  f.countriesInc.length > 0 ? `+${f.countriesInc.length}` : null,
                  f.countriesExc.length > 0 ? `−${f.countriesExc.length}` : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onApply={() => apply({})}
              onClear={() => apply({ countriesInc: [], countriesExc: [] })}
              contentClassName="w-[26rem]"
            >
              <CountryDualContent
                include={f.countriesInc}
                exclude={f.countriesExc}
                onIncludeChange={(c) => setF((p) => ({ ...p, countriesInc: c }))}
                onExcludeChange={(c) => setF((p) => ({ ...p, countriesExc: c }))}
              />
            </FilterChip>

            <FilterChip
              label="Category"
              active={f.categoryId !== ""}
              display={categoryLabel ?? undefined}
              onApply={() => apply({})}
              onClear={() => apply({ categoryId: "" })}
            >
              <ListContent
                searchable
                options={(categories ?? []).map((c) => ({
                  value: String(asNum(c["id"]) ?? ""),
                  label: asStr(c["label"]) ?? "—",
                }))}
                value={f.categoryId}
                onChange={(v) => setF((p) => ({ ...p, categoryId: v }))}
              />
            </FilterChip>

            <FilterChip
              label="Language"
              active={f.language !== ""}
              display={LANGUAGES.find((l) => l.code === f.language)?.name}
              onApply={() => apply({})}
              onClear={() => apply({ language: "" })}
            >
              <ListContent
                options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
                value={f.language}
                onChange={(v) => setF((p) => ({ ...p, language: v }))}
              />
            </FilterChip>

            <FilterChip
              label="Trustpilot"
              active={f.trustpilot !== ""}
              display={f.trustpilot ? `${f.trustpilot}+` : undefined}
              onApply={() => apply({})}
              onClear={() => apply({ trustpilot: "" })}
            >
              <ListContent
                options={[
                  { value: "3", label: "3.0+" },
                  { value: "4", label: "4.0+" },
                  { value: "4.5", label: "4.5+" },
                ]}
                value={f.trustpilot}
                onChange={(v) => setF((p) => ({ ...p, trustpilot: v }))}
              />
            </FilterChip>

            <button
              type="button"
              onClick={() => apply({ plusOnly: !f.plusOnly })}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                f.plusOnly
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              Shopify Plus
            </button>

            <button
              type="button"
              title="Upstream DTC preset (dtcRegion=all): only indexed DTC shops with at least 1 product. Skipped on exact-domain lookups, which are intentionally unfiltered."
              onClick={toggleDtcOnly}
              aria-pressed={f.dtcOnly}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
                f.dtcOnly
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.dtcOnly ? "DTC only" : "Show all"}
            </button>

            <div className="ml-auto flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Page size</Label>
              <Input
                value={String(limit)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setLimit(Math.min(100, Math.max(1, Math.trunc(n))));
                }}
                className="h-8 w-16 rounded-full text-xs"
                inputMode="numeric"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />

      {searching && pages.length === 0 && <LoadingRows rows={6} />}

      {call.state.kind === "ok" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Sorted by{" "}
            <span className="font-medium text-foreground">
              {SHOP_SORTS.find((s) => s.value === effectiveSort)?.label ?? effectiveSort}
            </span>
            {f.search.trim() !== "" && !sortTouched && " — auto-selected for text search"}
          </span>
          {f.dtcOnly && (
            <span>
              {dtcApplied
                ? "· DTC preset applied upstream (indexed DTC shops with at least 1 product) — excluded rows never cost credits."
                : "· DTC preset skipped for this exact-domain lookup — results are unfiltered by design."}
            </span>
          )}
          {multiWord && (
            <span>
              · Multi-word terms match loosely upstream — try the brand’s single-word name or its
              domain for a tight match.
            </span>
          )}
        </div>
      )}

      {allRows.length > 0 && (
        <Card className="overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 w-[280px] bg-card">Shop</TableHead>
                  <TableHead className="w-[236px]">Best sellers</TableHead>
                  <TableHead className="w-[150px]">Categories</TableHead>
                  <TableHead className="w-[190px]">Visits / month</TableHead>
                  <TableHead className="w-[190px]">Meta ads</TableHead>
                  <TableHead className="w-[210px]">Latest creatives</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allRows.map((row, i) => {
                  const id = asStr(row["id"]);
                  const rowDomain = asStr(row["domain"]);
                  const profile = asRec(row["profile"]);
                  const traffic = asRec(row["traffic"]);
                  const advertising = asRec(row["advertising"]);
                  const catalog = asRec(row["catalog"]);
                  const screenshot = asStr(row["screenshotUrl"]);
                  const name = asStr(row["name"]) ?? rowDomain ?? "Unknown shop";
                  const countryCode = asStr(profile["countryCode"]);
                  const createdAt = asStr(row["createdAt"]);
                  const age = shopAge(createdAt);
                  const sellers = asArr(catalog["bestSellers"]).map(asRec).slice(0, 3);
                  const productsCount = asNum(catalog["productsCount"]);
                  const cats = [
                    ...new Set(
                      [
                        asStr(catalog["mainCategory"]),
                        ...asArr(catalog["categories"]).map((c) => asStr(c)),
                      ].filter((c): c is string => !!c),
                    ),
                  ];
                  const visitCountries = asArr(traffic["topCountries"])
                    .map(asRec)
                    .map((c) => asStr(c["countryCode"]));
                  const adCountries = asArr(advertising["topCountries"])
                    .map(asRec)
                    .map((c) => asStr(c["countryCode"]));
                  const creatives = asArr(row["latestAds"]).map(asRec).slice(0, 3);
                  const activeAds = asNum(advertising["activeAds"]);
                  return (
                    <TableRow
                      key={id ?? i}
                      className={cn("h-[124px] border-b", id && "cursor-pointer")}
                      onClick={() => id && go({ tab: "shop", shopId: id })}
                    >
                      {/* 1 — Shop info (sticky) */}
                      <TableCell className="sticky left-0 z-10 bg-card align-middle">
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            {screenshot ? (
                              <img
                                src={screenshot}
                                alt=""
                                loading="lazy"
                                className="h-[68px] w-[108px] rounded-lg border object-cover"
                              />
                            ) : (
                              <div className="flex h-[68px] w-[108px] items-center justify-center rounded-lg border bg-muted">
                                <Store className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <Flag
                              code={countryCode}
                              size={16}
                              className="absolute -bottom-1 -right-1 ring-2 ring-card"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate text-sm font-semibold">{name}</p>
                              {profile["isShopifyPlus"] === true && (
                                <Badge
                                  variant="secondary"
                                  className="rounded-full px-1.5 py-0 text-[10px]"
                                >
                                  Plus
                                </Badge>
                              )}
                            </div>
                            {rowDomain && (
                              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                <Globe className="h-3 w-3 shrink-0" />
                                {rowDomain}
                              </p>
                            )}
                            {(createdAt || age) && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {createdAt?.slice(0, 10)}
                                {age && ` · ${age}`}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      {/* 2 — Best sellers: 3 thumbs on one row, count underneath */}
                      <TableCell className="align-middle">
                        <div className="space-y-1.5">
                          {sellers.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              {sellers.map((p, j) => {
                                const img = asStr(p["imageUrl"]);
                                return img ? (
                                  <img
                                    key={j}
                                    src={img}
                                    alt={asStr(p["title"]) ?? "Best seller"}
                                    loading="lazy"
                                    className="h-[64px] w-[64px] shrink-0 rounded-lg border object-cover"
                                  />
                                ) : null;
                              })}
                            </div>
                          )}
                          <p className="truncate text-xs text-muted-foreground">
                            {productsCount != null ? `${fmtInt(productsCount)} products` : "—"}
                          </p>
                        </div>
                      </TableCell>
                      {/* 3 — Categories */}
                      <TableCell className="align-middle">
                        {cats.length > 0 ? (
                          <div className="flex flex-col items-start gap-1">
                            {cats.slice(0, 2).map((c) => (
                              <Badge
                                key={c}
                                variant="secondary"
                                className="block max-w-full truncate rounded-full text-[10px]"
                                title={c}
                              >
                                {c}
                              </Badge>
                            ))}
                            {cats.length > 2 && (
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                +{cats.length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* 4 — Monthly visits: value + flags + sparkline in one cell */}
                      <TableCell className="align-middle">
                        <div className="space-y-1">
                          <span className="block text-sm font-semibold">
                            {fmtCompact(asNum(traffic["monthlyVisits"]))}
                          </span>
                          <FlagStack codes={visitCountries} size={14} />
                          <LazySparkline points={toTrendPoints(traffic["history"])} height={40} />
                        </div>
                      </TableCell>
                      {/* 5 — Meta ads: same rhythm as the visits cell */}
                      <TableCell className="align-middle">
                        <div className="space-y-1">
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            {activeAds != null && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                            )}
                            {fmtInt(activeAds)}
                          </span>
                          <FlagStack codes={adCountries} size={14} />
                          <LazySparkline
                            points={toTrendPoints(advertising["history"])}
                            height={40}
                          />
                        </div>
                      </TableCell>
                      {/* 6 — Latest creatives */}
                      <TableCell className="align-middle">
                        {creatives.length > 0 ? (
                          <div className="flex gap-1.5">
                            {creatives.map((a, j) => {
                              const img = asStr(a["thumbnailUrl"]) ?? asStr(a["mediaUrl"]);
                              const isVideo =
                                (asStr(a["type"]) ?? asStr(a["mediaType"])) === "video";
                              return (
                                <div
                                  key={j}
                                  className="relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-lg border bg-muted"
                                >
                                  {img && (
                                    <img
                                      src={img}
                                      alt="Ad creative"
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                    />
                                  )}
                                  {isVideo && (
                                    <Play className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {call.state.kind === "ok" && allRows.length === 0 && !searching && (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {f.dtcOnly
              ? "No DTC shops matched. Switch to “Show all” to include marketplaces and non-store sites, or loosen the filters."
              : "No shops matched. Loosen the filters or try another search."}
          </CardContent>
        </Card>
      )}

      {hasMore && !searching && (
        <div className="flex justify-center">
          <Button variant="outline" className="rounded-full" onClick={() => void loadMore()}>
            Load more — {costLabel(costs, "shops/query", limit)}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Large area chart with 3M/6M/ALL range toggle and a top-countries footer. */
function TrendChart({
  title,
  icon,
  points,
  countries,
}: {
  title: string;
  icon: React.ReactNode;
  points: TrendPoint[];
  countries: unknown;
}) {
  const [range, setRange] = React.useState<"3M" | "6M" | "ALL">("ALL");
  const filtered = filterRange(points, range);
  const countryRows = asArr(countries).map(asRec).slice(0, 5);
  if (points.length < 2 && countryRows.length === 0) return null;
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </CardTitle>
        <div className="flex gap-1">
          {(["3M", "6M", "ALL"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                range === r
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filtered.length >= 2 ? (
          <AreaChart points={filtered} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No series data.</p>
        )}
        {countryRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
            {countryRows.map((c, i) => {
              const code = asStr(c["countryCode"]) ?? asStr(c["code"]) ?? asStr(c["country"]);
              const share = asNum(c["share"]);
              return (
                <span key={i} className="flex items-center gap-1.5 text-xs">
                  <Flag code={code} size={14} />
                  <span className="font-medium">{code ?? "?"}</span>
                  {share != null && (
                    <span className="text-muted-foreground">{Math.round(share * 100)}%</span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3. SHOP DETAIL
// ---------------------------------------------------------------------------

function ShopDetailTab({
  shopId,
  go,
  costs,
}: {
  shopId?: string | undefined;
  go: SpyMarketToolsProps["go"];
  costs?: EndpointCosts | undefined;
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
  const tiktok = asRec(shop?.["tiktok"]);
  const tiktokActivity = asRec(tiktok["activity"]);
  const socials = asRec(shop?.["socials"]);
  const bestSellers = asArr(catalog["bestSellers"]).map(asRec);
  const latestAds = asArr(shop?.["latestAds"]).map(asRec);
  const similarShops = asArr(shop?.["similarShops"]).map(asRec);
  const domain = asStr(shop?.["domain"]);
  const [adDetailId, setAdDetailId] = React.useState<string | null>(null);

  const SOCIAL_PLATFORMS = [
    "facebook",
    "instagram",
    "tiktok",
    "youtube",
    "pinterest",
    "twitter",
    "linkedin",
  ] as const;

  const socialStats = SOCIAL_PLATFORMS.map((p) => asRec(socials[p]));
  const socialFollowerValues = socialStats.map((s) => asNum(s["followers"]));
  const socialTotal = socialFollowerValues.some((v) => v != null)
    ? socialFollowerValues.reduce<number>((acc, v) => acc + (v ?? 0), 0)
    : null;
  const socialCount = socialStats.filter(
    (s) => asNum(s["followers"]) != null || asStr(s["handle"]),
  ).length;

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
              Load profile — {costLabel(costs, "shops/detail", 1)}
            </Button>
          </CardContent>
        </Card>
      )}

      <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />

      {call.state.kind === "loading" && <LoadingRows rows={6} />}

      {shop && (
        <>
          {/* Header: identity + screenshot + trustpilot */}
          <Card className="rounded-2xl">
            <CardContent className="flex flex-wrap items-center gap-5 p-5">
              {asStr(shop["screenshotUrl"]) && (
                <img
                  src={asStr(shop["screenshotUrl"]) ?? ""}
                  alt={`Screenshot of ${domain ?? "shop"}`}
                  loading="lazy"
                  className="h-24 w-40 shrink-0 rounded-xl border object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">
                    {asStr(shop["name"]) ?? domain ?? "Unnamed shop"}
                  </h2>
                  {profile["isShopifyPlus"] === true && (
                    <Badge variant="secondary" className="rounded-full">
                      Shopify Plus
                    </Badge>
                  )}
                  {asStr(profile["countryCode"]) && (
                    <Badge variant="outline" className="rounded-full">
                      {asStr(profile["countryCode"])}
                    </Badge>
                  )}
                  {asStr(profile["currency"]) && (
                    <Badge variant="outline" className="rounded-full">
                      {asStr(profile["currency"])}
                    </Badge>
                  )}
                  {asStr(profile["defaultLanguage"]) && (
                    <Badge variant="outline" className="rounded-full">
                      {asStr(profile["defaultLanguage"])}
                    </Badge>
                  )}
                </div>
                {domain && (
                  <a
                    href={`https://${domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    {domain}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {asStr(shop["createdAt"]) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    First seen {asStr(shop["createdAt"])?.slice(0, 10)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="rounded-2xl">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Monthly visits</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-2xl font-semibold">
                    {fmtCompact(asNum(traffic["monthlyVisits"]))}
                  </p>
                  {asNum(traffic["growth30d"]) != null && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        (asNum(traffic["growth30d"]) ?? 0) >= 0
                          ? "bg-primary/15 text-primary"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {(asNum(traffic["growth30d"]) ?? 0) >= 0 ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {fmtPct(asNum(traffic["growth30d"]))}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">30-day growth</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Trustpilot</p>
                {asNum(trustpilot["rating"]) != null ? (
                  <>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-2xl font-semibold">
                        {asNum(trustpilot["rating"])?.toFixed(1)}
                      </p>
                      <Star className="h-4 w-4 fill-primary text-primary" />
                    </div>
                    <a
                      href={asStr(trustpilot["url"]) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {fmtInt(asNum(trustpilot["reviewCount"]))} reviews
                    </a>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No rating</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Socials</p>
                {socialTotal != null ? (
                  <>
                    <p className="mt-1 text-2xl font-semibold">{fmtCompact(socialTotal)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      followers across {socialCount} platform{socialCount === 1 ? "" : "s"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No profiles</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Big charts — series already in the shop payload, no extra calls */}
          <div className="grid gap-4 xl:grid-cols-2">
            <TrendChart
              title="Traffic over time"
              icon={<LineChart className="h-4 w-4 text-primary" />}
              points={toTrendPoints(traffic["history"])}
              countries={traffic["topCountries"]}
            />
            <TrendChart
              title="Active ads over time"
              icon={<Megaphone className="h-4 w-4 text-primary" />}
              points={toTrendPoints(advertising["history"])}
              countries={advertising["topCountries"] ?? advertising["countryDistribution"]}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Traffic */}
            <Section title="Traffic" icon={<LineChart className="h-4 w-4 text-primary" />}>
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
              {/* series chart moved to the big "Traffic over time" card above */}
              {asArr(traffic["topCountries"]).length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs font-medium text-muted-foreground">Top countries</p>
                  <CountryChips list={traffic["topCountries"]} />
                </div>
              )}
              {asArr(traffic["mainMarkets"]).length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Main markets</p>
                  <CountryChips list={traffic["mainMarkets"]} />
                </div>
              )}
            </Section>

            {/* Socials — object keyed by platform */}
            <Section title="Socials" icon={<Users className="h-4 w-4 text-primary" />}>
              <div className="space-y-1.5">
                {SOCIAL_PLATFORMS.map((platform) => {
                  const s = asRec(socials[platform]);
                  const followers = asNum(s["followers"]);
                  const handle = asStr(s["handle"]);
                  if (followers == null && !handle) return null;
                  const growth = asNum(s["growth30d"]);
                  return (
                    <div key={platform} className="flex items-center justify-between text-sm">
                      <span className="capitalize">
                        {platform}
                        {handle && (
                          <span className="ml-1 text-muted-foreground">@{handle}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {growth != null && (
                          <span
                            className={cn(
                              "text-xs",
                              growth > 0 && "text-primary",
                              growth < 0 && "text-destructive",
                            )}
                          >
                            {fmtPct(growth)}
                          </span>
                        )}
                        {fmtCompact(followers)}
                      </span>
                    </div>
                  );
                })}
                {SOCIAL_PLATFORMS.every((p) => {
                  const s = asRec(socials[p]);
                  return asNum(s["followers"]) == null && !asStr(s["handle"]);
                }) && <p className="text-sm text-muted-foreground">No social profiles found.</p>}
              </div>
            </Section>
          </div>

          {/* Advertising */}
          <Section
            title="Advertising"
            icon={<Megaphone className="h-4 w-4 text-primary" />}
            defaultOpen={false}
          >
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-lg font-semibold">{fmtInt(asNum(advertising["activeAds"]))}</p>
                <p className="text-xs text-muted-foreground">active ads</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-lg font-semibold">
                  {fmtInt(asNum(adSummary["avgActiveAds30d"]))}
                </p>
                <p className="text-xs text-muted-foreground">avg active 30d</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-lg font-semibold">{fmtCompact(asNum(adSummary["reach30d"]))}</p>
                <p className="text-xs text-muted-foreground">reach 30d (EU/UK)</p>
              </div>
            </div>
            {/* series chart moved to the big "Active ads over time" card above */}
            {asArr(advertising["countryDistribution"]).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Country distribution</p>
                <CountryChips list={advertising["countryDistribution"]} />
              </div>
            )}
            {asArr(advertising["adsCountryStats"]).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Ads by country</p>
                {asArr(advertising["adsCountryStats"])
                  .map(asRec)
                  .slice(0, 8)
                  .map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{asStr(c["countryCode"]) ?? "—"}</span>
                      <span className="text-muted-foreground">
                        {fmtInt(asNum(c["activeAds"]))} active · {fmtCompact(asNum(c["reach30d"]))}{" "}
                        reach
                      </span>
                    </div>
                  ))}
              </div>
            )}
            {asArr(advertising["linkedAdvertisers"]).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Linked advertisers</p>
                <div className="flex flex-wrap gap-1.5">
                  {asArr(advertising["linkedAdvertisers"])
                    .map(asRec)
                    .map((a, i) => (
                      <Badge key={i} variant="secondary" className="rounded-full text-[11px]">
                        {asStr(a["name"]) ?? "—"}
                        {a["isPrimary"] === true && " · primary"}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </Section>

          {/* Catalogue */}
          <Section
            title={`Catalogue · ${fmtInt(asNum(catalog["productsCount"]))} products`}
            icon={<Package className="h-4 w-4 text-primary" />}
            defaultOpen={false}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {asStr(catalog["mainCategory"]) && (
                <Badge className="rounded-full">{asStr(catalog["mainCategory"])}</Badge>
              )}
              {asArr(catalog["categories"])
                .map((c) => asStr(c))
                .filter((c): c is string => !!c)
                .slice(0, 10)
                .map((c) => (
                  <Badge key={c} variant="secondary" className="rounded-full text-[11px]">
                    {c}
                  </Badge>
                ))}
            </div>
            {asStr(catalog["myShopifyDomain"]) && (
              <p className="text-xs text-muted-foreground">
                myshopify: {asStr(catalog["myShopifyDomain"])}
              </p>
            )}
            {bestSellers.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {bestSellers.slice(0, 10).map((p, i) => {
                  const img = asStr(p["imageUrl"]);
                  return (
                    <div key={i} className="overflow-hidden rounded-xl border bg-card">
                      {img ? (
                        <img
                          src={img}
                          alt={asStr(p["title"]) ?? "Product"}
                          className="aspect-square w-full object-cover"
                          loading="lazy"
                        />
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
            )}
          </Section>

          {/* Tech stack */}
          {(asStr(technology["theme"]) ||
            asArr(technology["apps"]).length > 0 ||
            asArr(technology["pixels"]).length > 0) && (
            <Section title="Tech stack" icon={<FlaskConical className="h-4 w-4 text-primary" />} defaultOpen={false}>
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
                      .slice(0, 24)
                      .map((a, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="gap-1.5 rounded-full text-[11px]"
                        >
                          {asStr(a["iconUrl"]) && (
                            <img src={asStr(a["iconUrl"]) ?? ""} alt="" className="h-3.5 w-3.5 rounded" loading="lazy" />
                          )}
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
                      .slice(0, 24)
                      .map((p, i) => (
                        <Badge key={i} variant="outline" className="gap-1.5 rounded-full text-[11px]">
                          {asStr(p["iconUrl"]) && (
                            <img src={asStr(p["iconUrl"]) ?? ""} alt="" className="h-3.5 w-3.5 rounded" loading="lazy" />
                          )}
                          {asStr(p["name"]) ?? "Pixel"}
                          {asArr(p["categories"]).length > 0 && (
                            <span className="text-muted-foreground">
                              · {asArr(p["categories"]).map((c) => asStr(c)).filter(Boolean).join(", ")}
                            </span>
                          )}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* TikTok presence */}
          {(asStr(tiktok["handle"]) || asNum(tiktok["followers"]) != null) && (
            <Section title="TikTok" icon={<Eye className="h-4 w-4 text-primary" />} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                {(
                  [
                    ["Followers", fmtCompact(asNum(tiktok["followers"]))],
                    ["Posts", fmtInt(asNum(tiktok["totalPosts"]))],
                    ["Views", fmtCompact(asNum(tiktok["totalViews"]))],
                    ["Likes", fmtCompact(asNum(tiktok["totalLikes"]))],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-xl bg-muted/60 p-3">
                    <p className="text-lg font-semibold">{v}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {asStr(tiktok["handle"]) && <span>@{asStr(tiktok["handle"])}</span>}
                {asNum(tiktok["newPosts"]) != null && (
                  <span>{fmtInt(asNum(tiktok["newPosts"]))} new posts</span>
                )}
                {asNum(tiktokActivity["activeAds"]) != null && (
                  <span>{fmtInt(asNum(tiktokActivity["activeAds"]))} active ads</span>
                )}
                {asNum(tiktokActivity["totalAds"]) != null && (
                  <span>{fmtInt(asNum(tiktokActivity["totalAds"]))} total ads</span>
                )}
                {asStr(tiktok["lastUpdatedAt"]) && (
                  <span>updated {asStr(tiktok["lastUpdatedAt"])?.slice(0, 10)}</span>
                )}
              </div>
            </Section>
          )}

          {/* Latest ads */}
          {latestAds.length > 0 && (
            <Section title="Latest ads" icon={<Megaphone className="h-4 w-4 text-primary" />} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {latestAds.slice(0, 12).map((ad, i) => {
                  const media = asRec(ad["media"]);
                  const thumb = asStr(media["thumbnailUrl"]);
                  const adId = asStr(ad["id"]);
                  return (
                    <button
                      key={adId ?? i}
                      type="button"
                      disabled={!adId}
                      onClick={() => adId && setAdDetailId(adId)}
                      className="overflow-hidden rounded-xl border bg-card text-left transition-colors hover:bg-muted/50"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt="Ad creative"
                          className="aspect-square w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-muted">
                          <Megaphone className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="p-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {asStr(asRec(ad["content"])["title"]) ?? "View ad"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Similar shops — already in the payload, free */}
          {similarShops.length > 0 && (
            <Section
              title={`Similar shops · ${similarShops.length}`}
              icon={<Store className="h-4 w-4 text-primary" />}
              defaultOpen={false}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {similarShops.slice(0, 10).map((entry, i) => {
                  const s = asRec(entry["shop"]);
                  const id = asStr(s["id"]);
                  const score = asNum(entry["similarityScore"]);
                  return (
                    <button
                      key={id ?? i}
                      type="button"
                      disabled={!id}
                      onClick={() => id && go({ tab: "shop", shopId: id })}
                      className="flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {asStr(s["name"]) ?? asStr(s["domain"]) ?? "Unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {asStr(s["domain"]) ?? ""}
                          {score != null && ` · ${Math.round(score * 100)}% match`}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <ShopOnDemand shopId={shopId} go={go} costs={costs} />

          <RawJson data={shop} />
        </>
      )}

      <AdDetailDialog
        adId={adDetailId}
        costs={costs}
        onClose={() => setAdDetailId(null)}
      />
    </div>
  );
}

/** On-demand sections below a shop profile — each loads only when opened. */
function ShopOnDemand({
  shopId,
  go,
  costs,
}: {
  shopId: string;
  go: SpyMarketToolsProps["go"];
  costs?: EndpointCosts | undefined;
}) {
  const getTab = useServerFn(spymarketGetShopTab);
  const call = useMeteredCall(getTab as ServerFnLike);
  const [activeSection, setActiveSection] = React.useState<string | null>(null);
  const [sectionData, setSectionData] = React.useState<Record<string, ToolOk<unknown>>>({});
  const [emailDetailId, setEmailDetailId] = React.useState<string | number | null>(null);

  const sections = [
    { id: "products", label: "Products", limit: 20, endpoint: "shops/products", icon: Package },
    { id: "advertisers", label: "Advertisers", limit: 1, endpoint: "shops/advertisers", icon: Megaphone },
    { id: "tiktok", label: "TikTok library", limit: 20, endpoint: "shops/tiktok", icon: Eye },
    { id: "similar", label: "Similar shops", limit: 10, endpoint: "shops/similar", icon: Store },
    { id: "socials", label: "Social history", limit: 1, endpoint: "shops/socials", icon: LineChart },
    { id: "emails", label: "Emails", limit: 10, endpoint: "shops/emails", icon: Mail },
  ] as const;

  const open = async (sectionId: string, limit: number) => {
    setActiveSection(sectionId);
    if (sectionData[sectionId]) return; // already loaded this session
    await call.execute({ shopId, tab: sectionId, limit });
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
                onClick={() => void open(s.id, s.limit)}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" />
                {sectionData[s.id] ? s.label : `${s.label} — ${costLabel(costs, s.endpoint, s.limit)}`}
              </Button>
            );
          })}
        </div>

        {activeSection && !sectionData[activeSection] && (
          <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />
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
                  const s = asRec(r["shop"]);
                  const id = asStr(s["id"]);
                  const score = asNum(r["similarityScore"]);
                  const sTraffic = asRec(s["traffic"]);
                  return (
                    <button
                      key={id ?? i}
                      disabled={!id}
                      onClick={() => id && go({ tab: "shop", shopId: id })}
                      className="flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {asStr(s["name"]) ?? asStr(s["domain"]) ?? "Unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {asStr(s["domain"]) ?? ""}
                          {score != null && ` · ${Math.round(score * 100)}% match`}
                          {asNum(sTraffic["monthlyVisits"]) != null &&
                            ` · ${fmtCompact(asNum(sTraffic["monthlyVisits"]))} visits/mo`}
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
                  const productUrl = asStr(p["productUrl"]);
                  const inner = (
                    <>
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
                          {asStr(p["publishedAt"]) && ` · ${asStr(p["publishedAt"])?.slice(0, 10)}`}
                        </p>
                      </div>
                    </>
                  );
                  return productUrl ? (
                    <a
                      key={i}
                      href={productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="overflow-hidden rounded-xl border bg-card transition-colors hover:bg-muted/50"
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={i} className="overflow-hidden rounded-xl border bg-card">
                      {inner}
                    </div>
                  );
                })}
              </div>
            )}

            {active.id === "advertisers" && (
              <div className="grid gap-2">
                {rows.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {asStr(a["name"]) ?? "—"}
                        {a["isPrimary"] === true && (
                          <Badge className="rounded-full text-[10px]">primary</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {asStr(a["platform"]) && <span className="capitalize">{asStr(a["platform"])}</span>}
                        {asNum(a["activeAds"]) != null && ` · ${fmtInt(asNum(a["activeAds"]))} active ads`}
                      </p>
                    </div>
                    {asStr(a["facebookPageId"]) && (
                      <a
                        href={`https://www.facebook.com/${asStr(a["facebookPageId"])}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                ))}
                {rows.length === 0 && (
                  <p className="text-sm text-muted-foreground">No advertisers linked.</p>
                )}
              </div>
            )}

            {active.id === "socials" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(asRec(asRec(loaded.data)["data"])).map(([platform, points]) => {
                  const series = asArr(points).map(asRec);
                  if (series.length < 2) return null;
                  const latest = asNum(series[series.length - 1]?.["value"]);
                  const first = asNum(series[0]?.["value"]);
                  const growth =
                    latest != null && first != null && first > 0
                      ? (latest - first) / first
                      : null;
                  return (
                    <div key={platform} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium capitalize">{platform}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtCompact(latest)}
                          {growth != null && (
                            <span
                              className={cn(
                                "ml-1.5",
                                growth > 0 && "text-primary",
                                growth < 0 && "text-destructive",
                              )}
                            >
                              {fmtPct(growth)}
                            </span>
                          )}
                        </p>
                      </div>
                      <Sparkline points={toTrendPoints(series)} height={40} className="mt-2" />
                    </div>
                  );
                })}
              </div>
            )}

            {active.id === "emails" && (
              <div className="grid gap-2">
                {rows.map((e, i) => {
                  const emailId = asNum(e["id"]) ?? asStr(e["id"]);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={emailId == null}
                      onClick={() => emailId != null && setEmailDetailId(emailId)}
                      className="flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      {asStr(e["screenshotUrl"]) ? (
                        <img
                          src={asStr(e["screenshotUrl"]) ?? ""}
                          alt=""
                          loading="lazy"
                          className="h-12 w-10 shrink-0 rounded-md border object-cover"
                        />
                      ) : (
                        <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {asStr(e["subject"]) ?? "(no subject)"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {asStr(e["sentAt"])?.slice(0, 10) ?? "—"}
                          {asStr(e["campaignType"]) && ` · ${asStr(e["campaignType"])}`}
                          {asStr(asRec(e["classification"])["promotionType"]) &&
                            ` · ${asStr(asRec(e["classification"])["promotionType"])}`}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
                {rows.length === 0 && (
                  <p className="text-sm text-muted-foreground">No emails found for this shop.</p>
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
      <EmailDetailDialog
        emailId={emailDetailId}
        costs={costs}
        onClose={() => setEmailDetailId(null)}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. AD LIBRARY
// ---------------------------------------------------------------------------

const SAVED_ADS_KEY = "spymarket:saved-ads";

function readSavedAds(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_ADS_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 5-zone ad card. Zones render only when their data exists:
 *  Z1 data strip — EU/UK reach & spend with target flags, or a muted
 *     "Global — no targeting data" fallback (reach/spend is EU/UK-only).
 *  Z2 badges — days-running pill (green dot while active) + duplicates chip.
 *  Z3 FB-style header — page avatar, name, live ads count, main-country flag.
 *  Z4 body — copy clamped to 2 lines with See more, creative (9:16 video /
 *     1:1 image) with a centered play button, and a link box
 *     (domain / headline / CTA).
 *  Z5 footer — outline Save (local) + solid View details.
 */
function AdCard({ ad, onOpen }: { ad: Rec; onOpen: (id: string) => void }) {
  const media = asRec(ad["media"]);
  const content = asRec(ad["content"]);
  const metrics = asRec(ad["metrics"]);
  const advertiser = asRec(ad["advertiser"]);
  const audience = asRec(ad["audience"]);
  const flags = asRec(ad["flags"]);

  const adId = asStr(ad["id"]);
  const status = asStr(ad["status"]);
  const isVideo = asStr(media["type"]) === "video" || asStr(media["mediaType"]) === "video";
  const thumb = asStr(media["thumbnailUrl"]) ?? asStr(media["mediaUrl"]);
  const body = asStr(content["body"]);
  const headline = asStr(content["title"]) ?? asStr(content["ctaDescription"]);
  const domain = asStr(content["landingPageDomain"]);
  const landingUrl = asStr(content["landingPageUrl"]) ?? asStr(asRec(ad["links"])["landingPageUrl"]);
  const cta = asStr(content["callToAction"]);

  const reach = asNum(metrics["reach"]) ?? asNum(metrics["aggregatedReach"]);
  const spend = asNum(metrics["estimatedSpend"]);
  const duplicates = asNum(metrics["duplicates"]);
  const days = asNum(ad["daysRunning"]);
  const targeted = asArr(audience["targetedCountries"])
    .map(asStr)
    .filter((c): c is string => c != null);
  const mainCountry = asStr(audience["mainCountry"]);
  const hasTargeting = flags["isEuAd"] === true || reach != null || spend != null;

  const name = asStr(advertiser["name"]);
  const logo = asStr(advertiser["logoUrl"]);
  const liveAds = asNum(advertiser["liveAdsCount"]) ?? asNum(advertiser["activeAds"]);

  const [expanded, setExpanded] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (adId) setSaved(readSavedAds().includes(adId));
  }, [adId]);

  const toggleSave = () => {
    if (!adId) return;
    const ids = readSavedAds();
    const next = ids.includes(adId) ? ids.filter((x) => x !== adId) : [...ids, adId];
    try {
      window.localStorage.setItem(SAVED_ADS_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — state toggle still applies */
    }
    setSaved((v) => !v);
  };

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl",
        adId && "cursor-pointer transition-colors hover:bg-muted/40",
      )}
      onClick={() => adId && onOpen(adId)}
    >
      {/* Z1 — data strip */}
      <div className="flex min-h-8 items-center gap-2 border-b px-3 py-1.5 text-[11px]">
        {hasTargeting ? (
          <>
            <FlagStack codes={targeted.length > 0 ? targeted : [mainCountry]} size={12} max={4} />
            {reach != null && <span className="font-semibold">{fmtCompact(reach)} reach</span>}
            {spend != null && (
              <span className="text-muted-foreground">{fmtCompact(spend)} spend</span>
            )}
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">EU/UK</span>
          </>
        ) : (
          <span className="text-muted-foreground">Global — no targeting data</span>
        )}
      </div>

      {/* Z2 — badges */}
      {(days != null || (duplicates != null && duplicates > 0)) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          {days != null && (
            <Badge variant="secondary" className="gap-1.5 rounded-full text-[10px]">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status === "active" ? "bg-primary" : "bg-muted-foreground/50",
                )}
              />
              {fmtInt(days)}d {status === "active" ? "active" : "running"}
            </Badge>
          )}
          {duplicates != null && duplicates > 0 && (
            <Badge variant="outline" className="rounded-full text-[10px]">
              {fmtInt(duplicates)} duplicates
            </Badge>
          )}
        </div>
      )}

      {/* Z3 — FB-style page header */}
      {name && (
        <div className="flex items-center gap-2 px-3 pt-2">
          {logo ? (
            <img
              src={logo}
              alt={name}
              loading="lazy"
              className="h-8 w-8 shrink-0 rounded-full border object-cover"
            />
          ) : (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{name}</p>
            {liveAds != null && (
              <p className="text-[10px] text-muted-foreground">{fmtInt(liveAds)} active ads</p>
            )}
          </div>
          <Flag code={mainCountry} size={14} />
        </div>
      )}

      {/* Z4 — body */}
      {(body ?? thumb ?? domain) && (
        <div className="space-y-2 px-3 pt-2">
          {body && (
            <div>
              <p className={cn("text-xs text-muted-foreground", !expanded && "line-clamp-2")}>
                {body}
              </p>
              {body.length > 90 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                  className="mt-0.5 text-[11px] font-medium text-foreground hover:underline"
                >
                  {expanded ? "See less" : "See more"}
                </button>
              )}
            </div>
          )}
          {thumb && (
            <div
              className={cn(
                "relative mx-auto w-full overflow-hidden rounded-xl bg-muted",
                isVideo ? "aspect-[9/16] max-h-80" : "aspect-square",
              )}
            >
              <img
                src={thumb}
                alt={headline ?? "Ad creative"}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              {isVideo && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-background/85 shadow-md">
                    <Play className="ml-0.5 h-4 w-4 fill-foreground text-foreground" />
                  </div>
                </div>
              )}
            </div>
          )}
          {(domain ?? headline ?? cta) && (
            <a
              href={landingUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                if (!landingUrl) e.preventDefault();
              }}
              className="flex items-center gap-2 rounded-xl border bg-muted/40 px-2.5 py-2 transition-colors hover:bg-muted"
            >
              <div className="min-w-0 flex-1">
                {domain && (
                  <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                    {domain}
                  </p>
                )}
                {headline && <p className="truncate text-xs font-medium">{headline}</p>}
              </div>
              {cta && (
                <Badge className="shrink-0 rounded-full text-[10px] capitalize">
                  {cta.toLowerCase().replace(/_/g, " ")}
                </Badge>
              )}
            </a>
          )}
        </div>
      )}

      {/* Z5 — footer */}
      <div className="mt-auto flex items-center gap-2 p-3">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            toggleSave();
          }}
        >
          {saved ? (
            <BookmarkCheck className="mr-1.5 h-3.5 w-3.5 text-primary" />
          ) : (
            <Bookmark className="mr-1.5 h-3.5 w-3.5" />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button
          size="sm"
          className="ml-auto rounded-full"
          disabled={!adId}
          onClick={(e) => {
            e.stopPropagation();
            if (adId) onOpen(adId);
          }}
        >
          View details
        </Button>
      </div>
    </Card>
  );
}

function AdsTab({
  costs,
  url,
  go,
}: {
  costs?: EndpointCosts | undefined;
  url: Record<string, string | undefined>;
  go: SpyMarketToolsProps["go"];
}) {
  const searchAds = useServerFn(spymarketSearchAds);
  const call = useMeteredCall(searchAds as ServerFnLike);

  const [search, setSearch] = React.useState(url["aq"] ?? "");
  const [searchType, setSearchType] = React.useState(url["atyp"] ?? "adCopy");
  const [status, setStatus] = React.useState(url["astat"] ?? "active");
  const [mediaType, setMediaType] = React.useState(url["amed"] ?? "");
  const [sortBy, setSortBy] = React.useState(url["asort"] ?? "longestRunning");
  const [limit, setLimit] = React.useState(24);
  const [pages, setPages] = React.useState<Rec[][]>([]);
  const [adDetailId, setAdDetailId] = React.useState<string | null>(null);

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
                  setPages([]);
                  go({
                    tab: "ads",
                    aq: search.trim() || undefined,
                    atyp: searchType !== "adCopy" ? searchType : undefined,
                    astat: status !== "active" ? status : undefined,
                    amed: mediaType || undefined,
                    asort: sortBy !== "longestRunning" ? sortBy : undefined,
                  });
                  void call.execute(buildInput(1));
                }}
              >
                {searching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search — {costLabel(costs, search.trim() ? "ads" : "ads/query", limit)}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Reach/spend data covers EU &amp; UK ads only. Facebook platform only in public v1.
      </p>

      <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />

      {searching && pages.length === 0 && <LoadingRows rows={6} />}

      {allRows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {allRows.map((ad, i) => (
            <AdCard key={asStr(ad["id"]) ?? i} ad={ad} onOpen={setAdDetailId} />
          ))}
        </div>
      )}

      <AdDetailDialog adId={adDetailId} costs={costs} onClose={() => setAdDetailId(null)} />

      {pages.length > 0 && (pages[pages.length - 1]?.length ?? 0) >= limit && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="rounded-full"
            disabled={searching}
            onClick={() => void call.execute(buildInput(pages.length + 1))}
          >
            {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more — {costLabel(costs, search.trim() ? "ads" : "ads/query", limit)}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4b. AD DETAIL DIALOG — metered /ads/{id} + on-demand reach history & media
// ---------------------------------------------------------------------------

function AdDetailDialog({
  adId,
  costs,
  onClose,
}: {
  adId: string | null;
  costs?: EndpointCosts | undefined;
  onClose: () => void;
}) {
  const getAd = useServerFn(spymarketGetAd);
  const getReach = useServerFn(spymarketGetAdReachHistory);
  const getMedia = useServerFn(spymarketGetAdMediaUrl);
  const call = useMeteredCall(getAd as ServerFnLike);
  const reachCall = useMeteredCall(getReach as ServerFnLike);
  const mediaCall = useMeteredCall(getMedia as ServerFnLike);
  const loadedForRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (adId && loadedForRef.current !== adId) {
      loadedForRef.current = adId;
      void call.execute({ adId });
    }
    if (!adId) loadedForRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adId]);

  const ad =
    call.state.kind === "ok" && adId ? asRec(asRec(call.state.result.data)["data"]) : null;
  const content = asRec(ad?.["content"]);
  const metrics = asRec(ad?.["metrics"]);
  const advertiser = asRec(ad?.["advertiser"]);
  const audience = asRec(ad?.["audience"]);
  const flags = asRec(ad?.["flags"]);
  const media = asRec(ad?.["media"]);
  // The API sends media.type ("video" | "image"); mediaType kept as a safety
  // fallback for older cached payloads.
  const mediaKind = asStr(media["type"]) ?? asStr(media["mediaType"]);
  const isVideo = mediaKind === "video";
  // Video MP4s already ship in the detail payload — the paid ads/media-url
  // endpoint is only a fallback when no playable URL is present.
  const playableUrl = asStr(media["mediaUrl"]);
  const posterUrl = asStr(media["thumbnailUrl"]);
  const fetchedMediaUrl =
    mediaCall.state.kind === "ok"
      ? asStr(asRec(asRec(mediaCall.state.result.data)["data"])["mediaUrl"]) ??
        asStr(asRec(asRec(mediaCall.state.result.data)["data"])["url"])
      : null;

  const reachPoints =
    reachCall.state.kind === "ok"
      ? asArr(asRec(reachCall.state.result.data)["data"]).map(asRec)
      : null;

  return (
    <Dialog open={adId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 text-primary" />
            {asStr(content["title"]) ?? "Ad detail"}
          </DialogTitle>
        </DialogHeader>

        {call.state.kind === "loading" && <LoadingRows rows={4} />}
        {call.state.kind !== "ok" && (
          <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />
        )}

        {ad && (
          <div className="space-y-4">
            {/* Media */}
            {isVideo ? (
              (playableUrl ?? fetchedMediaUrl) ? (
                <video
                  src={playableUrl ?? fetchedMediaUrl ?? ""}
                  poster={posterUrl ?? undefined}
                  controls
                  className="w-full rounded-xl border"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={mediaCall.state.kind === "loading"}
                    onClick={() => adId && void mediaCall.execute({ adId })}
                  >
                    {mediaCall.state.kind === "loading" ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-3.5 w-3.5" />
                    )}
                    Load video — {costLabel(costs, "ads/media-url", 1)}
                  </Button>
                  <CallFeedback
                    state={mediaCall.state}
                    onConfirm={mediaCall.confirm}
                    onCancel={mediaCall.cancelConfirm}
                    onRetry={mediaCall.retry}
                  />
                </div>
              )
            ) : (posterUrl ?? playableUrl) ? (
              <img
                src={posterUrl ?? playableUrl ?? ""}
                alt="Ad creative"
                className="max-h-72 w-full rounded-xl border object-contain"
              />
            ) : null}

            {/* Copy */}
            <div className="space-y-1.5">
              {asStr(content["body"]) && (
                <p className="whitespace-pre-wrap text-sm">{asStr(content["body"])}</p>
              )}
              {asStr(content["transcript"]) && (
                <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Transcript: </span>
                  {asStr(content["transcript"])}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {asStr(content["callToAction"]) && (
                  <Badge className="rounded-full">{asStr(content["callToAction"])}</Badge>
                )}
                {asStr(content["landingPageUrl"]) && (
                  <a
                    href={asStr(content["landingPageUrl"]) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Landing page <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["Reach", fmtCompact(asNum(metrics["reach"]))],
                  ["Aggregated", fmtCompact(asNum(metrics["aggregatedReach"]))],
                  ["Est. spend", fmtCompact(asNum(metrics["estimatedSpend"]))],
                  ["Δ 24h", fmtCompact(asNum(metrics["reachDelta1d"]))],
                  ["Δ 7d", fmtCompact(asNum(metrics["reachDelta7d"]))],
                  ["Δ 30d", fmtCompact(asNum(metrics["reachDelta30d"]))],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="rounded-xl bg-muted/60 p-2">
                  <p className="text-sm font-semibold">{v}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reach/spend covers EU &amp; UK only.
              {flags["isEuAd"] === true && " This ad ran in the EU."}
            </p>

            {/* Reach history — on demand */}
            <div className="space-y-2">
              {reachPoints ? (
                <div className="rounded-xl border p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Reach over time
                    {reachCall.state.kind === "ok" && (
                      <span className="ml-2">
                        · cost {fmtInt(reachCall.state.result.creditsCost)} credits
                        {reachCall.state.result.cacheHit && " (cache)"}
                      </span>
                    )}
                  </p>
                  <Sparkline points={toTrendPoints(reachPoints)} height={64} />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={reachCall.state.kind === "loading"}
                    onClick={() => adId && void reachCall.execute({ adId })}
                  >
                    {reachCall.state.kind === "loading" ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LineChart className="mr-2 h-3.5 w-3.5" />
                    )}
                    Reach history — {costLabel(costs, "ads/reach-history", 30)}
                  </Button>
                </div>
              )}
              {reachCall.state.kind !== "ok" && reachCall.state.kind !== "idle" && (
                <CallFeedback
                  state={reachCall.state}
                  onConfirm={reachCall.confirm}
                  onCancel={reachCall.cancelConfirm}
                  onRetry={reachCall.retry}
                />
              )}
            </div>

            {/* Advertiser + audience */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Advertiser</p>
                <p className="font-medium">{asStr(advertiser["name"]) ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {asStr(advertiser["platform"]) && (
                    <span className="capitalize">{asStr(advertiser["platform"])}</span>
                  )}
                  {asNum(advertiser["activeAds"]) != null &&
                    ` · ${fmtInt(asNum(advertiser["activeAds"]))} active ads`}
                </p>
              </div>
              <div className="rounded-xl border p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Audience</p>
                <CountryChips list={audience["countries"]} max={6} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {asStr(audience["gender"]) && <span className="capitalize">{asStr(audience["gender"])}</span>}
                  {asStr(audience["ageRange"]) && ` · ${asStr(audience["ageRange"])}`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {asNum(ad["daysRunning"]) != null && <span>{asNum(ad["daysRunning"])}d running</span>}
              {asStr(ad["firstSeenAt"]) && <span>first seen {asStr(ad["firstSeenAt"])?.slice(0, 10)}</span>}
              {asStr(ad["lastSeenAt"]) && <span>last seen {asStr(ad["lastSeenAt"])?.slice(0, 10)}</span>}
              {asNum(metrics["duplicates"]) != null && asNum(metrics["duplicates"])! > 0 && (
                <span>{fmtInt(asNum(metrics["duplicates"]))} duplicates</span>
              )}
            </div>

            <RawJson data={ad} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 5. EMAILS — search across brands + detail dialog
// ---------------------------------------------------------------------------

function EmailDetailDialog({
  emailId,
  costs: _costs,
  onClose,
}: {
  emailId: string | number | null;
  costs?: EndpointCosts | undefined;
  onClose: () => void;
}) {
  const getEmail = useServerFn(spymarketGetEmail);
  const call = useMeteredCall(getEmail as ServerFnLike);
  const loadedForRef = React.useRef<string | number | null>(null);

  React.useEffect(() => {
    if (emailId != null && loadedForRef.current !== emailId) {
      loadedForRef.current = emailId;
      void call.execute({ emailId });
    }
    if (emailId == null) loadedForRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);

  const email =
    call.state.kind === "ok" && emailId != null
      ? asRec(asRec(call.state.result.data)["data"])
      : null;
  const shop = asRec(email?.["shop"]);
  const classification = asRec(email?.["classification"]);

  return (
    <Dialog open={emailId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            {asStr(email?.["subject"]) ?? "Email detail"}
          </DialogTitle>
        </DialogHeader>

        {call.state.kind === "loading" && <LoadingRows rows={4} />}
        {call.state.kind !== "ok" && (
          <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />
        )}

        {email && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {asStr(email["campaignType"]) && (
                <Badge className="rounded-full">{asStr(email["campaignType"])}</Badge>
              )}
              {asStr(classification["promotionType"]) && (
                <Badge variant="secondary" className="rounded-full">
                  {asStr(classification["promotionType"])}
                </Badge>
              )}
              {asStr(classification["category"]) && (
                <Badge variant="secondary" className="rounded-full">
                  {asStr(classification["category"])}
                </Badge>
              )}
              {asStr(classification["event"]) && (
                <Badge variant="outline" className="rounded-full">
                  {asStr(classification["event"])}
                </Badge>
              )}
              {asStr(email["sentAt"]) && (
                <Badge variant="outline" className="rounded-full">
                  {asStr(email["sentAt"])?.slice(0, 10)}
                </Badge>
              )}
            </div>

            {asStr(email["preheader"]) && (
              <p className="text-sm text-muted-foreground">{asStr(email["preheader"])}</p>
            )}

            {asStr(email["screenshotUrl"]) && (
              <img
                src={asStr(email["screenshotUrl"]) ?? ""}
                alt="Email screenshot"
                loading="lazy"
                className="max-h-96 w-full rounded-xl border object-contain"
              />
            )}

            {(asStr(email["bodyPreview"]) ?? asStr(email["body"])) && (
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {asStr(email["bodyPreview"]) ?? asStr(email["body"])}
                </p>
              </div>
            )}

            {(asStr(shop["domain"]) ?? asStr(shop["name"])) && (
              <div className="rounded-xl border p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Shop</p>
                <p className="font-medium">{asStr(shop["name"]) ?? asStr(shop["domain"])}</p>
                {asStr(shop["domain"]) && (
                  <a
                    href={`https://${asStr(shop["domain"])}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {asStr(shop["domain"])} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}

            <RawJson data={email} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmailsTab({ costs }: { costs?: EndpointCosts | undefined }) {
  const queryEmails = useServerFn(spymarketQueryEmails);
  const call = useMeteredCall(queryEmails as ServerFnLike);

  const [search, setSearch] = React.useState("");
  const [searchType, setSearchType] = React.useState("domain");
  const [sortBy, setSortBy] = React.useState("newest");
  const [campaignType, setCampaignType] = React.useState("");
  const [limit, setLimit] = React.useState(24);
  const [pages, setPages] = React.useState<Rec[][]>([]);
  const [emailDetailId, setEmailDetailId] = React.useState<string | number | null>(null);

  const buildInput = (page: number): Record<string, unknown> => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    searchType,
    sortBy,
    ...(campaignType.trim() ? { campaignType: campaignType.trim() } : {}),
    limit,
    page,
  });

  const lastResultRef = React.useRef<ToolOk<unknown> | null>(null);
  React.useEffect(() => {
    if (call.state.kind === "ok" && call.state.result !== lastResultRef.current) {
      lastResultRef.current = call.state.result;
      const rows = dataRows(call.state.result.data);
      setPages((prev) => [...prev, rows]);
    }
  }, [call.state]);

  const searching = call.state.kind === "loading";
  const allRows = pages.flat();

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            Email search
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="domain, sender email or keywords…"
              className="rounded-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Search type</Label>
            <Select value={searchType} onValueChange={setSearchType}>
              <SelectTrigger className="rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="domain">Domain</SelectItem>
                <SelectItem value="email">Sender email</SelectItem>
                <SelectItem value="shopKeywords">Shop keywords</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Sort</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="relevance">Relevance</SelectItem>
                <SelectItem value="monthlyVisits">Shop traffic</SelectItem>
                <SelectItem value="bodyLength">Body length</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Campaign type (optional)</Label>
            <Input
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value)}
              placeholder="e.g. promotion, newsletter"
              className="rounded-full"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label>Page size</Label>
              <Input
                value={String(limit)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, ""));
                  setLimit(Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 24);
                }}
                inputMode="numeric"
                className="w-24 rounded-full"
              />
            </div>
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
              Search — {costLabel(costs, "emails/query", limit)}
            </Button>
          </div>
        </CardContent>
      </Card>

      <CallFeedback
        state={call.state}
        onConfirm={call.confirm}
        onCancel={call.cancelConfirm}
        onRetry={call.retry}
      />

      {searching && pages.length === 0 && <LoadingRows rows={4} />}

      {allRows.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {allRows.map((e, i) => {
            const id = asNum(e["id"]) ?? asStr(e["id"]);
            const classification = asRec(e["classification"]);
            const shop = asRec(e["shop"]);
            return (
              <button
                key={String(id ?? i)}
                type="button"
                disabled={id == null}
                onClick={() => id != null && setEmailDetailId(id)}
                className="flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
              >
                {asStr(e["screenshotUrl"]) ? (
                  <img
                    src={asStr(e["screenshotUrl"]) ?? ""}
                    alt=""
                    loading="lazy"
                    className="h-14 w-11 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {asStr(e["subject"]) ?? "(no subject)"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {asStr(shop["domain"]) ?? asStr(e["fromEmail"]) ?? ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {asStr(e["sentAt"]) && (
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {asStr(e["sentAt"])?.slice(0, 10)}
                      </Badge>
                    )}
                    {asStr(e["campaignType"]) && (
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {asStr(e["campaignType"])}
                      </Badge>
                    )}
                    {asStr(classification["promotionType"]) && (
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {asStr(classification["promotionType"])}
                      </Badge>
                    )}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
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
            Load more — {costLabel(costs, "emails/query", limit)}
          </Button>
        </div>
      )}

      <EmailDetailDialog
        emailId={emailDetailId}
        costs={costs}
        onClose={() => setEmailDetailId(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. USAGE — free dashboard over our own log
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
          <CardTitle className="text-sm font-medium">Observed pricing (credits per row)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.observedPricing.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pricing learned yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Credits/row</TableHead>
                  <TableHead className="text-right">Samples</TableHead>
                  <TableHead className="text-right">Last observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.observedPricing.map((p) => (
                  <TableRow key={p.endpoint}>
                    <TableCell className="font-mono text-xs">{p.endpoint}</TableCell>
                    <TableCell className="text-right">
                      {p.sampleCount === 0 ? (
                        <Badge variant="outline" className="rounded-full">
                          provisional — not measured
                        </Badge>
                      ) : (
                        p.creditsPerRow
                      )}
                    </TableCell>
                    <TableCell className="text-right">{p.sampleCount}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {p.lastObservedAt
                        ? new Date(p.lastObservedAt).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
                      {r.error && (
                        <Badge
                          variant="destructive"
                          className="rounded-full"
                          title={r.error}
                        >
                          {r.error.startsWith("timeout") ? "timeout" : "failed"}
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


