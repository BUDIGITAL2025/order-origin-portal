/**
 * /admin/ads — the ads control room: which accounts our provider connection
 * can see, which workspace each one belongs to, an overview across every
 * mapped account, and the call/usage log.
 */
import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  adminAdsUsage,
  adminListMappings,
  adminListProviderAccounts,
  adminRemoveMapping,
  adminSaveMapping,
  adminSetBusinessManagerId,
} from "@/lib/ads.functions";
import { AdsDashboard } from "@/components/ads-dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "accounts", label: "Accounts & mapping" },
  { id: "overview", label: "Overview" },
  { id: "usage", label: "Usage" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/_authenticated/admin/ads")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (typeof search["tab"] === "string" ? (search["tab"] as TabId) : "accounts") as TabId,
  }),
  head: () => ({
    meta: [
      { title: "Ads control room — admin" },
      {
        name: "description",
        content:
          "Map client ad accounts to workspaces, review performance and audit every ads API call.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminAdsPage,
});

function AdminAdsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Ads</h1>
        <p className="text-sm text-muted-foreground">
          Client ad accounts reach us through partner access on our Business Manager. Map an account
          to a workspace and that client sees it — and only it.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              "border-b-2 px-3 py-2 text-sm",
              tab === t.id
                ? "border-accent font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, tab: t.id }), replace: true })
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "accounts" ? <AccountsTab /> : null}
      {tab === "overview" ? <OverviewTab /> : null}
      {tab === "usage" ? <UsageTab /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AccountsTab() {
  const mappingsFn = useServerFn(adminListMappings);
  const providerFn = useServerFn(adminListProviderAccounts);
  const saveFn = useServerFn(adminSaveMapping);
  const removeFn = useServerFn(adminRemoveMapping);
  const bmFn = useServerFn(adminSetBusinessManagerId);
  const queryClient = useQueryClient();

  const mappings = useQuery({
    queryKey: ["ads-mappings"],
    queryFn: () => mappingsFn(),
    retry: false,
  });
  const provider = useMutation({
    mutationFn: (refresh: boolean) => providerFn({ data: { refresh } }),
  });

  const [businessId, setBusinessId] = React.useState("");
  React.useEffect(() => {
    if (mappings.data?.businessManagerId) setBusinessId(mappings.data.businessManagerId);
  }, [mappings.data?.businessManagerId]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["ads-mappings"] });

  const save = useMutation({
    mutationFn: (vars: { workspaceId: string; adAccountId: string; label?: string }) =>
      saveFn({ data: { ...vars, active: true } }),
    onSuccess: () => {
      toast.success("Ad account mapped");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not map the account"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Mapping removed");
      invalidate();
    },
  });
  const saveBm = useMutation({
    mutationFn: () => bmFn({ data: { businessManagerId: businessId } }),
    onSuccess: () => {
      toast.success("Business ID saved");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const [pick, setPick] = React.useState<Record<string, string>>({});

  if (mappings.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {mappings.error instanceof Error ? mappings.error.message : "Could not load mappings."}
      </div>
    );
  }
  if (mappings.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const data = mappings.data;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">Our Business Manager ID</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Shown to clients on their Ads page so they can grant partner access.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            placeholder="1234567890"
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={saveBm.isPending || businessId.trim().length < 3}
            onClick={() => saveBm.mutate()}
          >
            Save
          </Button>
        </div>
      </div>

      {data.openRequests.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="text-sm font-medium">Waiting for activation</div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.openRequests.map((r) => (
              <li key={r.id}>
                {r.workspaceName ?? r.workspaceId} — asked{" "}
                {new Date(r.createdAt).toLocaleDateString()}
                {r.note ? ` · "${r.note}"` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-medium">Accounts in our connection</div>
            <p className="text-xs text-muted-foreground">
              One metered call, cached 24 hours. Assign an account to a workspace to switch that
              client on.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={provider.isPending}
              onClick={() => provider.mutate(false)}
            >
              {provider.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Load accounts
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={provider.isPending}
              onClick={() => provider.mutate(true)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {provider.isError ? (
          <div className="p-3 text-sm text-destructive">
            {provider.error instanceof Error
              ? provider.error.message
              : "Could not reach the provider."}
          </div>
        ) : null}

        {provider.data ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-left font-medium">ID</th>
                  <th className="px-3 py-2 text-left font-medium">Currency</th>
                  <th className="px-3 py-2 text-left font-medium">Assign to workspace</th>
                </tr>
              </thead>
              <tbody>
                {provider.data.accounts.map((a) => {
                  const mapped = data.mappings.find((m) => m.ad_account_id === a.id);
                  return (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{a.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.id}</td>
                      <td className="px-3 py-2">{a.currency ?? "—"}</td>
                      <td className="px-3 py-2">
                        {mapped ? (
                          <Badge variant="outline">
                            {mapped.workspace_name ?? mapped.workspace_id}
                          </Badge>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              className="h-8 rounded-md border bg-background px-2 text-sm"
                              value={pick[a.id] ?? ""}
                              onChange={(e) => setPick((p) => ({ ...p, [a.id]: e.target.value }))}
                            >
                              <option value="">Choose…</option>
                              {data.workspaces.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                  {w.entity ? ` · ${w.entity}` : ""}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              disabled={!pick[a.id] || save.isPending}
                              onClick={() =>
                                save.mutate({
                                  workspaceId: pick[a.id] as string,
                                  adAccountId: a.id,
                                  label: a.name,
                                })
                              }
                            >
                              Map
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Press <span className="font-medium text-foreground">Load accounts</span> to see what our
            connection can reach.
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3 text-sm font-medium">Current mappings</div>
        {data.mappings.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No ad accounts mapped yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Workspace</th>
                <th className="px-3 py-2 text-left font-medium">Ad account</th>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.mappings.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{m.workspace_name ?? m.workspace_id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.ad_account_id}</td>
                  <td className="px-3 py-2">{m.label ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab() {
  const mappingsFn = useServerFn(adminListMappings);
  const mappings = useQuery({
    queryKey: ["ads-mappings"],
    queryFn: () => mappingsFn(),
    retry: false,
  });

  if (mappings.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  const accounts = (mappings.data?.mappings ?? [])
    .filter((m) => m.active)
    .map((m) => ({
      adAccountId: m.ad_account_id,
      label: `${m.workspace_name ?? m.workspace_id} · ${m.label ?? m.ad_account_id}`,
      workspaceId: m.workspace_id,
    }));

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Map an ad account to a workspace first.
      </div>
    );
  }
  return (
    <AdsDashboard
      accounts={accounts}
      heading="Performance across mapped accounts"
      subheading="Switch account, pick a period and load. Same numbers the client sees."
    />
  );
}

/* ------------------------------------------------------------------ */

function UsageTab() {
  const usageFn = useServerFn(adminAdsUsage);
  const usage = useQuery({ queryKey: ["ads-usage"], queryFn: () => usageFn(), retry: false });

  if (usage.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (usage.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {usage.error instanceof Error ? usage.error.message : "Could not load usage."}
      </div>
    );
  }
  const u = usage.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Calls (30d)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{u.total}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Served from cache
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {(u.cacheHitRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Failures</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{u.failures}</div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 py-2 text-sm font-medium">By workspace</div>
          <table className="w-full text-sm">
            <tbody>
              {u.byWorkspace.map((w) => (
                <tr key={w.workspace} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{w.workspace}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{w.calls}</td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                    {w.cached} cached
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-destructive">
                    {w.failed || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 py-2 text-sm font-medium">By tool</div>
          <table className="w-full text-sm">
            <tbody>
              {u.byTool.map((t) => (
                <tr key={t.tool} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs">{t.tool}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{t.calls}</td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                    {t.cached} cached
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-destructive">
                    {t.failed || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-3 py-2 text-sm font-medium">Recent calls</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Workspace</th>
                <th className="px-3 py-2 text-left font-medium">Tool</th>
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-right font-medium">ms</th>
                <th className="px-3 py-2 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {u.calls.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5 text-xs">{new Date(c.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5">{c.workspaceName ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{c.tool}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{c.adAccountId ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.rows}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.durationMs ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {c.ok ? (
                      <Badge variant="outline">{c.cached ? "cached" : "live"}</Badge>
                    ) : (
                      <span className="text-xs text-destructive">{c.error ?? "failed"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
