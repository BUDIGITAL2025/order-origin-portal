/**
 * SpyMarket research tool — ADMIN-ONLY internal UI over the WinningHunter API.
 * WinningHunter is the single provider: every metered action is explicit, cached
 * 24h, and logged with its real credit cost. All data flows through
 * winninghunter.functions (server-side gateway) — never from the browser.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Database, FlaskConical, Users, Wallet } from "lucide-react";
import { getWhStatus, getWhUsage } from "@/lib/winninghunter.functions";
import { WhAdLibraryTab, WhHeaderChips } from "@/components/spymarket-wh";
import {
  WhBrandsTab,
  WhStoreExplorerTab,
  WhTikTokShopTab,
  WhTrendsTab,
} from "@/components/spymarket-wh2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtInt = (v: number | null | undefined): string => (v == null ? "—" : v.toLocaleString("en"));

export interface SpyMarketToolsProps {
  tab: string;
  search: Record<string, string | undefined>;
  go: (patch: Record<string, string | undefined>, opts?: { push?: boolean }) => void;
}

const TOOL_TABS: ReadonlyArray<{ id: string; label: string; badge?: string }> = [
  { id: "stores", label: "Store explorer" },
  { id: "ads", label: "Ad Library" },
  { id: "brands", label: "Brands" },
  { id: "trends", label: "Trends" },
  { id: "tiktok", label: "TikTok Shop" },
  { id: "usage", label: "Usage", badge: "free" },
];

export function SpyMarketTools({ tab, search, go }: SpyMarketToolsProps) {
  const statusFn = useServerFn(getWhStatus);
  const { data: status, isLoading } = useQuery({
    queryKey: ["wh-status"],
    staleTime: 30_000,
    retry: false,
    queryFn: () => statusFn({ data: { live: false } }),
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
        <Header />
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary" />
              Setup required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              The WinningHunter integration is not configured yet. Add the secret{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">WINNINGHUNTER_API_KEY</code>{" "}
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

  const activeTab = TOOL_TABS.some((t) => t.id === tab) ? tab : "stores";

  return (
    <div className="space-y-6">
      <Header withChips />

      <div className="flex flex-wrap gap-2">
        {TOOL_TABS.map((t) => (
          <Button
            key={t.id}
            variant={activeTab === t.id ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            onClick={() => go({ tab: t.id }, { push: true })}
          >
            {t.label}
            {t.badge && (
              <Badge
                variant={activeTab === t.id ? "outline" : "secondary"}
                className="ml-1.5 rounded-full px-1.5 py-0 text-[10px]"
              >
                {t.badge}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {activeTab === "stores" && <WhStoreExplorerTab url={search} go={go} />}
      {activeTab === "ads" && <WhAdLibraryTab url={search} go={go} />}
      {activeTab === "brands" && <WhBrandsTab url={search} go={go} />}
      {activeTab === "trends" && <WhTrendsTab />}
      {activeTab === "tiktok" && <WhTikTokShopTab />}
      {activeTab === "usage" && <UsageTab />}
    </div>
  );
}

function Header({ withChips = false }: { withChips?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SpyMarket research</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal WinningHunter workspace — admin only. Nothing fires without your action: each
          uncached call costs 1 credit, results are cached 24h and every call is logged.
        </p>
      </div>
      {withChips && (
        <div className="flex flex-wrap items-center gap-2">
          <WhHeaderChips />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Usage — WinningHunter calls only (historical TrendTrack rows stay in the log)
// ---------------------------------------------------------------------------

function UsageTab() {
  const usageFn = useServerFn(getWhUsage);
  const { data, isLoading } = useQuery({
    queryKey: ["wh-usage-dashboard"],
    staleTime: 60_000,
    retry: false,
    queryFn: () => usageFn(),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={FlaskConical} label="Credits today" value={fmtInt(data.today)} />
        <StatCard icon={FlaskConical} label="This week" value={fmtInt(data.week)} />
        <StatCard icon={FlaskConical} label="This month" value={fmtInt(data.month)} />
        <StatCard icon={Wallet} label="Calls (30d)" value={fmtInt(data.calls30d)} />
        <StatCard
          icon={Database}
          label="Cache hit rate"
          value={`${Math.round(data.cacheHitRate * 100)}%`}
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
          <CardTitle className="text-sm font-medium">Recent WinningHunter calls</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing logged yet. Every metered call lands here with its real credit cost.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
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
                    <TableCell className="font-mono text-xs">{r.endpoint}</TableCell>
                    <TableCell className="text-right">{r.rows_returned}</TableCell>
                    <TableCell className="text-right">{r.credits_cost}</TableCell>
                    <TableCell className="text-right">
                      {r.credits_remaining != null ? fmtInt(r.credits_remaining) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.cached && (
                        <Badge className="rounded-full bg-primary/15 text-primary hover:bg-primary/15">
                          cache
                        </Badge>
                      )}
                      {r.error && (
                        <Badge variant="destructive" className="rounded-full" title={r.error}>
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
