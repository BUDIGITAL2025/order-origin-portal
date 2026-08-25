import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, PackagePlus, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  adminClearSimulatorPullQueue,
  adminQueueSimulatorPullOrder,
  adminSetSimulatorOverride,
  adminSimulateOrder,
  adminSimulateTracking,
  adminSimulatorStatus,
} from "@/lib/simulator.functions";

type ReleaseRow = {
  id: string;
  middleware_order_id: string | null;
  external_order_number: string | null;
  status: string;
  release_status: string | null;
};

/**
 * TEST TOOLING — drives the middleware simulator so the whole C2 loop can be
 * exercised without the real fulfilment engine. Admin-only surface.
 */
export function SimulatorPanel({ releases }: { releases: ReleaseRow[] }) {
  const fetchStatus = useServerFn(adminSimulatorStatus);
  const setOverride = useServerFn(adminSetSimulatorOverride);
  const simulateOrder = useServerFn(adminSimulateOrder);
  const simulateTracking = useServerFn(adminSimulateTracking);
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [trackingOrderId, setTrackingOrderId] = React.useState<string>("");

  const { data } = useQuery({
    queryKey: ["admin-simulator"],
    queryFn: () => fetchStatus({}),
  });

  const trackable = releases.filter(
    (r) => r.release_status === "sent" || r.status === "shipped" || r.status === "paid",
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-simulator"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-integration"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-integration-releases"] }),
    ]);
  }

  async function toggleOverride(enabled: boolean) {
    setBusy("override");
    try {
      await setOverride({ data: { enabled } });
      toast.success(enabled ? "Releases now point at the simulator" : "Simulator override off");
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Could not change the override"));
    } finally {
      setBusy(null);
    }
  }

  async function createOrder() {
    setBusy("order");
    try {
      const result = await simulateOrder({});
      toast.success(
        `Simulated ${result.middleware_order_id} (${result.destination_country}) for ${result.store_name ?? "workspace"}`,
      );
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Could not simulate an order"));
    } finally {
      setBusy(null);
    }
  }

  async function sendTracking() {
    if (!trackingOrderId) return;
    setBusy("tracking");
    try {
      const result = await simulateTracking({ data: { order_id: trackingOrderId } });
      toast.success(`Tracking ${result.tracking_carrier} ${result.tracking_number} emitted`);
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Could not simulate tracking"));
    } finally {
      setBusy(null);
    }
  }

  const queuePullOrder = useServerFn(adminQueueSimulatorPullOrder);
  const clearPullQueue = useServerFn(adminClearSimulatorPullQueue);

  async function addPullOrder() {
    setBusy("pull");
    try {
      const order = await queuePullOrder({});
      toast.success(`Queued ${order.order_number} for the poller (${order.country})`);
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Could not queue a pull order"));
    } finally {
      setBusy(null);
    }
  }

  async function emptyPullQueue() {
    setBusy("pull-clear");
    try {
      await clearPullQueue({});
      toast.success("Pull queue emptied");
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, "Could not clear the pull queue"));
    } finally {
      setBusy(null);
    }
  }

  const overrideOn = data?.override_enabled === true;
  const blocked = data?.real_middleware_configured === true;

  return (
    <Card className="border-2 border-dashed border-warning/40 bg-warning/[0.04] shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-warning" />
          Simulator
          <span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">
            Test tooling
          </span>
          {overrideOn ? <Badge>Releases → simulator</Badge> : null}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Emits real signed webhooks into our own receiver and accepts the outbound release call, so
          the full lifecycle can be proven without the middleware. All traffic is tagged{" "}
          <span className="font-mono">simulator=true</span> and ignored by the ops digest.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Fact label="Simulator token" value={data?.token_set ? "configured" : "missing"} />
          <Fact label="Webhook secret" value={data?.webhook_secret_set ? "configured" : "missing"} />
          <Fact label="Simulator URL" value={data?.simulator_url ?? "unknown app base URL"} mono />
          <Fact
            label="Test workspace"
            mono
            value={
              data?.workspace
                ? `${data.workspace.name ?? data.workspace.id.slice(0, 8)} · ${data.workspace.skus.length} SKU(s) · ${data.workspace.countries.join(", ")}`
                : "none found (needs a tenant id + priced products)"
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3">
          <label htmlFor="sim-override" className="min-w-0 cursor-pointer">
            <div className="text-sm font-medium">Point releases at simulator</div>
            <div className="text-xs text-muted-foreground">
              {blocked
                ? "Disabled: a real MIDDLEWARE_BASE_URL is configured."
                : "Outbound release/reject calls go to the simulator so they flip to 'sent'."}
            </div>
          </label>
          <Switch
            id="sim-override"
            checked={overrideOn}
            disabled={blocked || busy === "override" || !data?.token_set}
            onCheckedChange={toggleOverride}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy === "order"} onClick={createOrder}>
            <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
            {busy === "order" ? "Simulating…" : "Simulate connected order"}
          </Button>

          <Select value={trackingOrderId} onValueChange={setTrackingOrderId}>
            <SelectTrigger className="h-9 w-[260px] text-xs">
              <SelectValue placeholder="Pick a middleware order…" />
            </SelectTrigger>
            <SelectContent>
              {trackable.length === 0 ? (
                <SelectItem value="none" disabled>
                  No released middleware orders yet
                </SelectItem>
              ) : (
                trackable.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.external_order_number ?? r.middleware_order_id ?? r.id.slice(0, 8)} ·{" "}
                    {r.status}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!trackingOrderId || busy === "tracking"}
            onClick={sendTracking}
          >
            <Truck className="mr-1.5 h-3.5 w-3.5" />
            {busy === "tracking" ? "Emitting…" : "Simulate tracking"}
          </Button>
          {trackingOrderId ? (
            <Link
              to="/orders/$id"
              params={{ id: trackingOrderId }}
              className="text-xs underline underline-offset-4"
            >
              Open order
            </Link>
          ) : null}
        </div>

        <div className="rounded-xl border border-dashed border-border/60 p-3">
          <div className="text-sm font-medium">Pull queue (GET /orders)</div>
          <div className="mb-2 text-xs text-muted-foreground">
            Fake orders the simulator serves to the 5-minute poller. Queue one, then use “Sync now”
            in the Order sync panel to watch it land in awaiting payment.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy === "pull"} onClick={addPullOrder}>
              <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
              {busy === "pull" ? "Queueing…" : "Queue pull order"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === "pull-clear" || (data?.pull_queue ?? []).length === 0}
              onClick={emptyPullQueue}
            >
              {busy === "pull-clear" ? "Clearing…" : "Clear queue"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {(data?.pull_queue ?? []).length} queued
            </span>
          </div>
          {(data?.pull_queue ?? []).length > 0 ? (
            <div className="mt-2 space-y-1">
              {(data?.pull_queue ?? []).map((order) => (
                <div key={order.id} className="flex flex-wrap gap-2 text-xs">
                  <span className="font-mono">{order.id}</span>
                  <span className="text-muted-foreground">
                    {order.status} · {order.country} ·{" "}
                    {order.line_items.map((l) => `${l.sku}×${l.quantity}`).join(", ")}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {(data?.calls ?? []).length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/30">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="metric-label">Calls received by the simulator</span>
              <span className="font-mono text-[11px] text-muted-foreground tnum">
                {(data?.calls ?? []).length}
              </span>
            </div>
            <div className="max-h-64 divide-y divide-border/40 overflow-y-auto">
              {(data?.calls ?? []).map((call) => (
                <div
                  key={call.id}
                  className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] leading-tight"
                >
                  <span className="shrink-0 text-muted-foreground tnum">
                    {formatDateTime(call.created_at)}
                  </span>
                  <span className="shrink-0 rounded-full border border-primary/50 px-1.5 py-px text-[10px] text-primary">
                    {call.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/80" title={call.endpoint}>
                    {call.endpoint}
                  </span>
                  {call.replay_count > 0 ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      replayed ×{call.replay_count}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
      <div className="metric-label text-[10px]">{label}</div>
      <div
        className={
          mono
            ? "mt-0.5 break-all font-mono text-xs leading-snug"
            : "mt-0.5 break-words text-xs leading-snug"
        }
      >
        {value}
      </div>
    </div>
  );
}
