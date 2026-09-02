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
import { getAdminInventory, syncInventoryNow } from "@/lib/inventory.functions";
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

      <PlanningDialog
        productId={planningProductId}
        onClose={() => setPlanningProductId(null)}
      />
    </div>
  );
}
