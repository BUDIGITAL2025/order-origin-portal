/**
 * FlySales Ads — the read-only dashboard, shared by the client page and the
 * admin overview. Every fetch is explicit: choosing an account or a range,
 * or pressing Load / Refresh. Nothing fires on mount.
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { getAdCreative, getAdsLevel, getAdsOverview } from "@/lib/ads.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface DashboardAccount {
  adAccountId: string;
  label: string;
  workspaceId?: string;
}

type Days = 7 | 14 | 30 | 90;
const RANGES: Days[] = [7, 14, 30, 90];

const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${n.toFixed(2)}%`;
const mult = (n: number) => `${n.toFixed(2)}x`;

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not linked to your workspace/i.test(message)) return message;
  if (/not configured/i.test(message)) return "The ads connection is not configured yet.";
  if (/timed out/i.test(message)) return "Meta took too long to answer. Try again in a moment.";
  return message;
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                           */
/* ------------------------------------------------------------------ */

function Delta({ current, previous, invert }: { current: number; previous: number; invert?: boolean }) {
  if (!previous) return <span className="text-xs text-muted-foreground">no prior data</span>;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const good = invert ? change < 0 : change > 0;
  const Icon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        Math.abs(change) < 0.5 ? "text-muted-foreground" : good ? "text-emerald-500" : "text-destructive",
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

function Kpi({
  label,
  value,
  current,
  previous,
  invert,
}: {
  label: string;
  value: string;
  current: number;
  previous: number;
  invert?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5">
        <Delta current={current} previous={previous} {...(invert ? { invert: true } : {})} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Level table (campaigns → ad sets → ads)                             */
/* ------------------------------------------------------------------ */

interface Crumb {
  level: "campaign" | "adset" | "ad";
  parentId: string | null;
  name: string;
}

function StatusChip({ status }: { status: string }) {
  const active = /ACTIVE/i.test(status);
  const paused = /PAUSED/i.test(status);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] uppercase",
        active && "border-emerald-500/40 text-emerald-500",
        paused && "border-muted-foreground/40 text-muted-foreground",
      )}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

function CreativePreview({ accountId, adId }: { accountId: string; adId: string }) {
  const fetchCreative = useServerFn(getAdCreative);
  const call = useMutation({ mutationFn: () => fetchCreative({ data: { accountId, adId } }) });

  if (!call.data) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        disabled={call.isPending}
        onClick={() => call.mutate()}
      >
        {call.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Creative"}
      </Button>
    );
  }
  const c = call.data;
  return (
    <div className="flex items-center gap-2">
      {c.thumbnailUrl || c.imageUrl ? (
        <img
          src={(c.thumbnailUrl ?? c.imageUrl) as string}
          alt={c.title ?? "Ad creative"}
          className="h-10 w-10 rounded object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="max-w-[220px]">
        <div className="truncate text-xs font-medium">{c.title ?? "Untitled creative"}</div>
        <div className="truncate text-xs text-muted-foreground">{c.body ?? "No copy returned"}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export function AdsDashboard({
  accounts,
  heading,
  subheading,
}: {
  accounts: DashboardAccount[];
  heading?: string;
  subheading?: string;
}) {
  const [accountId, setAccountId] = React.useState(accounts[0]?.adAccountId ?? "");
  const [days, setDays] = React.useState<Days>(30);
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([{ level: "campaign", parentId: null, name: "Campaigns" }]);

  const overviewFn = useServerFn(getAdsOverview);
  const levelFn = useServerFn(getAdsLevel);

  const overview = useMutation({
    mutationFn: (vars: { refresh?: boolean }) =>
      overviewFn({ data: { accountId, days, ...(vars.refresh ? { refresh: true } : {}) } }),
  });
  const level = useMutation({
    mutationFn: (vars: { level: Crumb["level"]; parentId: string | null; refresh?: boolean }) =>
      levelFn({
        data: {
          accountId,
          days,
          level: vars.level,
          ...(vars.parentId ? { parentId: vars.parentId } : {}),
          ...(vars.refresh ? { refresh: true } : {}),
        },
      }),
  });

  const current = crumbs[crumbs.length - 1] as Crumb;

  const load = (refresh = false) => {
    if (!accountId) return;
    overview.mutate({ ...(refresh ? { refresh: true } : {}) });
    level.mutate({ level: current.level, parentId: current.parentId, ...(refresh ? { refresh: true } : {}) });
  };

  const drill = (row: { id: string; name: string }) => {
    if (current.level === "ad") return;
    const next: Crumb["level"] = current.level === "campaign" ? "adset" : "ad";
    setCrumbs((c) => [...c, { level: next, parentId: row.id, name: row.name }]);
    level.mutate({ level: next, parentId: row.id });
  };

  const goTo = (index: number) => {
    const target = crumbs[index];
    if (!target) return;
    setCrumbs((c) => c.slice(0, index + 1));
    level.mutate({ level: target.level, parentId: target.parentId });
  };

  const o = overview.data;
  const currency = o?.currency ?? "USD";
  const rows = level.data?.rows ?? [];
  const stale = o?.stale || level.data?.stale;
  const loading = overview.isPending || level.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{heading ?? "Ads"}</h1>
          <p className="text-sm text-muted-foreground">
            {subheading ??
              "Read-only performance from your Meta ad account. Data is cached for an hour; press refresh to pull again."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 1 ? (
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                overview.reset();
                level.reset();
                setCrumbs([{ level: "campaign", parentId: null, name: "Campaigns" }]);
              }}
            >
              {accounts.map((a) => (
                <option key={a.adAccountId} value={a.adAccountId}>
                  {a.label}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex rounded-md border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  days === r ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setDays(r);
                  if (overview.data || overview.isError) {
                    // Range change is an explicit action: refetch at the new window.
                    setTimeout(() => load(false), 0);
                  }
                }}
              >
                {r}d
              </button>
            ))}
          </div>
          <Button size="sm" disabled={!accountId || loading} onClick={() => load(false)}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {o ? "Reload" : "Load data"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!accountId || loading}
            onClick={() => load(true)}
            title="Bypass the cache and pull fresh numbers from Meta"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {overview.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {friendly(overview.error)}
        </div>
      ) : null}

      {stale ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600">
          Meta did not answer, so these are the last numbers we stored
          {o?.fetchedAt ? ` (updated ${new Date(o.fetchedAt).toLocaleString()})` : ""}.
        </div>
      ) : null}

      {!o && !overview.isPending && !overview.isError ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Choose a period and press <span className="font-medium text-foreground">Load data</span> to pull your
          numbers.
        </div>
      ) : null}

      {o ? (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {o.days} days to {new Date().toLocaleDateString()}
            </span>
            {o.cached ? <Badge variant="outline">cached</Badge> : null}
            <span>Updated {new Date(o.fetchedAt).toLocaleString()}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Spend" value={money(o.current.spend, currency)} current={o.current.spend} previous={o.previous.spend} />
            <Kpi
              label="Impressions"
              value={int(o.current.impressions)}
              current={o.current.impressions}
              previous={o.previous.impressions}
            />
            <Kpi label="Clicks" value={int(o.current.clicks)} current={o.current.clicks} previous={o.previous.clicks} />
            <Kpi label="CTR" value={pct(o.current.ctr)} current={o.current.ctr} previous={o.previous.ctr} />
            <Kpi label="CPC" value={money(o.current.cpc, currency)} current={o.current.cpc} previous={o.previous.cpc} invert />
            <Kpi
              label="Purchases"
              value={int(o.current.purchases)}
              current={o.current.purchases}
              previous={o.previous.purchases}
            />
            <Kpi label="ROAS" value={mult(o.current.roas)} current={o.current.roas} previous={o.previous.roas} />
            <Kpi label="CPA" value={money(o.current.cpa, currency)} current={o.current.cpa} previous={o.previous.cpa} invert />
          </div>

          {o.series.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-3">
                <div className="mb-2 text-sm font-medium">Spend per day</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={o.series}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip formatter={(v: number) => money(v, currency)} />
                      <Area
                        type="monotone"
                        dataKey="spend"
                        stroke="hsl(var(--accent))"
                        fill="hsl(var(--accent))"
                        fillOpacity={0.15}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="mb-2 text-sm font-medium">Purchases and ROAS per day</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={o.series}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip />
                      <Line yAxisId="left" type="monotone" dataKey="purchases" stroke="hsl(var(--accent))" dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="roas" stroke="hsl(var(--primary))" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Structure table */}
      {level.data || level.isPending || level.isError ? (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-1 border-b px-3 py-2 text-sm">
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c.level}-${c.parentId ?? "root"}`}>
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                <button
                  type="button"
                  className={cn(
                    "rounded px-1.5 py-0.5",
                    i === crumbs.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => goTo(i)}
                >
                  {c.name}
                </button>
              </React.Fragment>
            ))}
            {level.isPending ? <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>

          {level.isError ? (
            <div className="p-3 text-sm text-destructive">{friendly(level.error)}</div>
          ) : rows.length === 0 && !level.isPending ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nothing to show at this level for the selected period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Spend</th>
                    <th className="px-3 py-2 text-right font-medium">Results</th>
                    <th className="px-3 py-2 text-right font-medium">CPA</th>
                    <th className="px-3 py-2 text-right font-medium">ROAS</th>
                    <th className="px-3 py-2 text-right font-medium">CTR</th>
                    {current.level === "ad" ? <th className="px-3 py-2 text-left font-medium">Creative</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2">
                        {current.level === "ad" ? (
                          <span className="font-medium">{row.name}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-left font-medium hover:underline"
                            onClick={() => drill(row)}
                          >
                            {row.name}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusChip status={row.status} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.metrics.spend, currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{int(row.metrics.purchases)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.metrics.cpa, currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{mult(row.metrics.roas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(row.metrics.ctr)}</td>
                      {current.level === "ad" ? (
                        <td className="px-3 py-2">
                          <CreativePreview accountId={accountId} adId={row.id} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
