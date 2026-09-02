import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { AdminSearch, FilterTabs, PanelHeader, SummaryBar } from "@/components/admin-ui";
import { InventoryTable, type InventoryRow } from "@/components/inventory-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAdminInventory,
  setWorkspacePlanningDefaults,
  syncInventoryNow,
} from "@/lib/inventory.functions";
import { PlanningDialog } from "@/components/planning-dialog";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/admin/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — FlySales admin" },
      { name: "description", content: "Stock, velocity and reorder dates across every workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminInventoryPage,
});

const TABS = [
  { id: "all", label: "All" },
  { id: "red", label: "Reorder now" },
  { id: "amber", label: "Reorder soon" },
  { id: "green", label: "Healthy" },
  { id: "idle", label: "No sales" },
] as const;

function AdminInventoryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [planningProductId, setPlanningProductId] = useState<string | null>(null);
  const [defaultsFor, setDefaultsFor] = useState<
    { storeId: string; production: number; transit: number; safety: number } | null
  >(null);

  const callDefaults = useServerFn(setWorkspacePlanningDefaults);
  const saveDefaults = useMutation({
    mutationFn: (d: NonNullable<typeof defaultsFor>) =>
      callDefaults({
        data: {
          storeId: d.storeId,
          default_production_lead_days: d.production,
          default_transit_lead_days: d.transit,
          default_safety_margin_days: d.safety,
        },
      }),
    onSuccess: () => {
      toast.success("Workspace defaults saved");
      setDefaultsFor(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const fetchInventory = useServerFn(getAdminInventory);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-inventory"],
    staleTime: 60_000,
    queryFn: () => fetchInventory(),
  });

  const callSync = useServerFn(syncInventoryNow);
  const sync = useMutation({
    mutationFn: () => callSync({ data: {} }),
    onSuccess: (res) => {
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) toast.error(`${failed.length} workspace sync(s) failed`);
      else toast.success("Stock levels refreshed");
      void queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const workspaces = data?.workspaces ?? [];
  const allRows = workspaces.flatMap((w) => w.rows as InventoryRow[]);
  const counts = {
    red: allRows.filter((r) => r.state === "red").length,
    amber: allRows.filter((r) => r.state === "amber").length,
    green: allRows.filter((r) => r.state === "green").length,
  };

  const term = search.trim().toLowerCase();
  const filterRows = (rows: InventoryRow[]) =>
    rows
      .filter((r) => (tab === "all" ? true : r.state === tab))
      .filter(
        (r) =>
          !term ||
          r.sku.toLowerCase().includes(term) ||
          r.product_name.toLowerCase().includes(term),
      );

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Every connected workspace, sorted by reorder urgency."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw className={sync.isPending ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"} />
            Sync now
          </Button>
        }
      />

      {error && (
        <Card className="mb-4 border-destructive/30">
          <CardContent className="p-4 text-sm text-destructive">{friendlyError(error)}</CardContent>
        </Card>
      )}

      <SummaryBar
        items={[
          { key: "ws", label: "Workspaces", value: workspaces.length },
          { key: "skus", label: "SKUs tracked", value: allRows.length },
          { key: "red", label: "Reorder now", value: counts.red, tone: "danger" },
          { key: "amber", label: "Reorder soon", value: counts.amber, tone: "warning" },
          { key: "green", label: "Healthy", value: counts.green, tone: "success" },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterTabs tabs={TABS} value={tab} onChange={setTab} />
        <AdminSearch value={search} onChange={setSearch} placeholder="Search SKU or product" />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading stock…</CardContent>
        </Card>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No workspace is reporting stock yet. Connect a tenant, or seed fake stock from the
            simulator on the Integration page.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {workspaces.map((ws) => {
            const rows = filterRows(ws.rows as InventoryRow[]);
            if (rows.length === 0) return null;
            return (
              <section key={ws.store_id}>
                <PanelHeader
                  title={ws.store_name ?? "Unnamed workspace"}
                  description={`Tenant ${ws.tenant_id ?? "—"} · defaults ${ws.defaults.production}d production / ${ws.defaults.transit}d transit / ${ws.defaults.safety}d safety`}
                  actions={
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() =>
                        setDefaultsFor({
                          storeId: ws.store_id,
                          production: ws.defaults.production ?? 0,
                          transit: ws.defaults.transit ?? 0,
                          safety: ws.defaults.safety ?? 0,
                        })
                      }
                    >
                      Edit defaults
                    </Button>
                  }
                />
                {ws.stale && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-[12px] text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Stale data — last sync{" "}
                    {ws.last_captured_at
                      ? new Date(ws.last_captured_at).toLocaleString("en-GB")
                      : "never"}
                  </div>
                )}
                <InventoryTable
                  rows={rows}
                  showOrigin
                  planLabel="Planning"
                  planIcon={SlidersHorizontal}
                  onPlanReorder={(row) => row.product_id && setPlanningProductId(row.product_id)}
                />
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={defaultsFor !== null} onOpenChange={(open) => !open && setDefaultsFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Workspace planning defaults</DialogTitle>
            <DialogDescription>
              The bottom of the cascade — used whenever a SKU has no product override and no
              supplier default.
            </DialogDescription>
          </DialogHeader>
          {defaultsFor && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="w-prod">Production</Label>
                <Input
                  id="w-prod"
                  type="number"
                  min={0}
                  value={defaultsFor.production}
                  onChange={(e) =>
                    setDefaultsFor({ ...defaultsFor, production: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="w-transit">Transit</Label>
                <Input
                  id="w-transit"
                  type="number"
                  min={0}
                  value={defaultsFor.transit}
                  onChange={(e) =>
                    setDefaultsFor({ ...defaultsFor, transit: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="w-safety">Safety</Label>
                <Input
                  id="w-safety"
                  type="number"
                  min={0}
                  value={defaultsFor.safety}
                  onChange={(e) =>
                    setDefaultsFor({ ...defaultsFor, safety: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setDefaultsFor(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={saveDefaults.isPending}
              onClick={() => defaultsFor && saveDefaults.mutate(defaultsFor)}
            >
              Save defaults
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlanningDialog
        productId={planningProductId}
        onClose={() => setPlanningProductId(null)}
      />
    </div>
  );
}
