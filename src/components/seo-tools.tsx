/**
 * FlySales SEO — ADMIN-ONLY internal research UI over the DataForSEO v3 API.
 *
 * Cost discipline (mirrors the SpyMarket tool):
 *  - every paid action prints its price on the button BEFORE it fires;
 *  - nothing fires on keystroke or render — only explicit button clicks;
 *  - free endpoints (balance, locations) are never gated;
 *  - repeats are served from the server-side cache at zero cost;
 *  - past the daily soft cap the server asks for an explicit confirmation.
 * All data flows through seo.functions (server gateway + cache + usage log).
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Database,
  Download,
  Globe,
  Loader2,
  Play,
  Wallet,
} from "lucide-react";
import {
  getSeoStatus,
  seoDomainOverview,
  seoKeywordIdeas,
  seoKeywordVolume,
  seoLocations,
  seoSerp,
  seoUsageDashboard,
} from "@/lib/seo.functions";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Chip,
  FilterTabs,
  PanelHeader,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
import { cn } from "@/lib/utils";

import {
  asArr,
  asNum,
  asRec,
  CostButton,
  ENDPOINTS,
  int,
  LANGUAGES,
  type OverageAsk,
  QUICK_MARKETS,
  readResult,
  ResultMeta,
  type Rec,
  usd,
} from "@/components/seo-common";
import { SeoPhase2Tab } from "@/components/seo-phase2";


// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------

const TABS = [
  { id: "domain", label: "Domain overview" },
  { id: "keywords", label: "Keyword research" },
  { id: "serp", label: "SERP check" },
  { id: "competitors", label: "Competitors" },
  { id: "gap", label: "Keyword gap" },
  { id: "ranked", label: "Ranked keywords" },
  { id: "backlinks", label: "Backlinks" },
  { id: "usage", label: "Usage" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SeoTools({
  tab,
  go,
}: {
  tab: string;
  go: (patch: Record<string, string | undefined>) => void;
}) {
  const queryClient = useQueryClient();
  const statusFn = useServerFn(getSeoStatus);
  const locationsFn = useServerFn(seoLocations);

  const status = useQuery({
    queryKey: ["seo-status"],
    queryFn: () => statusFn(),
    staleTime: 60_000,
  });

  // Free endpoint, cached permanently server-side — safe to load on render.
  const locations = useQuery({
    queryKey: ["seo-locations"],
    queryFn: () => locationsFn(),
    staleTime: Infinity,
    enabled: status.data?.configured === true,
  });

  const [locationCode, setLocationCode] = React.useState<number>(2620);
  const [languageCode, setLanguageCode] = React.useState<string>("pt");
  const [overage, setOverage] = React.useState<OverageAsk>(null);
  const pendingRun = React.useRef<(() => void) | null>(null);

  const refreshCost = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["seo-status"] });
    void queryClient.invalidateQueries({ queryKey: ["seo-usage"] });
  }, [queryClient]);

  const askOverage = React.useCallback((ask: NonNullable<OverageAsk>, retry: () => void) => {
    pendingRun.current = retry;
    setOverage(ask);
  }, []);

  const active = (TABS.some((t) => t.id === tab) ? tab : "domain") as TabId;
  const prices = status.data?.prices ?? {};

  const marketCtl = (
    <MarketSelector
      locationCode={locationCode}
      languageCode={languageCode}
      locations={locations.data ?? []}
      onLocation={setLocationCode}
      onLanguage={setLanguageCode}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">FlySales SEO</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Internal SEO research on the DataForSEO live API. Every paid call shows its price
            first, is cached server-side and logged with the exact cost the API charged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="primary">
            <Wallet className="h-3 w-3" /> balance{" "}
            {status.data?.balance == null ? "—" : usd(status.data.balance, 2)}
          </Chip>
          <Chip tone={(status.data?.spentToday ?? 0) > 0 ? "warning" : "neutral"}>
            spent today {usd(status.data?.spentToday ?? 0)} / {usd(status.data?.dailyLimit ?? 5, 2)}
          </Chip>
        </div>
      </div>

      {status.data && !status.data.configured && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>DataForSEO is not connected</AlertTitle>
          <AlertDescription>
            Add the DataForSEO login and password in the project secrets to enable this module.
          </AlertDescription>
        </Alert>
      )}

      <ToolBar>
        <FilterTabs tabs={TABS} value={active} onChange={(id) => go({ tab: id })} />
      </ToolBar>

      {active === "domain" && (
        <DomainTab
          price={prices[ENDPOINTS.domain]}
          locationCode={locationCode}
          languageCode={languageCode}
          market={marketCtl}
          onSpend={refreshCost}
          askOverage={askOverage}
        />
      )}
      {active === "keywords" && (
        <KeywordsTab
          priceVolume={prices[ENDPOINTS.volume]}
          priceIdeas={prices[ENDPOINTS.ideas]}
          locationCode={locationCode}
          languageCode={languageCode}
          market={marketCtl}
          onSpend={refreshCost}
          askOverage={askOverage}
        />
      )}
      {active === "serp" && (
        <SerpTab
          price={prices[ENDPOINTS.serp]}
          locationCode={locationCode}
          languageCode={languageCode}
          market={marketCtl}
          onSpend={refreshCost}
          askOverage={askOverage}
        />
      )}
      {active === "usage" && <UsageTab />}

      <AlertDialog open={overage != null} onOpenChange={(o) => !o && setOverage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Daily spend limit reached</AlertDialogTitle>
            <AlertDialogDescription>
              You have spent {usd(overage?.spentToday ?? 0)} today, and the soft limit is{" "}
              {usd(overage?.limit ?? 0, 2)}. This call costs about{" "}
              {usd(overage?.estimatedCost ?? 0)}. Continue anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const run = pendingRun.current;
                setOverage(null);
                pendingRun.current = null;
                run?.();
              }}
            >
              Run it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// market selector (free)
// ---------------------------------------------------------------------------

function MarketSelector({
  locationCode,
  languageCode,
  locations,
  onLocation,
  onLanguage,
}: {
  locationCode: number;
  languageCode: string;
  locations: Array<{ code: number; name: string; countryCode: string | null }>;
  onLocation: (v: number) => void;
  onLanguage: (v: string) => void;
}) {
  const options = locations.length
    ? locations
    : QUICK_MARKETS.map((m) => ({ code: m.code, name: m.label, countryCode: null }));

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[190px]">
        <Label className="text-[11px] text-muted-foreground">Location</Label>
        <Select value={String(locationCode)} onValueChange={(v) => onLocation(Number(v))}>
          <SelectTrigger className="h-9 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[320px]">
            {options.map((o) => (
              <SelectItem key={o.code} value={String(o.code)}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[150px]">
        <Label className="text-[11px] text-muted-foreground">Language</Label>
        <Select value={languageCode} onValueChange={onLanguage}>
          <SelectTrigger className="h-9 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-1 pb-1">
        {QUICK_MARKETS.map((m) => (
          <button
            key={m.code}
            type="button"
            onClick={() => {
              onLocation(m.code);
              onLanguage(m.lang);
            }}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              locationCode === m.code
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Domain overview
// ---------------------------------------------------------------------------

const POSITION_BUCKETS = [
  ["pos_1", "#1"],
  ["pos_2_3", "#2–3"],
  ["pos_4_10", "#4–10"],
  ["pos_11_20", "#11–20"],
  ["pos_21_30", "#21–30"],
  ["pos_31_40", "#31–40"],
  ["pos_41_50", "#41–50"],
  ["pos_51_60", "#51–60"],
  ["pos_61_70", "#61–70"],
  ["pos_71_80", "#71–80"],
  ["pos_81_90", "#81–90"],
  ["pos_91_100", "#91–100"],
] as const;

function DomainTab({
  price,
  locationCode,
  languageCode,
  market,
  onSpend,
  askOverage,
  seed,
}: {
  price: number | undefined;
  locationCode: number;
  languageCode: string;
  market: React.ReactNode;
  onSpend: () => void;
  askOverage: (ask: NonNullable<OverageAsk>, retry: () => void) => void;
  seed?: string;
}) {
  const call = useServerFn(seoDomainOverview);
  const [target, setTarget] = React.useState(seed ?? "");
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ cost: number; cacheHit: boolean } | null>(null);
  const [metrics, setMetrics] = React.useState<{ organic: Rec; paid: Rec } | null>(null);

  const run = React.useCallback(
    async (confirmOverage: boolean) => {
      const domain = target.trim();
      if (!domain) return;
      setRunning(true);
      setError(null);
      try {
        const res = readResult(
          await call({
            data: { target: domain, locationCode, languageCode, confirmOverage },
          }),
        );
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void run(true),
          );
          return;
        }
        const first = asRec(asArr(res.data)[0]);
        const item = asRec(asArr(first["items"])[0]);
        const m = asRec(item["metrics"]);
        setMetrics({ organic: asRec(m["organic"]), paid: asRec(m["paid"]) });
        setMeta({ cost: res.cost, cacheHit: res.cacheHit });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(false);
      }
    },
    [askOverage, call, languageCode, locationCode, onSpend, target],
  );

  const organic = metrics?.organic ?? {};

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Domain overview"
        description="Organic keyword count, estimated traffic value and rank distribution for one domain."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-[240px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Domain</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="example.com"
            className="h-9 text-[13px]"
          />
        </div>
        {market}
        <CostButton
          price={price}
          running={running}
          disabled={!target.trim()}
          onClick={() => void run(false)}
          label="Run overview"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {metrics && (
        <>
          <div className="flex items-center justify-end">
            {meta && <ResultMeta cost={meta.cost} cacheHit={meta.cacheHit} />}
          </div>
          <SummaryBar
            items={[
              {
                key: "kw",
                label: "Organic keywords",
                value: int(asNum(organic["count"])),
                tone: "primary",
              },
              {
                key: "etv",
                label: "Est. traffic value / mo",
                value: usd(asNum(organic["etv"]), 0),
                tone: "success",
              },
              {
                key: "top3",
                label: "Top 3 positions",
                value: int(
                  (asNum(organic["pos_1"]) ?? 0) + (asNum(organic["pos_2_3"]) ?? 0),
                ),
              },
              {
                key: "top10",
                label: "Top 10 positions",
                value: int(
                  (asNum(organic["pos_1"]) ?? 0) +
                    (asNum(organic["pos_2_3"]) ?? 0) +
                    (asNum(organic["pos_4_10"]) ?? 0),
                ),
              },
              {
                key: "paid",
                label: "Paid keywords",
                value: int(asNum(asRec(metrics.paid)["count"])),
                tone: "info",
              },
            ]}
          />
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Position band</TableHead>
                  <TableHead className="text-right">Keywords</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {POSITION_BUCKETS.map(([key, label]) => {
                  const n = asNum(organic[key]) ?? 0;
                  const total = asNum(organic["count"]) ?? 0;
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(n)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {total ? `${((n / total) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableShell>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Keyword research
// ---------------------------------------------------------------------------

interface KwRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowBid: number | null;
  highBid: number | null;
}

type KwSort = "volume" | "cpc" | "competition" | "keyword";

function KeywordsTab({
  priceVolume,
  priceIdeas,
  locationCode,
  languageCode,
  market,
  onSpend,
  askOverage,
}: {
  priceVolume: number | undefined;
  priceIdeas: number | undefined;
  locationCode: number;
  languageCode: string;
  market: React.ReactNode;
  onSpend: () => void;
  askOverage: (ask: NonNullable<OverageAsk>, retry: () => void) => void;
}) {
  const volumeFn = useServerFn(seoKeywordVolume);
  const ideasFn = useServerFn(seoKeywordIdeas);
  const [raw, setRaw] = React.useState("");
  const [running, setRunning] = React.useState<"volume" | "ideas" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ cost: number; cacheHit: boolean } | null>(null);
  const [rows, setRows] = React.useState<KwRow[]>([]);
  const [sort, setSort] = React.useState<KwSort>("volume");

  const keywords = React.useMemo(
    () =>
      raw
        .split(/[\n,;]+/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 1000),
    [raw],
  );

  const parseItems = (data: unknown): KwRow[] =>
    asArr(data).map((it) => {
      const r = asRec(it);
      return {
        keyword: String(r["keyword"] ?? ""),
        volume: asNum(r["search_volume"]),
        cpc: asNum(r["cpc"]),
        competition: typeof r["competition"] === "string" ? r["competition"] : null,
        competitionIndex: asNum(r["competition_index"]),
        lowBid: asNum(r["low_top_of_page_bid"]),
        highBid: asNum(r["high_top_of_page_bid"]),
      };
    });

  const run = React.useCallback(
    async (mode: "volume" | "ideas", confirmOverage: boolean) => {
      if (!keywords.length) return;
      const list = mode === "ideas" ? keywords.slice(0, 20) : keywords;
      setRunning(mode);
      setError(null);
      try {
        const fn = mode === "ideas" ? ideasFn : volumeFn;
        const res = readResult(
          await fn({ data: { keywords: list, locationCode, languageCode, confirmOverage } }),
        );
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void run(mode, true),
          );
          return;
        }
        setRows(parseItems(res.data));
        setMeta({ cost: res.cost, cacheHit: res.cacheHit });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(null);
      }
    },
    [askOverage, ideasFn, keywords, languageCode, locationCode, onSpend, volumeFn],
  );

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "keyword") return a.keyword.localeCompare(b.keyword);
      if (sort === "cpc") return (b.cpc ?? -1) - (a.cpc ?? -1);
      if (sort === "competition")
        return (b.competitionIndex ?? -1) - (a.competitionIndex ?? -1);
      return (b.volume ?? -1) - (a.volume ?? -1);
    });
    return copy;
  }, [rows, sort]);

  const exportCsv = () => {
    const header = "keyword,search_volume,cpc,competition,competition_index,low_bid,high_bid";
    const body = sorted
      .map((r) =>
        [
          `"${r.keyword.replace(/"/g, '""')}"`,
          r.volume ?? "",
          r.cpc ?? "",
          r.competition ?? "",
          r.competitionIndex ?? "",
          r.lowBid ?? "",
          r.highBid ?? "",
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flysales-keywords-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Keyword research"
        description="Volume, CPC and competition for up to 1000 keywords in a single paid call, plus keyword ideas from up to 20 seeds."
      />
      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div>
          <Label className="text-[11px] text-muted-foreground">
            Keywords — one per line or comma separated ({keywords.length} parsed, max 1000)
          </Label>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            placeholder={"candeeiro de mesa\njarra de vidro\nmesa de apoio"}
            className="text-[13px]"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {market}
          <CostButton
            price={priceVolume}
            running={running === "volume"}
            disabled={!keywords.length || running != null}
            onClick={() => void run("volume", false)}
            label={`Search volume (${keywords.length} kw, 1 call)`}
          />
          <CostButton
            price={priceIdeas}
            running={running === "ideas"}
            disabled={!keywords.length || running != null}
            onClick={() => void run("ideas", false)}
            label={`Keyword ideas (${Math.min(keywords.length, 20)} seeds)`}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <ToolBar>
            <Chip tone="neutral">{int(rows.length)} keywords</Chip>
            {meta && <ResultMeta cost={meta.cost} cacheHit={meta.cacheHit} />}
            <div className="ml-auto flex items-center gap-2">
              <Select value={sort} onValueChange={(v) => setSort(v as KwSort)}>
                <SelectTrigger className="h-8 w-[170px] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">Sort: volume</SelectItem>
                  <SelectItem value="cpc">Sort: CPC</SelectItem>
                  <SelectItem value="competition">Sort: competition</SelectItem>
                  <SelectItem value="keyword">Sort: A–Z</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
          </ToolBar>
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead className="text-right">Volume / mo</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Bid range</TableHead>
                  <TableHead className="text-right">Competition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.keyword}>
                    <TableCell className="font-medium">{r.keyword}</TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.volume)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Value>{r.cpc == null ? "" : usd(r.cpc, 2)}</Value>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.lowBid == null && r.highBid == null
                        ? "—"
                        : `${usd(r.lowBid, 2)} – ${usd(r.highBid, 2)}`}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.competition ? (
                        <Chip
                          tone={
                            r.competition === "HIGH"
                              ? "danger"
                              : r.competition === "MEDIUM"
                                ? "warning"
                                : "success"
                          }
                        >
                          {r.competition.toLowerCase()}
                          {r.competitionIndex != null ? ` ${r.competitionIndex}` : ""}
                        </Chip>
                      ) : (
                        <Value>{""}</Value>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. SERP check
// ---------------------------------------------------------------------------

function SerpTab({
  price,
  locationCode,
  languageCode,
  market,
  onSpend,
  askOverage,
}: {
  price: number | undefined;
  locationCode: number;
  languageCode: string;
  market: React.ReactNode;
  onSpend: () => void;
  askOverage: (ask: NonNullable<OverageAsk>, retry: () => void) => void;
}) {
  const call = useServerFn(seoSerp);
  const [keyword, setKeyword] = React.useState("");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ cost: number; cacheHit: boolean } | null>(null);
  const [features, setFeatures] = React.useState<string[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [items, setItems] = React.useState<
    Array<{ rank: number | null; domain: string; title: string; url: string }>
  >([]);

  const run = React.useCallback(
    async (confirmOverage: boolean) => {
      const kw = keyword.trim();
      if (!kw) return;
      setRunning(true);
      setError(null);
      try {
        const res = readResult(
          await call({ data: { keyword: kw, locationCode, languageCode, device, confirmOverage } }),
        );
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void run(true),
          );
          return;
        }
        const first = asRec(asArr(res.data)[0]);
        setFeatures(asArr(first["item_types"]).map(String));
        setTotal(asNum(first["se_results_count"]));
        setItems(
          asArr(first["items"])
            .map(asRec)
            .filter((it) => it["type"] === "organic")
            .slice(0, 20)
            .map((it) => ({
              rank: asNum(it["rank_group"]),
              domain: String(it["domain"] ?? ""),
              title: String(it["title"] ?? ""),
              url: String(it["url"] ?? ""),
            })),
        );
        setMeta({ cost: res.cost, cacheHit: res.cacheHit });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(false);
      }
    },
    [askOverage, call, device, keyword, languageCode, locationCode, onSpend],
  );

  return (
    <div className="space-y-4">
      <PanelHeader
        title="SERP check"
        description="Live Google top 20 for one keyword in one market, with the SERP features present on the page."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-[240px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Keyword</Label>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="mesa de apoio"
            className="h-9 text-[13px]"
          />
        </div>
        <div className="min-w-[130px]">
          <Label className="text-[11px] text-muted-foreground">Device</Label>
          <Select value={device} onValueChange={(v) => setDevice(v as "desktop" | "mobile")}>
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desktop">Desktop</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {market}
        <CostButton
          price={price}
          running={running}
          disabled={!keyword.trim()}
          onClick={() => void run(false)}
          label="Check SERP"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {items.length > 0 && (
        <>
          <ToolBar>
            <Chip tone="neutral">
              <Globe className="h-3 w-3" /> {int(total)} results
            </Chip>
            {features.map((f) => (
              <Chip key={f} tone={f === "organic" ? "primary" : "info"}>
                {f.replace(/_/g, " ")}
              </Chip>
            ))}
            <div className="ml-auto">
              {meta && <ResultMeta cost={meta.cost} cacheHit={meta.cacheHit} />}
            </div>
          </ToolBar>
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={`${it.rank}-${it.url}`}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {it.rank ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{it.domain}</TableCell>
                    <TableCell className="max-w-[420px] truncate">{it.title}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-[12px] text-muted-foreground">
                      <a href={it.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {it.url}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Usage
// ---------------------------------------------------------------------------

function UsageTab() {
  const usageFn = useServerFn(seoUsageDashboard);
  const { data, isPending } = useQuery({
    queryKey: ["seo-usage"],
    queryFn: () => usageFn(),
    staleTime: 30_000,
  });

  if (isPending || !data) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading usage…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Usage"
        description="Every DataForSEO call we made in the last 30 days, with the exact cost the API charged."
      />
      <SummaryBar
        items={[
          { key: "bal", label: "Account balance", value: usd(data.balance, 2), tone: "primary" },
          {
            key: "today",
            label: "Spent today",
            value: usd(data.spentToday),
            hint: `limit ${usd(data.dailyLimit, 2)}`,
            tone: data.spentToday > data.dailyLimit ? "danger" : "neutral",
          },
          { key: "30d", label: "Spent 30 days", value: usd(data.spentTotal), tone: "warning" },
          { key: "calls", label: "Calls logged", value: int(data.totalCalls) },
          {
            key: "cache",
            label: "Cache hit rate",
            value: `${(data.cacheHitRate * 100).toFixed(0)}%`,
            tone: "success",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <PanelHeader title="By day" />
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cached</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byDay.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="tabular-nums">{d.day}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.calls}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {d.cached}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(d.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </div>
        <div>
          <PanelHeader title="By endpoint" />
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cached</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byEndpoint.map((e) => (
                  <TableRow key={e.endpoint}>
                    <TableCell className="max-w-[260px] truncate text-[12px]">
                      {e.endpoint}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.calls}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {e.cached}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(e.cost)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {usd(data.learnedCosts[e.endpoint])}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </div>
      </div>

      <div>
        <PanelHeader title="Recent calls" />
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Request</TableHead>
                <TableHead className="text-right">ms</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("en-GB")}
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-[12px]">{r.endpoint}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-[12px] text-muted-foreground">
                    {JSON.stringify(r.summary)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.durationMs ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.cached ? <Chip tone="success">free</Chip> : usd(r.cost)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Chip tone={r.status === "ok" ? "neutral" : "danger"}>{r.status}</Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      </div>
    </div>
  );
}

