import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlertTriangle, PackageSearch, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { getCurrentStoreId, STORE_CHANGED_EVENT } from "@/components/store-switcher";
import { SummaryBar, FilterTabs } from "@/components/admin-ui";
import { InventoryTable, type InventoryRow } from "@/components/inventory-table";
import { InventoryItemDialog } from "@/components/inventory-item-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getWorkspaceInventory } from "@/lib/inventory.functions";
import { useMyContext } from "../_client";
import { friendlyError } from "@/lib/errors";


export const Route = createFileRoute("/_authenticated/_client/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — FlySales" },
      {
        name: "description",
        content: "Stock levels, sales velocity and reorder dates for every SKU in your workspace.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InventoryPage,
});

const TABS = [
  { id: "all", label: "All" },
  { id: "red", label: "Reorder now" },
  { id: "amber", label: "Reorder soon" },
  { id: "green", label: "Healthy" },
  { id: "idle", label: "No sales" },
] as const;

function InventoryPage() {
  const { data: ctx } = useMyContext();
  const navigate = useNavigate();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [addOpen, setAddOpen] = useState(false);


  useEffect(() => {
    const read = () => setStoreId(getCurrentStoreId());
    read();
    window.addEventListener(STORE_CHANGED_EVENT, read);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, read);
  }, []);

  const allStores = ctx?.entities?.flatMap((e) => e.stores) ?? [];
  const currentStore = allStores.find((s) => s.id === storeId) ?? allStores[0] ?? null;

  const fetchInventory = useServerFn(getWorkspaceInventory);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["inventory", currentStore?.id],
    enabled: currentStore != null,
    staleTime: 60_000,
    queryFn: () => fetchInventory({ data: { storeId: currentStore!.id } }),
  });

  const rows = (data?.rows ?? []) as InventoryRow[];
  const counts = {
    red: rows.filter((r) => r.state === "red").length,
    amber: rows.filter((r) => r.state === "amber").length,
    green: rows.filter((r) => r.state === "green").length,
    idle: rows.filter((r) => r.state === "idle").length,
  };
  const units = rows.reduce((sum, r) => sum + r.total_stock, 0);
  const visible = tab === "all" ? rows : rows.filter((r) => r.state === tab);

  const planReorder = (row: InventoryRow) =>
    void navigate({
      to: "/quotes/new",
      search: { sku: row.sku, name: row.product_name, qty: row.suggested_qty },
    });

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock, velocity and the date each SKU needs to be reordered."
      />

      {error && (
        <Card className="mb-4 border-destructive/30">
          <CardContent className="p-4 text-sm text-destructive">
            {friendlyError(error)}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading your stock…
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-8">
            <PackageSearch className="h-8 w-8 text-muted-foreground" />
            <h2 className="text-base font-semibold">No inventory data yet</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {data?.connected
                ? "We are connected to your fulfilment engine but have not received stock levels for this workspace yet. Levels appear within 30 minutes of the first sync."
                : "Inventory appears once this workspace is connected to fulfilment and we start receiving stock levels. Until then, your orders and quotes work exactly as they do now."}
            </p>
            <p className="text-xs text-muted-foreground">
              Once stock is flowing, you see days of cover, the reorder-by date for each SKU and an
              alert before you run out.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {data?.stale && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              These numbers may be out of date. Last sync:{" "}
              {data.last_captured_at
                ? new Date(data.last_captured_at).toLocaleString("en-GB")
                : "never"}
              .
            </div>
          )}

          <SummaryBar
            items={[
              { key: "skus", label: "SKUs tracked", value: rows.length },
              { key: "red", label: "Reorder now", value: counts.red, tone: "danger" },
              { key: "amber", label: "Reorder soon", value: counts.amber, tone: "warning" },
              { key: "green", label: "Healthy", value: counts.green, tone: "success" },
              { key: "units", label: "Units in stock", value: units.toLocaleString("en-US") },
            ]}
          />

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FilterTabs tabs={TABS} value={tab} onChange={setTab} />
            <button
              type="button"
              onClick={() => void refetch()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Refresh
            </button>
          </div>

          <InventoryTable rows={visible} onPlanReorder={planReorder} />
        </>
      )}
    </div>
  );
}
