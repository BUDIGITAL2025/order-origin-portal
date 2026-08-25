import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { adminSyncNow, adminSyncOverview } from "@/lib/integration.functions";

/**
 * Phase 4 — pull ingestion monitor: per-tenant last sync, ingested count and
 * last error, plus a manual "Sync now".
 */
export function SyncPanel() {
  const fetchOverview = useServerFn(adminSyncOverview);
  const syncNow = useServerFn(adminSyncNow);
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-middleware-sync"],
    queryFn: () => fetchOverview({}),
  });

  async function run(storeId?: string) {
    setBusy(storeId ?? "all");
    try {
      const { results } = await syncNow({ data: storeId ? { store_id: storeId } : {} });
      const ingested = results.reduce((sum, r) => sum + r.ingested, 0);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(failed[0]?.error ?? "Sync failed for one or more tenants");
      } else {
        toast.success(
          `Synced ${results.length} tenant(s) — ${ingested} new order(s) ingested`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-middleware-sync"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-integration"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-integration-releases"] }),
      ]);
    } catch (err) {
      toast.error(friendlyError(err, "Could not run the sync"));
    } finally {
      setBusy(null);
    }
  }

  const tenants = data?.tenants ?? [];
  const paths = data?.entry_paths ?? {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Order sync (pull)</CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Redundancy path: polls the fulfilment engine every 5 minutes and only picks up what
            the webhook missed. {data?.connected_workspaces ?? 0} connected workspace(s) in scope —
            a healthy integration shows almost everything arriving by webhook.
          </p>
        </div>
        <Button size="sm" className="shrink-0" disabled={busy !== null} onClick={() => run()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {busy === "all" ? "Syncing…" : "Sync now"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {tenants.length === 0 ? (
          <EmptyState
            title="No sync has run yet"
            hint="Once a workspace has a tenant id in connected mode, its sync state appears here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace / tenant</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Orders ingested</TableHead>
                <TableHead>Entry path</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.store_id} className="text-[13px]">
                  <TableCell className="py-2.5">
                    <div className="font-medium leading-tight">
                      {(tenant.stores as { store_name?: string | null } | null)?.store_name ??
                        "Workspace"}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {tenant.tenant_id}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 font-mono text-[11px] text-muted-foreground tnum">
                    {tenant.last_synced_at ? formatDateTime(tenant.last_synced_at) : "—"}
                    <div>
                      ok: {tenant.last_success_at ? formatDateTime(tenant.last_success_at) : "—"}
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 tnum">
                    <span className="font-medium">{tenant.orders_ingested}</span>
                    <div className="text-[11px] text-muted-foreground">
                      {(tenant.last_seen_order_ids ?? []).length} seen last cycle
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">
                    {(() => {
                      const p = paths[tenant.tenant_id];
                      const pollCaught = p?.orders_poll ?? 0;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chip label="orders">
                            {p?.orders_webhook ?? 0} webhook ·{" "}
                            <span className={pollCaught > 0 ? "font-semibold text-destructive" : ""}>
                              {pollCaught}
                            </span>{" "}
                            polling
                          </Chip>
                          <Chip label="tracking">
                            {p?.tracking_webhook ?? 0} webhook · {p?.tracking_poll ?? 0} polling
                          </Chip>
                          {pollCaught > 0 ? (
                            <Badge variant="destructive">Check webhook delivery</Badge>
                          ) : null}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="py-2.5">
                    {tenant.consecutive_failures > 0 ? (
                      <div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                          Failing ({tenant.consecutive_failures})
                        </span>
                        <div className="mt-1 max-w-md text-[11px] text-muted-foreground">
                          {tenant.last_error}
                        </div>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        Healthy
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => run(tenant.store_id)}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      {busy === tenant.store_id ? "Syncing…" : "Sync"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
