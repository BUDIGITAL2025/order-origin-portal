/**
 * FlySales SEO — Phase 2: competitor intelligence and backlinks.
 *
 * Same discipline as Phase 1: nothing fires on render or keystroke, every
 * button prints its estimated price first, single actions above $0.25 need an
 * explicit confirmation, results are served free from the server cache on a
 * repeat, and every call lands in the shared usage log.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, Link2, Search, Users } from "lucide-react";
import {
  seoBacklinksDrilldown,
  seoBacklinksSummary,
  seoCompetitors,
  seoKeywordGap,
  seoRankedKeywords,
} from "@/lib/seo.functions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Chip, PanelHeader, SummaryBar, TableShell } from "@/components/admin-ui";
import {
  asArr,
  asNum,
  asRec,
  BIG_SPEND_USD,
  type AskOverage,
  type ConfirmSpend,
  CostButton,
  downloadCsv,
  ENDPOINTS,
  estimate,
  int,
  readResult,
  ResultMeta,
  usd,
} from "@/components/seo-common";
import { cn } from "@/lib/utils";

export type Phase2Kind = "competitors" | "gap" | "ranked" | "backlinks";

interface CommonProps {
  prices: Record<string, number>;
  perItem: Record<string, number>;
  locationCode: number;
  languageCode: string;
  market: React.ReactNode;
  onSpend: () => void;
  askOverage: AskOverage;
  confirmSpend: ConfirmSpend;
  onOpenDomain: (domain: string) => void;
}

export function SeoPhase2Tab({ kind, ...rest }: CommonProps & { kind: Phase2Kind }) {
  if (kind === "competitors") return <CompetitorsTab {...rest} />;
  if (kind === "gap") return <GapTab {...rest} />;
  if (kind === "ranked") return <RankedTab {...rest} />;
  return <BacklinksTab {...rest} />;
}

const cleanDomain = (v: string) =>
  v
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function SortHead({
  label,
  active,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "text-[12px] transition-colors hover:text-foreground",
          active ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </button>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// 1. Competitors
// ---------------------------------------------------------------------------

interface CompetitorRow {
  domain: string;
  intersections: number | null;
  avgPosition: number | null;
  keywords: number | null;
  etv: number | null;
  top3: number | null;
}
type CompSort = "intersections" | "keywords" | "etv" | "avgPosition" | "domain";

function CompetitorsTab({
  prices,
  perItem,
  locationCode,
  languageCode,
  market,
  onSpend,
  askOverage,
  confirmSpend,
  onOpenDomain,
}: CommonProps) {
  const call = useServerFn(seoCompetitors);
  const [target, setTarget] = React.useState("");
  const [limit, setLimit] = React.useState(50);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ cost: number; cacheHit: boolean } | null>(null);
  const [rows, setRows] = React.useState<CompetitorRow[]>([]);
  const [sort, setSort] = React.useState<CompSort>("intersections");

  const price = estimate(prices, perItem, ENDPOINTS.competitors, limit);

  const run = React.useCallback(
    async (confirmOverage: boolean) => {
      const domain = cleanDomain(target);
      if (!domain) return;
      setRunning(true);
      setError(null);
      try {
        const res = readResult(
          await call({ data: { target: domain, locationCode, languageCode, limit, confirmOverage } }),
        );
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void run(true),
          );
          return;
        }
        const first = asRec(asArr(res.data)[0]);
        setRows(
          asArr(first["items"]).map((it) => {
            const r = asRec(it);
            const organic = asRec(asRec(r["full_domain_metrics"])["organic"]);
            return {
              domain: String(r["domain"] ?? ""),
              intersections: asNum(r["intersections"]),
              avgPosition: asNum(r["avg_position"]),
              keywords: asNum(organic["count"]),
              etv: asNum(organic["etv"]),
              top3: (asNum(organic["pos_1"]) ?? 0) + (asNum(organic["pos_2_3"]) ?? 0),
            };
          }),
        );
        setMeta({ cost: res.cost, cacheHit: res.cacheHit });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(false);
      }
    },
    [askOverage, call, languageCode, limit, locationCode, onSpend, target],
  );

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "domain") return a.domain.localeCompare(b.domain);
      if (sort === "avgPosition") return (a.avgPosition ?? 999) - (b.avgPosition ?? 999);
      if (sort === "keywords") return (b.keywords ?? -1) - (a.keywords ?? -1);
      if (sort === "etv") return (b.etv ?? -1) - (a.etv ?? -1);
      return (b.intersections ?? -1) - (a.intersections ?? -1);
    });
    return copy;
  }, [rows, sort]);

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Competitors"
        description="Domains fighting for the same keywords as yours, with the size of the overlap. Click any row to run it through Domain overview (cache-aware)."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-[220px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Domain</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="antarte.pt"
            className="h-9 text-[13px]"
          />
        </div>
        <div className="w-[110px]">
          <Label className="text-[11px] text-muted-foreground">Rows</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
            className="h-9 text-[13px]"
          />
        </div>
        {market}
        <CostButton
          price={price}
          running={running}
          disabled={!target.trim()}
          onClick={() =>
            price > BIG_SPEND_USD
              ? confirmSpend(price, () => void run(false))
              : void run(false)
          }
          label="Find competitors"
        />
      </div>

      <ErrorNote error={error} />

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <Chip tone="neutral">
              <Users className="h-3 w-3" /> {rows.length} competitors
            </Chip>
            {meta && <ResultMeta cost={meta.cost} cacheHit={meta.cacheHit} />}
          </div>
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead
                    label="Domain"
                    align="left"
                    active={sort === "domain"}
                    onClick={() => setSort("domain")}
                  />
                  <SortHead
                    label="Shared keywords"
                    active={sort === "intersections"}
                    onClick={() => setSort("intersections")}
                  />
                  <SortHead
                    label="Their keywords"
                    active={sort === "keywords"}
                    onClick={() => setSort("keywords")}
                  />
                  <SortHead
                    label="Their traffic value"
                    active={sort === "etv"}
                    onClick={() => setSort("etv")}
                  />
                  <TableHead className="text-right">Top 3</TableHead>
                  <SortHead
                    label="Avg position"
                    active={sort === "avgPosition"}
                    onClick={() => setSort("avgPosition")}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow
                    key={r.domain}
                    onClick={() => onOpenDomain(r.domain)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">{r.domain}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {int(r.intersections)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.keywords)}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.etv, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {int(r.top3)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.avgPosition == null ? "—" : r.avgPosition.toFixed(1)}
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
// 2. Keyword gap
// ---------------------------------------------------------------------------

interface GapRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competitor: string;
  theirPos: number | null;
  yourPos: number | null;
}

type GapSort = "volume" | "cpc" | "theirPos" | "keyword";

function GapTab({
  prices,
  perItem,
  locationCode,
  languageCode,
  market,
  onSpend,
  askOverage,
  confirmSpend,
}: CommonProps) {
  const call = useServerFn(seoKeywordGap);
  const [yours, setYours] = React.useState("");
  const [competitors, setCompetitors] = React.useState<string[]>(["", "", ""]);
  const [limit, setLimit] = React.useState(200);
  const [minVolume, setMinVolume] = React.useState(100);
  const [maxPosition, setMaxPosition] = React.useState(20);
  const [mode, setMode] = React.useState<"gap" | "overlap">("gap");
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ cost: number; cacheHit: boolean; calls: number } | null>(
    null,
  );
  const [rows, setRows] = React.useState<GapRow[]>([]);
  const [sort, setSort] = React.useState<GapSort>("volume");

  const list = competitors.map(cleanDomain).filter(Boolean).slice(0, 3);
  const perCall = estimate(prices, perItem, ENDPOINTS.gap, limit);
  const total = Math.round(perCall * Math.max(1, list.length) * 1e6) / 1e6;

  const run = React.useCallback(
    async (confirmOverage: boolean) => {
      const you = cleanDomain(yours);
      if (!you || !list.length) return;
      setRunning(true);
      setError(null);
      try {
        const out: GapRow[] = [];
        let cost = 0;
        let cacheHit = true;
        // One call per competitor — the API compares two domains at a time.
        for (const competitor of list) {
          const res = readResult(
            await call({
              data: {
                target1: competitor,
                target2: you,
                intersections: mode === "overlap",
                locationCode,
                languageCode,
                limit,
                minVolume,
                maxPosition,
                confirmOverage,
              },
            }),
          );
          if (res.kind === "confirm") {
            askOverage(
              { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
              () => void run(true),
            );
            return;
          }
          cost += res.cost;
          if (!res.cacheHit) cacheHit = false;
          const first = asRec(asArr(res.data)[0]);
          for (const it of asArr(first["items"])) {
            const r = asRec(it);
            const kd = asRec(r["keyword_data"]);
            const info = asRec(kd["keyword_info"]);
            const theirs = asRec(r["first_domain_serp_element"]);
            const ours = asRec(r["second_domain_serp_element"]);
            out.push({
              keyword: String(kd["keyword"] ?? ""),
              volume: asNum(info["search_volume"]),
              cpc: asNum(info["cpc"]),
              competitor,
              theirPos: asNum(theirs["rank_group"]),
              yourPos: asNum(ours["rank_group"]),
            });
          }
        }
        setRows(out);
        setMeta({ cost: Math.round(cost * 1e6) / 1e6, cacheHit, calls: list.length });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(false);
      }
    },
    [
      askOverage,
      call,
      languageCode,
      limit,
      list,
      locationCode,
      maxPosition,
      minVolume,
      mode,
      onSpend,
      yours,
    ],
  );

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "keyword") return a.keyword.localeCompare(b.keyword);
      if (sort === "cpc") return (b.cpc ?? -1) - (a.cpc ?? -1);
      if (sort === "theirPos") return (a.theirPos ?? 999) - (b.theirPos ?? 999);
      return (b.volume ?? -1) - (a.volume ?? -1);
    });
    return copy;
  }, [rows, sort]);

  const totalVolume = sorted.reduce((s, r) => s + (r.volume ?? 0), 0);

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Keyword gap"
        description="Keywords your competitors rank for and you do not — the fastest list of pages worth writing. One paid call per competitor, never a loop."
      />
      <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-[11px] text-muted-foreground">Your domain</Label>
            <Input
              value={yours}
              onChange={(e) => setYours(e.target.value)}
              placeholder="flysales.io"
              className="h-9 text-[13px]"
            />
          </div>
          {competitors.map((c, i) => (
            <div key={i}>
              <Label className="text-[11px] text-muted-foreground">Competitor {i + 1}</Label>
              <Input
                value={c}
                onChange={(e) =>
                  setCompetitors((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
                placeholder={i === 0 ? "antarte.pt" : "optional"}
                className="h-9 text-[13px]"
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[120px]">
            <Label className="text-[11px] text-muted-foreground">Min volume</Label>
            <Input
              type="number"
              min={0}
              value={minVolume}
              onChange={(e) => setMinVolume(Math.max(0, Number(e.target.value) || 0))}
              className="h-9 text-[13px]"
            />
          </div>
          <div className="w-[130px]">
            <Label className="text-[11px] text-muted-foreground">Max their position</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={maxPosition}
              onChange={(e) =>
                setMaxPosition(Math.min(100, Math.max(1, Number(e.target.value) || 1)))
              }
              className="h-9 text-[13px]"
            />
          </div>
          <div className="w-[110px]">
            <Label className="text-[11px] text-muted-foreground">Rows / call</Label>
            <Input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
              className="h-9 text-[13px]"
            />
          </div>
          <div className="flex items-center gap-1 pb-1">
            {(["gap", "overlap"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  mode === m
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "gap" ? "Only keywords you miss" : "Shared keywords"}
              </button>
            ))}
          </div>
          {market}
          <CostButton
            price={total}
            running={running}
            disabled={!yours.trim() || !list.length}
            onClick={() =>
              total > BIG_SPEND_USD
                ? confirmSpend(total, () => void run(false))
                : void run(false)
            }
            label={`Run gap (${list.length || 1} call${list.length === 1 ? "" : "s"})`}
          />
        </div>
      </div>

      <ErrorNote error={error} />

      {rows.length > 0 && (
        <>
          <SummaryBar
            items={[
              { key: "kw", label: "Keywords found", value: int(sorted.length), tone: "primary" },
              {
                key: "vol",
                label: "Combined monthly volume",
                value: int(totalVolume),
                tone: "success",
              },
              { key: "calls", label: "Paid calls", value: String(meta?.calls ?? 0) },
              {
                key: "cost",
                label: "Charged",
                value: meta?.cacheHit ? "cached · free" : usd(meta?.cost ?? 0),
                tone: meta?.cacheHit ? "success" : "info",
              },
            ]}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() =>
                downloadCsv(
                  "flysales-keyword-gap",
                  ["keyword", "search_volume", "cpc", "competitor", "their_position", "your_position"],
                  sorted.map((r) => [r.keyword, r.volume, r.cpc, r.competitor, r.theirPos, r.yourPos]),
                )
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            {meta && <ResultMeta cost={meta.cost} cacheHit={meta.cacheHit} />}
          </div>
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead
                    label="Keyword"
                    align="left"
                    active={sort === "keyword"}
                    onClick={() => setSort("keyword")}
                  />
                  <SortHead
                    label="Volume"
                    active={sort === "volume"}
                    onClick={() => setSort("volume")}
                  />
                  <SortHead label="CPC" active={sort === "cpc"} onClick={() => setSort("cpc")} />
                  <TableHead>Competitor</TableHead>
                  <SortHead
                    label="Their position"
                    active={sort === "theirPos"}
                    onClick={() => setSort("theirPos")}
                  />
                  <TableHead className="text-right">Your position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, i) => (
                  <TableRow key={`${r.competitor}-${r.keyword}-${i}`}>
                    <TableCell className="max-w-[320px] truncate font-medium">
                      {r.keyword}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.volume)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.cpc == null ? "—" : usd(r.cpc, 2)}
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">
                      {r.competitor}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.theirPos)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.yourPos == null ? (
                        <Chip tone="warning">not ranking</Chip>
                      ) : (
                        int(r.yourPos)
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
// 3. Ranked keywords
// ---------------------------------------------------------------------------

interface RankedRow {
  keyword: string;
  position: number | null;
  volume: number | null;
  etv: number | null;
  url: string | null;
}
type RankedSort = "etv" | "volume" | "position" | "keyword";
const PAGE_SIZE = 100;

function RankedTab({
  prices,
  perItem,
  locationCode,
  languageCode,
  market,
  onSpend,
  askOverage,
  confirmSpend,
}: CommonProps) {
  const call = useServerFn(seoRankedKeywords);
  const [target, setTarget] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState<{ cost: number; cacheHit: boolean } | null>(null);
  const [rows, setRows] = React.useState<RankedRow[]>([]);
  const [totalCount, setTotalCount] = React.useState<number | null>(null);
  const [sort, setSort] = React.useState<RankedSort>("etv");

  const price = estimate(prices, perItem, ENDPOINTS.ranked, PAGE_SIZE);

  const run = React.useCallback(
    async (pageIndex: number, confirmOverage: boolean) => {
      const domain = cleanDomain(target);
      if (!domain) return;
      setRunning(true);
      setError(null);
      try {
        const res = readResult(
          await call({
            data: {
              target: domain,
              locationCode,
              languageCode,
              limit: PAGE_SIZE,
              offset: pageIndex * PAGE_SIZE,
              confirmOverage,
            },
          }),
        );
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void run(pageIndex, true),
          );
          return;
        }
        const first = asRec(asArr(res.data)[0]);
        setTotalCount(asNum(first["total_count"]));
        setRows(
          asArr(first["items"]).map((it) => {
            const r = asRec(it);
            const kd = asRec(r["keyword_data"]);
            const info = asRec(kd["keyword_info"]);
            const serp = asRec(asRec(r["ranked_serp_element"])["serp_item"]);
            return {
              keyword: String(kd["keyword"] ?? ""),
              position: asNum(serp["rank_group"]),
              volume: asNum(info["search_volume"]),
              etv: asNum(serp["etv"]),
              url: typeof serp["url"] === "string" ? serp["url"] : null,
            };
          }),
        );
        setPage(pageIndex);
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

  const fire = (pageIndex: number) =>
    price > BIG_SPEND_USD
      ? confirmSpend(price, () => void run(pageIndex, false))
      : void run(pageIndex, false);

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "keyword") return a.keyword.localeCompare(b.keyword);
      if (sort === "position") return (a.position ?? 999) - (b.position ?? 999);
      if (sort === "volume") return (b.volume ?? -1) - (a.volume ?? -1);
      return (b.etv ?? -1) - (a.etv ?? -1);
    });
    return copy;
  }, [rows, sort]);

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Ranked keywords"
        description="Everything a domain ranks for, 100 rows per paid page. Each page is its own call — the next page only fires when you ask for it."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-[220px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Domain</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="antarte.pt"
            className="h-9 text-[13px]"
          />
        </div>
        {market}
        <CostButton
          price={price}
          running={running}
          disabled={!target.trim()}
          onClick={() => fire(0)}
          label="Fetch page 1"
        />
      </div>

      <ErrorNote error={error} />

      {rows.length > 0 && (
        <>
          <SummaryBar
            items={[
              {
                key: "total",
                label: "Keywords ranked",
                value: int(totalCount),
                tone: "primary",
              },
              { key: "page", label: "Page", value: `${page + 1}`, hint: `${PAGE_SIZE} per page` },
              {
                key: "etv",
                label: "Traffic value on this page",
                value: usd(
                  sorted.reduce((s, r) => s + (r.etv ?? 0), 0),
                  0,
                ),
                tone: "success",
              },
              {
                key: "cost",
                label: "Charged",
                value: meta?.cacheHit ? "cached · free" : usd(meta?.cost ?? 0),
                tone: meta?.cacheHit ? "success" : "info",
              },
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CostButton
                price={price}
                variant="outline"
                running={running}
                disabled={page === 0}
                onClick={() => fire(page - 1)}
                label="Previous page"
              />
              <CostButton
                price={price}
                variant="outline"
                running={running}
                disabled={totalCount != null && (page + 1) * PAGE_SIZE >= totalCount}
                onClick={() => fire(page + 1)}
                label={`Next page (${page + 2})`}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() =>
                downloadCsv(
                  "flysales-ranked-keywords",
                  ["keyword", "position", "search_volume", "etv", "url"],
                  sorted.map((r) => [r.keyword, r.position, r.volume, r.etv, r.url]),
                )
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead
                    label="Keyword"
                    align="left"
                    active={sort === "keyword"}
                    onClick={() => setSort("keyword")}
                  />
                  <SortHead
                    label="Position"
                    active={sort === "position"}
                    onClick={() => setSort("position")}
                  />
                  <SortHead
                    label="Volume"
                    active={sort === "volume"}
                    onClick={() => setSort("volume")}
                  />
                  <SortHead
                    label="Est. traffic value"
                    active={sort === "etv"}
                    onClick={() => setSort("etv")}
                  />
                  <TableHead>Ranking URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, i) => (
                  <TableRow key={`${r.keyword}-${i}`}>
                    <TableCell className="max-w-[300px] truncate font-medium">
                      {r.keyword}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.position)}</TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.volume)}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(r.etv, 2)}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-[12px] text-muted-foreground">
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground hover:underline"
                        >
                          {r.url}
                        </a>
                      ) : (
                        "—"
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
// 4. Backlinks
// ---------------------------------------------------------------------------

type DrillKind = "referring_domains" | "backlinks" | "anchors";

function BacklinksTab({
  prices,
  perItem,
  onSpend,
  askOverage,
  confirmSpend,
}: CommonProps) {
  const summaryFn = useServerFn(seoBacklinksSummary);
  const drillFn = useServerFn(seoBacklinksDrilldown);
  const [target, setTarget] = React.useState("");
  const [limit, setLimit] = React.useState(100);
  const [running, setRunning] = React.useState<"summary" | DrillKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<Record<string, unknown> | null>(null);
  const [summaryMeta, setSummaryMeta] = React.useState<{ cost: number; cacheHit: boolean } | null>(
    null,
  );
  const [drill, setDrill] = React.useState<{
    kind: DrillKind;
    rows: Record<string, unknown>[];
    cost: number;
    cacheHit: boolean;
  } | null>(null);

  const summaryPrice = estimate(prices, perItem, ENDPOINTS.blSummary);
  const drillPrice = (kind: DrillKind) =>
    estimate(
      prices,
      perItem,
      kind === "referring_domains"
        ? ENDPOINTS.blDomains
        : kind === "anchors"
          ? ENDPOINTS.blAnchors
          : ENDPOINTS.blLinks,
      limit,
    );

  const runSummary = React.useCallback(
    async (confirmOverage: boolean) => {
      const domain = cleanDomain(target);
      if (!domain) return;
      setRunning("summary");
      setError(null);
      try {
        const res = readResult(await summaryFn({ data: { target: domain, confirmOverage } }));
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void runSummary(true),
          );
          return;
        }
        setSummary(asRec(asArr(res.data)[0]));
        setDrill(null);
        setSummaryMeta({ cost: res.cost, cacheHit: res.cacheHit });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(null);
      }
    },
    [askOverage, onSpend, summaryFn, target],
  );

  const runDrill = React.useCallback(
    async (kind: DrillKind, confirmOverage: boolean) => {
      const domain = cleanDomain(target);
      if (!domain) return;
      setRunning(kind);
      setError(null);
      try {
        const res = readResult(
          await drillFn({ data: { target: domain, kind, limit, confirmOverage } }),
        );
        if (res.kind === "confirm") {
          askOverage(
            { spentToday: res.spentToday, estimatedCost: res.estimatedCost, limit: res.limit },
            () => void runDrill(kind, true),
          );
          return;
        }
        const first = asRec(asArr(res.data)[0]);
        setDrill({
          kind,
          rows: asArr(first["items"]).map(asRec),
          cost: res.cost,
          cacheHit: res.cacheHit,
        });
        onSpend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed.");
      } finally {
        setRunning(null);
      }
    },
    [askOverage, drillFn, limit, onSpend, target],
  );

  const fireDrill = (kind: DrillKind) => {
    const p = drillPrice(kind);
    return p > BIG_SPEND_USD
      ? confirmSpend(p, () => void runDrill(kind, false))
      : void runDrill(kind, false);
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Backlinks"
        description="Start with the cheap profile summary; every deeper table is its own paid button with the price shown up front."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-[220px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Domain</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="antarte.pt"
            className="h-9 text-[13px]"
          />
        </div>
        <div className="w-[110px]">
          <Label className="text-[11px] text-muted-foreground">Rows</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
            className="h-9 text-[13px]"
          />
        </div>
        <CostButton
          price={summaryPrice}
          running={running === "summary"}
          disabled={!target.trim() || running != null}
          onClick={() => void runSummary(false)}
          label="Backlink summary"
        />
      </div>

      <ErrorNote error={error} />

      {summary && (
        <>
          <div className="flex items-center justify-end">
            {summaryMeta && (
              <ResultMeta cost={summaryMeta.cost} cacheHit={summaryMeta.cacheHit} />
            )}
          </div>
          <SummaryBar
            items={[
              {
                key: "bl",
                label: "Backlinks",
                value: int(asNum(summary["backlinks"])),
                tone: "primary",
              },
              {
                key: "rd",
                label: "Referring domains",
                value: int(asNum(summary["referring_domains"])),
                tone: "success",
              },
              { key: "rank", label: "Domain rank", value: int(asNum(summary["rank"])) },
              {
                key: "nofollow",
                label: "Nofollow domains",
                value: int(asNum(summary["referring_domains_nofollow"])),
              },
              {
                key: "spam",
                label: "Spam score",
                value: int(asNum(summary["backlinks_spam_score"])),
                tone:
                  (asNum(summary["backlinks_spam_score"]) ?? 0) > 30 ? "danger" : "neutral",
              },
              {
                key: "broken",
                label: "Broken backlinks",
                value: int(asNum(summary["broken_backlinks"])),
                tone: "warning",
              },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
            <span className="mr-1 text-[12px] text-muted-foreground">
              <Link2 className="mr-1 inline h-3.5 w-3.5" />
              Paid drill-downs ({limit} rows each):
            </span>
            <CostButton
              price={drillPrice("referring_domains")}
              variant="outline"
              running={running === "referring_domains"}
              disabled={running != null}
              onClick={() => fireDrill("referring_domains")}
              label="Referring domains"
            />
            <CostButton
              price={drillPrice("backlinks")}
              variant="outline"
              running={running === "backlinks"}
              disabled={running != null}
              onClick={() => fireDrill("backlinks")}
              label="Top backlinks"
            />
            <CostButton
              price={drillPrice("anchors")}
              variant="outline"
              running={running === "anchors"}
              disabled={running != null}
              onClick={() => fireDrill("anchors")}
              label="Anchors"
            />
          </div>
        </>
      )}

      {drill && (
        <>
          <div className="flex items-center justify-between">
            <Chip tone="neutral">
              <Search className="h-3 w-3" /> {drill.rows.length} rows ·{" "}
              {drill.kind.replace(/_/g, " ")}
            </Chip>
            <ResultMeta cost={drill.cost} cacheHit={drill.cacheHit} />
          </div>
          <TableShell>
            <Table>
              <TableHeader>
                {drill.kind === "backlinks" ? (
                  <TableRow>
                    <TableHead>Anchor</TableHead>
                    <TableHead>Source page</TableHead>
                    <TableHead className="text-right">Domain rank</TableHead>
                    <TableHead className="text-right">Follow</TableHead>
                    <TableHead className="text-right">First seen</TableHead>
                  </TableRow>
                ) : drill.kind === "anchors" ? (
                  <TableRow>
                    <TableHead>Anchor text</TableHead>
                    <TableHead className="text-right">Backlinks</TableHead>
                    <TableHead className="text-right">Referring domains</TableHead>
                    <TableHead className="text-right">Rank</TableHead>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead className="text-right">Backlinks</TableHead>
                    <TableHead className="text-right">Rank</TableHead>
                    <TableHead className="text-right">Spam score</TableHead>
                    <TableHead className="text-right">First seen</TableHead>
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {drill.rows.map((r, i) =>
                  drill.kind === "backlinks" ? (
                    <TableRow key={i}>
                      <TableCell className="max-w-[240px] truncate font-medium">
                        {String(r["anchor"] ?? "—")}
                      </TableCell>
                      <TableCell className="max-w-[340px] truncate text-[12px] text-muted-foreground">
                        <a
                          href={String(r["url_from"] ?? "#")}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground hover:underline"
                        >
                          {String(r["url_from"] ?? "—")}
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {int(asNum(r["domain_from_rank"]))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Chip tone={r["dofollow"] ? "success" : "neutral"}>
                          {r["dofollow"] ? "dofollow" : "nofollow"}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-right text-[12px] text-muted-foreground">
                        {String(r["first_seen"] ?? "—").slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  ) : drill.kind === "anchors" ? (
                    <TableRow key={i}>
                      <TableCell className="max-w-[360px] truncate font-medium">
                        {String(r["anchor"] ?? "—")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {int(asNum(r["backlinks"]))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {int(asNum(r["referring_domains"]))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {int(asNum(r["rank"]))}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{String(r["domain"] ?? "—")}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {int(asNum(r["backlinks"]))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {int(asNum(r["rank"]))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {int(asNum(r["backlinks_spam_score"]))}
                      </TableCell>
                      <TableCell className="text-right text-[12px] text-muted-foreground">
                        {String(r["first_seen"] ?? "—").slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </TableShell>
        </>
      )}
    </div>
  );
}
